import { describe, expect, it } from "vitest";
import { SWORD } from "../src/game/level.js";
import { tileKey } from "../src/game/types.js";
import { callTool } from "../src/tools.js";
import { boot, cellAt, hiddenStrings, move, okDynamic, okScreen, okStatic } from "./helpers.js";

describe("static and dynamic diffs", () => {
  it("sends explored terrain once and only new tiles afterwards", () => {
    const session = boot({ ai: false });
    const initial = okStatic(callTool(session, "get_static_terrain", {}));
    const seen = new Set(initial.tiles.map((tile) => tileKey(tile.x, tile.y)));
    expect(seen.size).toBeGreaterThan(10);
    expect(initial.staticHash).toMatch(/^[a-f0-9]{64}$/);

    const secondGame = boot({ ai: false });
    expect(okStatic(callTool(secondGame, "get_static_terrain", {})).staticHash).toBe(initial.staticHash);

    // (2,2) -> (4,14), through the south corridor, away from the sword.
    const path = ["s", "e", "e", "s", "s", "s", "s", "s", "s", "s", "s", "s", "s", "s"];
    let discovered = 0;
    for (const direction of path) {
      const step = move(session, direction);
      for (const tile of step.newlySeenTerrain) {
        const key = tileKey(tile.x, tile.y);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        discovered += 1;
      }
      expect(step.staticHash).toBe(initial.staticHash);
      expect(new Set(step.newlySeenTerrain.map((tile) => tileKey(tile.x, tile.y))).size).toBe(
        step.newlySeenTerrain.length,
      );
    }
    expect(session.game!.player).toMatchObject({ x: 4, y: 14 });
    expect(discovered).toBeGreaterThan(0);

    const after = okStatic(callTool(session, "get_static_terrain", {}));
    expect(after.tiles.map((tile) => tileKey(tile.x, tile.y)).sort()).toEqual([...seen].sort());
    expect(after.explored).toBe(seen.size);

    const state = okDynamic(callTool(session, "get_visible_state", {}));
    expect(state.entities.some((entity) => entity.id === SWORD.id)).toBe(false);
    const screen = okScreen(callTool(session, "get_screen", { x: SWORD.x, y: SWORD.y, width: 1, height: 1 }));
    const swordTile = cellAt(screen, SWORD.x, SWORD.y);
    expect(swordTile).toBeTruthy();
    expect(swordTile?.visible).toBe(false);
    expect(swordTile?.items).toEqual([]);
    expect(swordTile?.actor).toBeNull();
    expect(swordTile?.glyph).not.toBe(")");
    hiddenStrings(state, SWORD.id, "short sword");
    hiddenStrings(screen, SWORD.id, "short sword");
  });

  it("create_character's newly seen tiles match the static cache", () => {
    const session = boot({ ai: false, archetype: "mage", name: "Io" });
    const terrain = okStatic(callTool(session, "get_static_terrain", {}));
    const screen = okScreen(callTool(session, "get_screen", {}));
    expect(screen.cells.map((cell) => tileKey(cell.x, cell.y)).sort()).toEqual(
      terrain.tiles.map((tile) => tileKey(tile.x, tile.y)).sort(),
    );
    expect(screen.omitted).toBe(terrain.width * terrain.height - terrain.explored);
    const player = screen.cells.find((cell) => cell.playerHere);
    expect(player?.glyph).toBe("@");
    expect(okDynamic(callTool(session, "get_visible_state", {})).player).toMatchObject({
      archetype: "mage",
      maxHp: 16,
      attack: 7,
      defense: 0,
    });
  });
});
