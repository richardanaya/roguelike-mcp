import { createHash } from "node:crypto";
import type { Entity, TileKind } from "./types.js";

export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 16;

export const PLAYER_START = { x: 2, y: 2 };
export const RAT = { id: "rat-1", x: 3, y: 2 };
export const SWORD = { id: "sword-1", x: 5, y: 5 };
export const STARTER_POTION = { id: "potion-2", x: 2, y: 6 };
export const DOOR = { x: 12, y: 4 };
export const GOBLIN = { id: "goblin-1", x: 16, y: 4 };
export const ORC = { id: "orc-1", x: 21, y: 3 };
export const POTION = { id: "potion-1", x: 21, y: 6 };

export interface Level {
  width: number;
  height: number;
  tiles: TileKind[][];
  doorOpen: boolean[][];
  staticHash: string;
  entities: Entity[];
}

function carve(tiles: TileKind[][], x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) tiles[y]![x] = "floor";
  }
}

function hashTiles(tiles: TileKind[][]): string {
  const body = tiles.map((row) => row.map((kind) => kind[0]).join("")).join("\n");
  return createHash("sha256").update(body).digest("hex");
}

/**
 * One fixed dungeon. `seed` is accepted by start_game but does not alter this layout.
 * `@` player, `r` rat, `)` sword, `!` potions, `+` closed door, `g` goblin, `o` orc.
 *
 *   ########################
 *   #..........###.........#
 *   #.@r.......###.........#
 *   #..........###.......o.#
 *   #...........+...g......#
 *   #....).....###.........#
 *   #.!........###.......!.#
 *   #..........###.........#
 *   #..........###.........#
 *   ####.###################
 *   ####.###################
 *   #..........#############
 *   #..........#############
 *   #..........#############
 *   #..........#############
 *   ########################
 *
 * The east wing is sealed by the closed door at (12, 4). From the tile west of
 * that door, radius 8 sees the goblin and not the orc or the far potion.
 */
export function debugLevelAscii(): string {
  const level = buildLevel();
  const grid: string[][] = level.tiles.map((row) =>
    row.map((kind) => (kind === "wall" ? "#" : kind === "door" ? "+" : ".")),
  );
  grid[PLAYER_START.y]![PLAYER_START.x] = "@";
  for (const entity of level.entities) grid[entity.y]![entity.x] = entity.glyph;
  return grid.map((row) => row.join("")).join("\n");
}

export function buildLevel(): Level {
  const tiles: TileKind[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => "wall" as TileKind),
  );
  const doorOpen: boolean[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => false),
  );

  carve(tiles, 1, 1, 10, 8);
  carve(tiles, 14, 1, 22, 8);
  carve(tiles, 1, 11, 10, 14);
  tiles[4]![11] = "floor";
  tiles[4]![12] = "door";
  tiles[4]![13] = "floor";
  tiles[9]![4] = "floor";
  tiles[10]![4] = "floor";

  const entities: Entity[] = [
    {
      id: RAT.id,
      kind: "monster",
      species: "rat",
      name: "rat",
      glyph: "r",
      x: RAT.x,
      y: RAT.y,
      hp: 8,
      maxHp: 8,
      attack: 3,
      defense: 0,
      vision: 6,
      heal: null,
      attackBonus: null,
    },
    {
      id: GOBLIN.id,
      kind: "monster",
      species: "goblin",
      name: "goblin",
      glyph: "g",
      x: GOBLIN.x,
      y: GOBLIN.y,
      hp: 10,
      maxHp: 10,
      attack: 4,
      defense: 0,
      vision: 6,
      heal: null,
      attackBonus: null,
    },
    {
      id: ORC.id,
      kind: "monster",
      species: "orc",
      name: "orc",
      glyph: "o",
      x: ORC.x,
      y: ORC.y,
      hp: 14,
      maxHp: 14,
      attack: 5,
      defense: 1,
      vision: 5,
      heal: null,
      attackBonus: null,
    },
    {
      id: SWORD.id,
      kind: "item",
      species: "sword",
      name: "short sword",
      glyph: ")",
      x: SWORD.x,
      y: SWORD.y,
      hp: null,
      maxHp: null,
      attack: null,
      defense: null,
      vision: null,
      heal: null,
      attackBonus: 2,
    },
    {
      id: STARTER_POTION.id,
      kind: "item",
      species: "potion",
      name: "minor potion",
      glyph: "!",
      x: STARTER_POTION.x,
      y: STARTER_POTION.y,
      hp: null,
      maxHp: null,
      attack: null,
      defense: null,
      vision: null,
      heal: 8,
      attackBonus: null,
    },
    {
      id: POTION.id,
      kind: "item",
      species: "potion",
      name: "healing potion",
      glyph: "!",
      x: POTION.x,
      y: POTION.y,
      hp: null,
      maxHp: null,
      attack: null,
      defense: null,
      vision: null,
      heal: 8,
      attackBonus: null,
    },
  ];

  for (const entity of entities) {
    const kind = tiles[entity.y]?.[entity.x];
    if (kind !== "floor") {
      throw new Error(`spawn ${entity.id} is on ${kind ?? "void"} at ${entity.x},${entity.y}`);
    }
  }
  if (tiles[PLAYER_START.y]![PLAYER_START.x] !== "floor") {
    throw new Error("player start is not floor");
  }
  if (tiles[DOOR.y]![DOOR.x] !== "door") throw new Error("door tile missing");

  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles,
    doorOpen,
    staticHash: hashTiles(tiles),
    entities,
  };
}
