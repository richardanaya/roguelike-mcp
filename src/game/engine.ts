import { computeFov } from "./fov.js";
import { PLAYER_START, buildLevel } from "./level.js";
import {
  AGGRO_RANGE,
  ARCHETYPE_STATS,
  DEFAULT_FOV_RADIUS,
  type Archetype,
  type Direction,
  type Entity,
  type GameMessage,
  type GameState,
  type Player,
  chebyshev,
  directionDelta,
  tileKey,
} from "./types.js";

export interface Perception {
  explored: Set<string>;
  /** id -> JSON of the entity view the client was shown */
  entities: Map<string, string>;
  /** visible door key -> open */
  doors: Map<string, boolean>;
}

export function createGame(options?: {
  seed?: number;
  ai?: boolean;
  fovRadius?: number;
}): GameState {
  const level = buildLevel();
  const fovRadius = options?.fovRadius ?? DEFAULT_FOV_RADIUS;
  return {
    seed: options?.seed ?? null,
    ai: options?.ai !== false,
    fovRadius,
    turn: 0,
    width: level.width,
    height: level.height,
    tiles: level.tiles,
    doorOpen: level.doorOpen,
    staticHash: level.staticHash,
    player: null,
    entities: level.entities.map((entity) => ({ ...entity })),
    explored: new Set(),
    visible: new Set(),
    memory: new Map(),
    messages: [],
    nextMessageId: 1,
  };
}

export function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function blocksSight(state: GameState, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return true;
  const kind = state.tiles[y]![x]!;
  if (kind === "wall") return true;
  if (kind === "door" && !state.doorOpen[y]![x]) return true;
  return false;
}

export function passable(state: GameState, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return false;
  const kind = state.tiles[y]![x]!;
  if (kind === "wall") return false;
  if (kind === "door" && !state.doorOpen[y]![x]) return false;
  return true;
}

/** Diagonal steps are blocked unless both adjacent cardinal tiles are passable. */
export function cornerBlocks(
  passableAt: (x: number, y: number) => boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 || dy === 0) return false;
  return !passableAt(x + dx, y) || !passableAt(x, y + dy);
}

export type StepKind = "ok" | "blocked" | "attack";

export function classifyStep(state: GameState, x: number, y: number, dx: number, dy: number): StepKind {
  const nx = x + dx;
  const ny = y + dy;
  if (!passable(state, nx, ny)) return "blocked";
  if (cornerBlocks((px, py) => passable(state, px, py), x, y, dx, dy)) return "blocked";
  if (monsterAt(state, nx, ny)) return "attack";
  return "ok";
}

export function monsterAt(state: GameState, x: number, y: number): Entity | undefined {
  return state.entities.find((entity) => entity.kind === "monster" && entity.x === x && entity.y === y);
}

export function itemsAt(state: GameState, x: number, y: number): Entity[] {
  return state.entities.filter((entity) => entity.kind === "item" && entity.x === x && entity.y === y);
}

export function effectiveAttack(player: Player): number {
  return player.attack + player.inventory.reduce((sum, item) => sum + (item.attackBonus ?? 0), 0);
}

export function effectiveDefense(player: Player): number {
  return player.defense;
}

export function meleeDamage(attack: number, defense: number): number {
  return Math.max(1, attack - defense);
}

export function refreshVision(state: GameState): void {
  const player = state.player;
  if (!player) {
    state.visible = new Set();
    return;
  }
  state.visible = computeFov(
    player.x,
    player.y,
    state.fovRadius,
    state.width,
    state.height,
    (x, y) => blocksSight(state, x, y),
  );
  for (const key of state.visible) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const kind = state.tiles[y]![x]!;
    state.explored.add(key);
    state.memory.set(key, {
      x,
      y,
      kind,
      doorOpen: kind === "door" ? state.doorOpen[y]![x]! : null,
    });
  }
}

export function emptyPerception(): Perception {
  return { explored: new Set(), entities: new Map(), doors: new Map() };
}

export function snapshotPerception(state: GameState, entityJson: (entity: Entity) => string): Perception {
  const entities = new Map<string, string>();
  const doors = new Map<string, boolean>();
  for (const entity of state.entities) {
    if (state.visible.has(tileKey(entity.x, entity.y))) {
      entities.set(entity.id, entityJson(entity));
    }
  }
  for (const key of state.visible) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (state.tiles[y]![x] === "door") doors.set(key, state.doorOpen[y]![x]!);
  }
  return { explored: new Set(state.explored), entities, doors };
}

export function pushMessage(
  state: GameState,
  code: string,
  data: Record<string, string | number | boolean | null>,
  text: string,
): GameMessage {
  const message: GameMessage = {
    id: state.nextMessageId++,
    turn: state.turn,
    code,
    text,
    data,
  };
  state.messages.push(message);
  if (state.messages.length > 400) state.messages.splice(0, state.messages.length - 400);
  return message;
}

export function placeCharacter(state: GameState, name: string, archetype: Archetype): void {
  const stats = ARCHETYPE_STATS[archetype];
  state.player = {
    name,
    archetype,
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    alive: true,
    inventory: [],
  };
  state.turn = 0;
  refreshVision(state);
  pushMessage(
    state,
    "character_created",
    { name, archetype },
    `${name} the ${archetype} enters the dungeon.`,
  );
}

function monsterSeesPlayer(state: GameState, monster: Entity, player: Player): boolean {
  const radius = monster.vision ?? 6;
  const fov = computeFov(monster.x, monster.y, radius, state.width, state.height, (x, y) =>
    blocksSight(state, x, y),
  );
  return fov.has(tileKey(player.x, player.y));
}

function monsterCanStep(state: GameState, monster: Entity, dx: number, dy: number, player: Player): boolean {
  const nx = monster.x + dx;
  const ny = monster.y + dy;
  if (nx === player.x && ny === player.y) return false;
  if (!passable(state, nx, ny)) return false;
  if (cornerBlocks((x, y) => passable(state, x, y), monster.x, monster.y, dx, dy)) return false;
  if (monsterAt(state, nx, ny)) return false;
  return true;
}

function chooseMonsterStep(state: GameState, monster: Entity, player: Player): { x: number; y: number } | null {
  const dx = Math.sign(player.x - monster.x);
  const dy = Math.sign(player.y - monster.y);
  const options: Array<[number, number]> = [];
  const add = (sx: number, sy: number) => {
    if (sx === 0 && sy === 0) return;
    if (!options.some(([ox, oy]) => ox === sx && oy === sy)) options.push([sx, sy]);
  };
  add(dx, dy);
  add(dx, 0);
  add(0, dy);
  if (dx === 0) {
    add(-1, dy);
    add(1, dy);
  } else if (dy === 0) {
    add(dx, -1);
    add(dx, 1);
  }
  for (const [sx, sy] of options) {
    if (monsterCanStep(state, monster, sx, sy, player)) {
      return { x: monster.x + sx, y: monster.y + sy };
    }
  }
  return null;
}

/** Monster phase. Player FOV is still the pre-refresh set, so visibility checks are stable. */
export function runMonsters(state: GameState): void {
  const player = state.player;
  if (!player?.alive) return;
  const actors = state.entities
    .filter((entity) => entity.kind === "monster")
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const monster of actors) {
    if (!player.alive) return;
    if (!state.entities.includes(monster)) continue;
    const dist = chebyshev(monster.x, monster.y, player.x, player.y);
    if (dist === 1) {
      const damage = meleeDamage(monster.attack ?? 1, effectiveDefense(player));
      player.hp = Math.max(0, player.hp - damage);
      pushMessage(
        state,
        "monster_attacked",
        { entityId: monster.id, damage, playerHp: player.hp },
        `${monster.name} hits you for ${damage}.`,
      );
      if (player.hp === 0) {
        player.alive = false;
        pushMessage(state, "player_died", { killerId: monster.id }, "You die.");
      }
      continue;
    }
    if (dist > AGGRO_RANGE) continue;
    if (!monsterSeesPlayer(state, monster, player)) continue;
    const step = chooseMonsterStep(state, monster, player);
    if (!step) continue;
    const fromX = monster.x;
    const fromY = monster.y;
    const fromVisible = state.visible.has(tileKey(fromX, fromY));
    const toVisible = state.visible.has(tileKey(step.x, step.y));
    monster.x = step.x;
    monster.y = step.y;
    if (!fromVisible && !toVisible) continue;
    if (fromVisible && toVisible) {
      pushMessage(
        state,
        "monster_moved",
        { entityId: monster.id, fromX, fromY, toX: step.x, toY: step.y },
        `${monster.name} moves.`,
      );
    } else if (toVisible) {
      pushMessage(
        state,
        "monster_spotted",
        { entityId: monster.id, toX: step.x, toY: step.y },
        `You spot ${monster.name}.`,
      );
    } else {
      pushMessage(state, "monster_lost", { entityId: monster.id }, `${monster.name} slips out of sight.`);
    }
  }
}

export function spendTurn(state: GameState, act: () => void): void {
  state.turn += 1;
  act();
  // Vision matches the player's new tile before monsters act, so movement
  // messages and the safety check use the same field of view.
  refreshVision(state);
  if (state.ai) runMonsters(state);
}

export function playerAttack(state: GameState, monster: Entity): void {
  const player = state.player!;
  const damage = meleeDamage(effectiveAttack(player), monster.defense ?? 0);
  const hp = (monster.hp ?? 0) - damage;
  monster.hp = hp;
  pushMessage(
    state,
    "attacked",
    { entityId: monster.id, damage, x: monster.x, y: monster.y },
    `You hit ${monster.name} for ${damage}.`,
  );
  if (hp <= 0) {
    state.entities = state.entities.filter((entity) => entity.id !== monster.id);
    pushMessage(state, "killed", { entityId: monster.id }, `${monster.name} dies.`);
  } else {
    pushMessage(state, "damaged", { entityId: monster.id, hp }, `${monster.name} has ${hp} hp.`);
  }
}

export function isValidName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 '-]{0,23}$/.test(name);
}

export { directionDelta };
