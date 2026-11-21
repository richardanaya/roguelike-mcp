import { describe, expect, it } from "vitest";
import { computeFov } from "../src/game/fov.js";
import { cornerBlocks } from "../src/game/engine.js";

function grid(rows: string[]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const blocks = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    const ch = rows[y]![x]!;
    return ch === "#" || ch === "+";
  };
  return { width, height, blocks };
}

describe("shadowcasting", () => {
  it("sees a closed door and not the floor behind it", () => {
    const map = grid(["#####", "#@+.#", "#####"]);
    const visible = computeFov(1, 1, 8, map.width, map.height, map.blocks);
    expect(visible.has("2,1")).toBe(true);
    expect(visible.has("3,1")).toBe(false);
  });

  it("sees through an open door", () => {
    const map = grid(["#####", "#@/.#", "#####"]);
    const visible = computeFov(1, 1, 8, map.width, map.height, map.blocks);
    expect(visible.has("2,1")).toBe(true);
    expect(visible.has("3,1")).toBe(true);
  });

  it("does not see past the Euclidean radius", () => {
    const map = grid([".......", ".......", "..@...."]);
    const visible = computeFov(2, 2, 2, map.width, map.height, map.blocks);
    expect(visible.has("3,2")).toBe(true);
    expect(visible.has("4,2")).toBe(true);
    expect(visible.has("5,2")).toBe(false);
  });
});

describe("diagonal movement", () => {
  it("blocks a diagonal when either cardinal neighbor is impassable", () => {
    const open = new Set(["1,0", "0,1", "1,1"]);
    const passable = (x: number, y: number) => open.has(`${x},${y}`);
    expect(cornerBlocks(passable, 0, 0, 1, 1)).toBe(false);
    expect(cornerBlocks(passable, 0, 0, 1, 0)).toBe(false);
    const eastWall = (x: number, y: number) => !(x === 1 && y === 0);
    expect(cornerBlocks(eastWall, 0, 0, 1, 1)).toBe(true);
  });
});
