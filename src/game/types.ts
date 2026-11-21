/** Public contract version. Bump when a tool payload changes shape. */
export const SCHEMA_VERSION = 1 as const;

/** Glyph and rule dictionary id. See get_legend. */
export const LEGEND_ID = "v1" as const;

export const LEVEL_ID = "level-1";

/** Euclidean shadowcasting radius. Not a client parameter. */
export const DEFAULT_FOV_RADIUS = 8;

/**
 * Monsters step toward the player only inside this Chebyshev distance,
 * and only with line of sight. Adjacent monsters always attack.
 */
export const AGGRO_RANGE = 4;

export const DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const TILE_KINDS = ["wall", "floor", "door"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export const ARCHETYPES = ["warrior", "rogue", "mage"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface Coord {
  x: number;
  y: number;
}

export interface ArchetypeStats {
  maxHp: number;
  attack: number;
  defense: number;
}

export const ARCHETYPE_STATS: Record<Archetype, ArchetypeStats> = {
  warrior: { maxHp: 30, attack: 5, defense: 2 },
  rogue: { maxHp: 22, attack: 4, defense: 1 },
  mage: { maxHp: 16, attack: 7, defense: 0 },
};

export interface InventoryItem {
  id: string;
  kind: "potion" | "sword";
  species: string;
  name: string;
  glyph: string;
  heal: number | null;
  attackBonus: number | null;
}

export interface Player {
  name: string;
  archetype: Archetype;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  alive: boolean;
  inventory: InventoryItem[];
}

export interface Entity {
  id: string;
  kind: "monster" | "item";
  species: string;
  name: string;
  glyph: string;
  x: number;
  y: number;
  hp: number | null;
  maxHp: number | null;
  attack: number | null;
  defense: number | null;
  vision: number | null;
  heal: number | null;
  attackBonus: number | null;
}

/** Last thing the player perceived about a tile. Never stores entities. */
export interface MemoryTile {
  x: number;
  y: number;
  kind: TileKind;
  doorOpen: boolean | null;
}

export interface GameMessage {
  id: number;
  turn: number;
  code: string;
  text: string;
  data: Record<string, string | number | boolean | null>;
}

export interface GameState {
  seed: number | null;
  ai: boolean;
  fovRadius: number;
  turn: number;
  width: number;
  height: number;
  tiles: TileKind[][];
  doorOpen: boolean[][];
  staticHash: string;
  player: Player | null;
  entities: Entity[];
  explored: Set<string>;
  visible: Set<string>;
  memory: Map<string, MemoryTile>;
  messages: GameMessage[];
  nextMessageId: number;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

export function directionDelta(direction: Direction): Coord {
  switch (direction) {
    case "n":
      return { x: 0, y: -1 };
    case "s":
      return { x: 0, y: 1 };
    case "e":
      return { x: 1, y: 0 };
    case "w":
      return { x: -1, y: 0 };
    case "ne":
      return { x: 1, y: -1 };
    case "nw":
      return { x: -1, y: -1 };
    case "se":
      return { x: 1, y: 1 };
    case "sw":
      return { x: -1, y: 1 };
  }
}
