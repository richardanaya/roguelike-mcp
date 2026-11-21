import type { Perception } from "./engine.js";
import type { Entity, GameMessage, GameState, MemoryTile, Player } from "./types.js";
import { LEGEND_ID, LEVEL_ID, SCHEMA_VERSION, tileKey } from "./types.js";
import { effectiveAttack, effectiveDefense } from "./engine.js";

export interface EntityView {
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
  heal: number | null;
  attackBonus: number | null;
}

export interface ItemView {
  index: number;
  id: string;
  kind: "potion" | "sword";
  species: string;
  name: string;
  glyph: string;
  heal: number | null;
  attackBonus: number | null;
}

export interface PlayerView {
  name: string;
  archetype: Player["archetype"];
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  alive: boolean;
  inventory: ItemView[];
}

export interface CellView {
  x: number;
  y: number;
  glyph: string;
  tile: MemoryTile["kind"];
  doorOpen: boolean | null;
  visible: boolean;
  playerHere: boolean;
  actor: EntityView | null;
  items: EntityView[];
}

export interface DoorView {
  x: number;
  y: number;
  open: boolean;
}

export interface StaticTileView {
  x: number;
  y: number;
  kind: MemoryTile["kind"];
}

export interface ActionView {
  ok: true;
  schemaVersion: typeof SCHEMA_VERSION;
  legendId: typeof LEGEND_ID;
  action: string;
  turn: number;
  levelId: string;
  staticHash: string;
  width: number;
  height: number;
  fovRadius: number;
  player: PlayerView;
  died: boolean;
  messages: GameMessage[];
  newlySeenTerrain: StaticTileView[];
  doorChanges: DoorView[];
  disappearedEntityIds: string[];
  appearedEntities: EntityView[];
  updatedEntities: EntityView[];
  visibleEntities: EntityView[];
  visibleDoors: DoorView[];
}

const TERRAIN_GLYPH: Record<string, string> = {
  wall: "#",
  floor: ".",
};

export function entityView(entity: Entity): EntityView {
  return {
    id: entity.id,
    kind: entity.kind,
    species: entity.species,
    name: entity.name,
    glyph: entity.glyph,
    x: entity.x,
    y: entity.y,
    hp: entity.hp,
    maxHp: entity.maxHp,
    attack: entity.attack,
    defense: entity.defense,
    heal: entity.heal,
    attackBonus: entity.attackBonus,
  };
}

export function playerView(player: Player): PlayerView {
  return {
    name: player.name,
    archetype: player.archetype,
    x: player.x,
    y: player.y,
    hp: player.hp,
    maxHp: player.maxHp,
    attack: effectiveAttack(player),
    defense: effectiveDefense(player),
    alive: player.alive,
    inventory: player.inventory.map((item, index) => ({
      index,
      id: item.id,
      kind: item.kind,
      species: item.species,
      name: item.name,
      glyph: item.glyph,
      heal: item.heal,
      attackBonus: item.attackBonus,
    })),
  };
}

function terrainGlyph(memory: MemoryTile): string {
  if (memory.kind === "door") return memory.doorOpen ? "/" : "+";
  return TERRAIN_GLYPH[memory.kind] ?? "?";
}

/**
 * Project one explored tile. Entity fields are filled only when the tile is
 * currently visible. Remembered tiles keep terrain and the last-seen door bit.
 */
export function projectCell(state: GameState, x: number, y: number): CellView | null {
  const memory = state.memory.get(tileKey(x, y));
  if (!memory) return null;
  const visible = state.visible.has(tileKey(x, y));
  const doorOpen = memory.kind === "door" ? (visible ? state.doorOpen[y]![x]! : memory.doorOpen) : null;
  const shown: MemoryTile = { ...memory, doorOpen };
  let playerHere = false;
  let actor: EntityView | null = null;
  const items: EntityView[] = [];
  if (visible && state.player && state.player.x === x && state.player.y === y) playerHere = true;
  if (visible) {
    for (const entity of state.entities) {
      if (entity.x !== x || entity.y !== y) continue;
      if (entity.kind === "monster") actor = entityView(entity);
      else items.push(entityView(entity));
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
  }
  let glyph = terrainGlyph(shown);
  if (visible) {
    if (items[0]) glyph = items[0].glyph;
    if (actor) glyph = actor.glyph;
    if (playerHere) glyph = "@";
  }
  return {
    x,
    y,
    glyph,
    tile: memory.kind,
    doorOpen,
    visible,
    playerHere,
    actor,
    items,
  };
}

export function visibleEntityViews(state: GameState): EntityView[] {
  const views: EntityView[] = [];
  for (const entity of state.entities) {
    if (!state.visible.has(tileKey(entity.x, entity.y))) continue;
    views.push(entityView(entity));
  }
  views.sort((a, b) => a.id.localeCompare(b.id));
  return views;
}

export function visibleDoorViews(state: GameState): DoorView[] {
  const doors: DoorView[] = [];
  for (const key of state.visible) {
    const memory = state.memory.get(key);
    if (!memory || memory.kind !== "door") continue;
    doors.push({ x: memory.x, y: memory.y, open: state.doorOpen[memory.y]![memory.x]! });
  }
  doors.sort((a, b) => a.y - b.y || a.x - b.x);
  return doors;
}

export function exploredTiles(state: GameState): StaticTileView[] {
  const tiles: StaticTileView[] = [];
  for (const memory of state.memory.values()) {
    tiles.push({ x: memory.x, y: memory.y, kind: memory.kind });
  }
  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}

function byPos<T extends { x: number; y: number }>(a: T, b: T): number {
  return a.y - b.y || a.x - b.x;
}

export function projectAction(
  state: GameState,
  before: Perception,
  action: string,
  messages: GameMessage[],
): ActionView {
  const player = state.player;
  if (!player) throw new Error("projectAction requires a character");
  const visibleEntities = visibleEntityViews(state);
  const visibleIds = new Set(visibleEntities.map((entity) => entity.id));
  const appearedEntities: EntityView[] = [];
  const updatedEntities: EntityView[] = [];
  for (const entity of visibleEntities) {
    const previous = before.entities.get(entity.id);
    const next = JSON.stringify(entity);
    if (previous === undefined) appearedEntities.push(entity);
    else if (previous !== next) updatedEntities.push(entity);
  }
  const disappearedEntityIds: string[] = [];
  for (const id of before.entities.keys()) {
    if (!visibleIds.has(id)) disappearedEntityIds.push(id);
  }
  disappearedEntityIds.sort();

  const newlySeenTerrain: StaticTileView[] = [];
  for (const memory of state.memory.values()) {
    if (!before.explored.has(tileKey(memory.x, memory.y))) {
      newlySeenTerrain.push({ x: memory.x, y: memory.y, kind: memory.kind });
    }
  }
  newlySeenTerrain.sort(byPos);

  const doorChanges: DoorView[] = [];
  for (const door of visibleDoorViews(state)) {
    const previous = before.doors.get(tileKey(door.x, door.y));
    if (previous !== door.open) doorChanges.push(door);
  }

  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    action,
    turn: state.turn,
    levelId: LEVEL_ID,
    staticHash: state.staticHash,
    width: state.width,
    height: state.height,
    fovRadius: state.fovRadius,
    player: playerView(player),
    died: !player.alive,
    messages,
    newlySeenTerrain,
    doorChanges,
    disappearedEntityIds,
    appearedEntities,
    updatedEntities,
    visibleEntities,
    visibleDoors: visibleDoorViews(state),
  };
}

export interface ScreenView {
  ok: true;
  schemaVersion: typeof SCHEMA_VERSION;
  legendId: typeof LEGEND_ID;
  levelId: string;
  staticHash: string;
  turn: number;
  width: number;
  height: number;
  request: { x: number; y: number; width: number; height: number } | null;
  omitted: number;
  cells: CellView[];
}

export function projectScreen(
  state: GameState,
  request: { x: number; y: number; width: number; height: number } | null,
): ScreenView {
  const cells: CellView[] = [];
  let omitted = 0;
  if (request) {
    for (let y = request.y; y < request.y + request.height; y++) {
      for (let x = request.x; x < request.x + request.width; x++) {
        const cell = inMap(state, x, y) ? projectCell(state, x, y) : null;
        if (!cell) omitted += 1;
        else cells.push(cell);
      }
    }
  } else {
    for (const memory of state.memory.values()) {
      const cell = projectCell(state, memory.x, memory.y);
      if (cell) cells.push(cell);
    }
    cells.sort(byPos);
    omitted = state.width * state.height - cells.length;
  }
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    levelId: LEVEL_ID,
    staticHash: state.staticHash,
    turn: state.turn,
    width: state.width,
    height: state.height,
    request,
    omitted,
    cells,
  };
}

function inMap(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export interface StaticView {
  ok: true;
  schemaVersion: typeof SCHEMA_VERSION;
  legendId: typeof LEGEND_ID;
  levelId: string;
  staticHash: string;
  width: number;
  height: number;
  explored: number;
  tiles: StaticTileView[];
}

export function projectStatic(state: GameState): StaticView {
  const tiles = state.player ? exploredTiles(state) : [];
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    levelId: LEVEL_ID,
    staticHash: state.staticHash,
    width: state.width,
    height: state.height,
    explored: tiles.length,
    tiles,
  };
}

export interface DynamicView {
  ok: true;
  schemaVersion: typeof SCHEMA_VERSION;
  legendId: typeof LEGEND_ID;
  levelId: string;
  staticHash: string;
  turn: number;
  fovRadius: number;
  player: PlayerView;
  entities: EntityView[];
  doors: DoorView[];
  messages: GameMessage[];
}

export function projectDynamic(state: GameState): DynamicView {
  if (!state.player) throw new Error("projectDynamic requires a character");
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    levelId: LEVEL_ID,
    staticHash: state.staticHash,
    turn: state.turn,
    fovRadius: state.fovRadius,
    player: playerView(state.player),
    entities: visibleEntityViews(state),
    doors: visibleDoorViews(state),
    messages: state.messages,
  };
}
