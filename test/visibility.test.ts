import { describe, expect, it } from "vitest";
import { createGame } from "../src/game/engine.js";
import { DOOR, GOBLIN, ORC, POTION, RAT, SWORD } from "../src/game/level.js";
import { DEFAULT_FOV_RADIUS } from "../src/game/types.js";
import { callTool, createSession } from "../src/tools.js";
import { boot, cellAt, hiddenStrings, move, okAction, okDynamic, okScreen, okStatic } from "./helpers.js";

const SECRETS = [ORC.id, GOBLIN.id, POTION.id, "healing potion"];

function walkToDoor(session: ReturnType<typeof boot>): void {
  move(session, "n");
  for (let i = 0; i < 8; i++) move(session, "e");
  for (let i = 0; i < 3; i++) move(session, "s");
  move(session, "e");
}

describe("visibility clipping", () => {
  it("cannot be bypassed by asking for the whole map, a hidden rectangle, an id, or an attack", () => {
    const session = boot();
    const queries = [
      callTool(session, "get_screen", {}),
      callTool(session, "get_screen", { x: 0, y: 0, width: 24, height: 16 }),
      callTool(session, "get_screen", { x: ORC.x, y: ORC.y, width: 1, height: 1 }),
      callTool(session, "get_screen", { x: 14, y: 1, width: 9, height: 8 }),
      callTool(session, "get_static_terrain", {}),
      callTool(session, "get_visible_state", {}),
      callTool(session, "inspect", { x: ORC.x, y: ORC.y }),
      callTool(session, "inspect", { entityId: ORC.id }),
      callTool(session, "inspect", { entityId: "does-not-exist" }),
      callTool(session, "attack", { x: ORC.x, y: ORC.y }),
      callTool(session, "attack", { x: POTION.x, y: POTION.y }),
    ];
    for (const payload of queries) hiddenStrings(payload, ...SECRETS);

    const state = okDynamic(callTool(session, "get_visible_state", {}));
    expect(state.entities.some((entity) => entity.id === RAT.id)).toBe(true);
    expect(state.fovRadius).toBe(DEFAULT_FOV_RADIUS);

    const full = okScreen(callTool(session, "get_screen", {}));
    expect(full.cells.some((cell) => cell.x === ORC.x && cell.y === ORC.y)).toBe(false);
    expect(full.cells.some((cell) => cell.x === GOBLIN.x && cell.y === GOBLIN.y)).toBe(false);
    expect(cellAt(full, RAT.x, RAT.y)?.actor?.id).toBe(RAT.id);

    const hiddenRect = okScreen(callTool(session, "get_screen", { x: ORC.x, y: ORC.y, width: 1, height: 1 }));
    expect(hiddenRect.cells).toEqual([]);
    expect(hiddenRect.omitted).toBe(1);

    const terrain = okStatic(callTool(session, "get_static_terrain", {}));
    expect(terrain.tiles.some((tile) => tile.x === ORC.x && tile.y === ORC.y)).toBe(false);

    const unknown = callTool(session, "inspect", { entityId: "does-not-exist" });
    const hidden = callTool(session, "inspect", { entityId: ORC.id });
    expect(hidden).toEqual(unknown);
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error.code).toBe("not_visible");

    const attack = callTool(session, "attack", { x: ORC.x, y: ORC.y });
    expect(attack.ok).toBe(false);
    if (!attack.ok) expect(attack.error.code).toBe("not_visible");

    expect(session.game!.entities.some((entity) => entity.id === ORC.id)).toBe(true);
  });

  it("rejects client fields that would widen vision", () => {
    const session = createSession();
    const rejected = callTool(session, "start_game", { seed: 3, fovRadius: 100, revealAll: true });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("invalid_arguments");

    const started = callTool(session, "start_game", { seed: 3 });
    expect(started.ok).toBe(true);
    if (started.ok && "fovRadius" in started) {
      expect(started.fovRadius).toBe(DEFAULT_FOV_RADIUS);
      expect(started.seed).toBe(3);
    }
    callTool(session, "create_character", { name: "Ada", archetype: "warrior" });
    const cheatScreen = callTool(session, "get_screen", {
      x: 0,
      y: 0,
      width: 24,
      height: 16,
      showHidden: true,
    });
    expect(cheatScreen.ok).toBe(false);
    const screen = okScreen(callTool(session, "get_screen", { x: 0, y: 0, width: 24, height: 16 }));
    hiddenStrings(screen, ...SECRETS);
  });

  it("reveals the goblin through an open door and still hides the orc until you walk in", () => {
    const session = boot({ ai: false });
    walkToDoor(session);
    const opened = okAction(callTool(session, "open_door", { direction: "e" }));
    expect(opened.visibleEntities.some((entity) => entity.id === GOBLIN.id)).toBe(true);
    expect(opened.visibleEntities.some((entity) => entity.id === ORC.id)).toBe(false);
    expect(opened.newlySeenTerrain.some((tile) => tile.x === GOBLIN.x && tile.y === GOBLIN.y)).toBe(true);
    expect(opened.newlySeenTerrain.some((tile) => tile.x === ORC.x && tile.y === ORC.y)).toBe(false);
    expect(opened.staticHash).toBe(okStatic(callTool(session, "get_static_terrain", {})).staticHash);
    hiddenStrings(opened, ORC.id, POTION.id);

    const closed = okAction(callTool(session, "close_door", { direction: "e" }));
    expect(closed.disappearedEntityIds).toContain(GOBLIN.id);
    expect(closed.visibleEntities.some((entity) => entity.id === GOBLIN.id)).toBe(false);
    const after = okDynamic(callTool(session, "get_visible_state", {}));
    hiddenStrings(after, GOBLIN.id, ORC.id, POTION.id);
    const memory = okScreen(callTool(session, "get_screen", { x: GOBLIN.x, y: GOBLIN.y, width: 1, height: 1 }));
    expect(memory.cells).toHaveLength(1);
    expect(memory.cells[0]).toMatchObject({ visible: false, actor: null, items: [], tile: "floor", glyph: "." });
    const looked = callTool(session, "inspect", { x: GOBLIN.x, y: GOBLIN.y });
    expect(looked.ok).toBe(true);
    if (looked.ok && "cell" in looked) {
      expect(looked.cell).toMatchObject({ visible: false, actor: null, items: [] });
    }
    const same = callTool(session, "inspect", { entityId: GOBLIN.id });
    expect(same).toEqual(callTool(session, "inspect", { entityId: "nope" }));

    okAction(callTool(session, "open_door", { direction: "e" }));
    move(session, "e");
    move(session, "e");
    move(session, "e");
    expect(session.game!.player).toMatchObject({ x: 14, y: 4 });
    const inside = okDynamic(callTool(session, "get_visible_state", {}));
    expect(inside.entities.some((entity) => entity.id === ORC.id)).toBe(true);
    expect(inside.entities.find((entity) => entity.id === ORC.id)).toMatchObject({ x: ORC.x, y: ORC.y });
  });

  it("a shorter field of view hides the sword even though the server knows where it is", () => {
    const session = createSession();
    session.game = createGame({ ai: false, fovRadius: 2 });
    okAction(callTool(session, "create_character", { name: "Ada", archetype: "warrior" }));
    const terrain = okStatic(callTool(session, "get_static_terrain", {}));
    expect(terrain.tiles.some((tile) => tile.x === SWORD.x && tile.y === SWORD.y)).toBe(false);
    expect(terrain.tiles.some((tile) => tile.x === RAT.x && tile.y === RAT.y)).toBe(true);
    hiddenStrings(okScreen(callTool(session, "get_screen", {})), SWORD.id, ORC.id);
    expect(session.game!.entities.some((entity) => entity.id === SWORD.id)).toBe(true);
  });
});
