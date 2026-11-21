import { describe, expect, it } from "vitest";
import { DOOR, GOBLIN, ORC } from "../src/game/level.js";
import { callTool } from "../src/tools.js";
import { boot, hiddenStrings, move, okAction, okStatic } from "./helpers.js";

function walkToDoor(session: ReturnType<typeof boot>): void {
  move(session, "n");
  for (let i = 0; i < 8; i++) move(session, "e");
  for (let i = 0; i < 3; i++) move(session, "s");
  const last = move(session, "e");
  expect(last.player).toMatchObject({ x: DOOR.x - 1, y: DOOR.y });
}

describe("doors", () => {
  it("blocks on a closed door, then opens it without changing the static hash", () => {
    const session = boot({ ai: false });
    const hash = okStatic(callTool(session, "get_static_terrain", {})).staticHash;
    walkToDoor(session);
    const turn = session.game!.turn;

    const bump = callTool(session, "move", { direction: "e" });
    expect(bump.ok).toBe(false);
    if (!bump.ok) expect(bump.error.code).toBe("blocked");
    expect(session.game!.turn).toBe(turn);
    expect(session.game!.player).toMatchObject({ x: DOOR.x - 1, y: DOOR.y });

    const opened = okAction(callTool(session, "open_door", { direction: "e" }));
    expect(opened.staticHash).toBe(hash);
    expect(opened.doorChanges).toContainEqual({ x: DOOR.x, y: DOOR.y, open: true });
    expect(opened.visibleDoors).toContainEqual({ x: DOOR.x, y: DOOR.y, open: true });
    expect(opened.visibleEntities.some((entity) => entity.id === GOBLIN.id)).toBe(true);
    expect(opened.visibleEntities.some((entity) => entity.id === ORC.id)).toBe(false);

    const terrain = okStatic(callTool(session, "get_static_terrain", {}));
    expect(terrain.staticHash).toBe(hash);
    expect(terrain.tiles.find((tile) => tile.x === DOOR.x && tile.y === DOOR.y)?.kind).toBe("door");

    const stepped = move(session, "e");
    expect(stepped.player).toMatchObject({ x: DOOR.x, y: DOOR.y });
  });

  it("closes a door and refuses to open a wall", () => {
    const session = boot({ ai: false });
    walkToDoor(session);
    okAction(callTool(session, "open_door", { direction: "e" }));
    const closed = okAction(callTool(session, "close_door", { direction: "e" }));
    expect(closed.doorChanges).toContainEqual({ x: DOOR.x, y: DOOR.y, open: false });
    const again = callTool(session, "close_door", { direction: "e" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("already_closed");

    const wall = callTool(session, "open_door", { direction: "n" });
    expect(wall.ok).toBe(false);
    if (!wall.ok) expect(wall.error.code).toBe("not_a_door");
    hiddenStrings(wall, ORC.id, GOBLIN.id);
  });
});
