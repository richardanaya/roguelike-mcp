import * as z from "zod";
import { DIRECTIONS } from "./game/types.js";

const entityView = z.object({
  id: z.string(),
  kind: z.enum(["monster", "item"]),
  species: z.string(),
  name: z.string(),
  glyph: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int().nullable(),
  maxHp: z.number().int().nullable(),
  attack: z.number().int().nullable(),
  defense: z.number().int().nullable(),
  heal: z.number().int().nullable(),
  attackBonus: z.number().int().nullable(),
});

const itemView = z.object({
  index: z.number().int(),
  id: z.string(),
  kind: z.enum(["potion", "sword"]),
  species: z.string(),
  name: z.string(),
  glyph: z.string(),
  heal: z.number().int().nullable(),
  attackBonus: z.number().int().nullable(),
});

const playerView = z.object({
  name: z.string(),
  archetype: z.enum(["warrior", "rogue", "mage"]),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  attack: z.number().int(),
  defense: z.number().int(),
  alive: z.boolean(),
  inventory: z.array(itemView),
});

const message = z.object({
  id: z.number().int(),
  turn: z.number().int(),
  code: z.string(),
  text: z.string(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const doorView = z.object({
  x: z.number().int(),
  y: z.number().int(),
  open: z.boolean(),
});

const staticTile = z.object({
  x: z.number().int(),
  y: z.number().int(),
  kind: z.enum(["wall", "floor", "door"]),
});

const cellView = z.object({
  x: z.number().int(),
  y: z.number().int(),
  glyph: z.string(),
  tile: z.enum(["wall", "floor", "door"]),
  doorOpen: z.boolean().nullable(),
  visible: z.boolean(),
  playerHere: z.boolean(),
  actor: entityView.nullable(),
  items: z.array(entityView),
});

const errorBody = z.object({
  code: z.string(),
  message: z.string(),
});

const base = {
  ok: z.boolean(),
  schemaVersion: z.literal(1),
  legendId: z.literal("v1"),
  error: errorBody.optional(),
};

export const actionOutput = z.object({
  ...base,
  action: z.string().optional(),
  turn: z.number().int().optional(),
  levelId: z.string().optional(),
  staticHash: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fovRadius: z.number().int().optional(),
  player: playerView.optional(),
  died: z.boolean().optional(),
  messages: z.array(message).optional(),
  newlySeenTerrain: z.array(staticTile).optional(),
  doorChanges: z.array(doorView).optional(),
  disappearedEntityIds: z.array(z.string()).optional(),
  appearedEntities: z.array(entityView).optional(),
  updatedEntities: z.array(entityView).optional(),
  visibleEntities: z.array(entityView).optional(),
  visibleDoors: z.array(doorView).optional(),
});

export const screenOutput = z.object({
  ...base,
  levelId: z.string().optional(),
  staticHash: z.string().optional(),
  turn: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  request: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable()
    .optional(),
  omitted: z.number().int().optional(),
  cells: z.array(cellView).optional(),
});

export const staticOutput = z.object({
  ...base,
  levelId: z.string().optional(),
  staticHash: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  explored: z.number().int().optional(),
  tiles: z.array(staticTile).optional(),
});

export const dynamicOutput = z.object({
  ...base,
  levelId: z.string().optional(),
  staticHash: z.string().optional(),
  turn: z.number().int().optional(),
  fovRadius: z.number().int().optional(),
  player: playerView.optional(),
  entities: z.array(entityView).optional(),
  doors: z.array(doorView).optional(),
  messages: z.array(message).optional(),
});

export const inspectOutput = z.object({
  ...base,
  cell: cellView.optional(),
});

export const legendOutput = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  legendId: z.literal("v1"),
  coordinates: z.object({
    origin: z.string(),
    xAxis: z.string(),
    yAxis: z.string(),
    indexing: z.string(),
    movement: z.string(),
    diagonalMovement: z.string(),
    fov: z.string(),
  }),
  visibility: z.object({
    rememberedTerrain: z.literal(true),
    rememberedEntities: z.literal(false),
    unexploredTiles: z.string(),
    fovRadius: z.number().int(),
    aggroRange: z.number().int(),
  }),
  glyphs: z.array(
    z.object({
      glyph: z.string(),
      layer: z.enum(["terrain", "actor", "item"]),
      kind: z.string(),
      blocksMovement: z.boolean().nullable(),
      blocksSight: z.boolean().nullable(),
      doorOpen: z.boolean().nullable(),
    }),
  ),
  archetypes: z.array(
    z.object({
      id: z.enum(["warrior", "rogue", "mage"]),
      maxHp: z.number().int(),
      attack: z.number().int(),
      defense: z.number().int(),
    }),
  ),
  combat: z.object({
    formula: z.string(),
    minimumDamage: z.number().int(),
    randomness: z.literal("none"),
    range: z.string(),
  }),
});

export const startOutput = z.object({
  ...base,
  gameId: z.string().optional(),
  levelId: z.string().optional(),
  staticHash: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fovRadius: z.number().int().optional(),
  turn: z.number().int().optional(),
  seed: z.number().int().nullable().optional(),
  monstersAct: z.boolean().optional(),
});

export const startGameInput = z
  .object({
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .strict();

export const createCharacterInput = z
  .object({
    name: z.string(),
    archetype: z.enum(["warrior", "rogue", "mage"]),
  })
  .strict();

export const directionInput = z
  .object({
    direction: z.enum(DIRECTIONS),
  })
  .strict();

export const attackInput = z
  .object({
    direction: z.enum(DIRECTIONS).optional(),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
  })
  .strict();

export const emptyInput = z.object({}).strict();

export const useItemInput = z
  .object({
    index: z.number().int().min(0),
  })
  .strict();

export const screenInput = z
  .object({
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  })
  .strict();

export const inspectInput = z
  .object({
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    entityId: z.string().optional(),
  })
  .strict();

export const staticInput = z
  .object({
    levelId: z.string().optional(),
  })
  .strict();
