import * as z from "zod";
import {
  classifyStep,
  createGame,
  directionDelta,
  emptyPerception,
  inBounds,
  isValidName,
  itemsAt,
  monsterAt,
  placeCharacter,
  playerAttack,
  pushMessage,
  snapshotPerception,
  spendTurn,
} from "./game/engine.js";
import type { Entity, GameState } from "./game/types.js";
import {
  AGGRO_RANGE,
  ARCHETYPE_STATS,
  DEFAULT_FOV_RADIUS,
  LEGEND_ID,
  LEVEL_ID,
  SCHEMA_VERSION,
  tileKey,
  type Direction,
} from "./game/types.js";
import { assertClientPayloadSafe } from "./game/safety.js";
import {
  entityView,
  projectAction,
  projectCell,
  projectDynamic,
  projectScreen,
  projectStatic,
  type ActionView,
} from "./game/view.js";
import type { Perception } from "./game/engine.js";
import {
  attackInput,
  createCharacterInput,
  directionInput,
  emptyInput,
  inspectInput,
  screenInput,
  startGameInput,
  staticInput,
  useItemInput,
} from "./schemas.js";

export interface Session {
  game: GameState | null;
  serial: number;
}

export function createSession(): Session {
  return { game: null, serial: 0 };
}

export interface ErrorView {
  ok: false;
  schemaVersion: typeof SCHEMA_VERSION;
  legendId: typeof LEGEND_ID;
  error: { code: string; message: string };
}

export function fail(code: string, message: string): ErrorView {
  return {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    error: { code, message },
  };
}

function checked<T>(state: GameState, result: T): T {
  assertClientPayloadSafe(state, result);
  return result;
}

function perception(state: GameState): Perception {
  return snapshotPerception(state, (entity) => JSON.stringify(entityView(entity)));
}

function finish(state: GameState, before: Perception, action: string, messageStart: number): ActionView {
  const result = projectAction(state, before, action, state.messages.slice(messageStart));
  assertClientPayloadSafe(state, result);
  return result;
}

function requireGame(session: Session): GameState | ErrorView {
  if (!session.game) return fail("no_game", "No game is running. Call start_game first.");
  return session.game;
}

function requireActor(session: Session, allowDead = false): GameState | ErrorView {
  const game = requireGame(session);
  if ("ok" in game) return game;
  if (!game.player) return fail("no_character", "Create a character before acting.");
  if (!allowDead && !game.player.alive) return fail("dead", "You are dead. Call start_game to play again.");
  return game;
}

function isError(value: GameState | ErrorView): value is ErrorView {
  return "ok" in value;
}

export function legendPayload() {
  return {
    ok: true as const,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    coordinates: {
      origin: "top-left",
      xAxis: "east",
      yAxis: "south",
      indexing: "zero-based integer tiles",
      movement: "8-directional, each step costs one turn, adjacency is Chebyshev distance 1",
      diagonalMovement: "blocked unless both adjacent cardinal tiles are passable",
      fov: "recursive shadowcasting, Euclidean radius",
    },
    visibility: {
      rememberedTerrain: true as const,
      rememberedEntities: false as const,
      unexploredTiles: "omitted",
      fovRadius: DEFAULT_FOV_RADIUS,
      aggroRange: AGGRO_RANGE,
    },
    glyphs: [
      { glyph: "#", layer: "terrain" as const, kind: "wall", blocksMovement: true, blocksSight: true, doorOpen: null },
      { glyph: ".", layer: "terrain" as const, kind: "floor", blocksMovement: false, blocksSight: false, doorOpen: null },
      { glyph: "+", layer: "terrain" as const, kind: "door", blocksMovement: true, blocksSight: true, doorOpen: false },
      { glyph: "/", layer: "terrain" as const, kind: "door", blocksMovement: false, blocksSight: false, doorOpen: true },
      { glyph: "@", layer: "actor" as const, kind: "player", blocksMovement: null, blocksSight: null, doorOpen: null },
      { glyph: "r", layer: "actor" as const, kind: "rat", blocksMovement: null, blocksSight: null, doorOpen: null },
      { glyph: "g", layer: "actor" as const, kind: "goblin", blocksMovement: null, blocksSight: null, doorOpen: null },
      { glyph: "o", layer: "actor" as const, kind: "orc", blocksMovement: null, blocksSight: null, doorOpen: null },
      { glyph: "!", layer: "item" as const, kind: "potion", blocksMovement: null, blocksSight: null, doorOpen: null },
      { glyph: ")", layer: "item" as const, kind: "sword", blocksMovement: null, blocksSight: null, doorOpen: null },
    ],
    archetypes: (Object.entries(ARCHETYPE_STATS) as Array<[keyof typeof ARCHETYPE_STATS, (typeof ARCHETYPE_STATS)["warrior"]]>).map(
      ([id, stats]) => ({ id, ...stats }),
    ),
    combat: {
      formula: "max(1, attack - defense)",
      minimumDamage: 1,
      randomness: "none" as const,
      range: "adjacent",
    },
  };
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T | ErrorView {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return fail("invalid_arguments", parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

export function callTool(session: Session, name: string, raw: unknown) {
  switch (name) {
    case "get_legend":
      return legendPayload();
    case "start_game":
      return startGame(session, raw);
    case "create_character":
      return createCharacter(session, raw);
    case "get_static_terrain":
      return staticTerrain(session, raw);
    case "get_visible_state":
      return visibleState(session, raw);
    case "get_screen":
      return screen(session, raw);
    case "move":
      return move(session, raw);
    case "attack":
      return attack(session, raw);
    case "open_door":
      return openDoor(session, raw);
    case "close_door":
      return closeDoor(session, raw);
    case "pickup":
      return pickup(session, raw);
    case "wait":
      return wait(session, raw);
    case "use_item":
      return useItem(session, raw);
    case "inspect":
      return inspect(session, raw);
    default:
      return fail("unknown_tool", `Unknown tool ${name}.`);
  }
}

function startGame(session: Session, raw: unknown) {
  const args = parse(startGameInput, raw);
  if ("ok" in args) return args;
  session.serial += 1;
  const game = createGame({ seed: args.seed, ai: true, fovRadius: DEFAULT_FOV_RADIUS });
  session.game = game;
  const result = {
    ok: true as const,
    schemaVersion: SCHEMA_VERSION,
    legendId: LEGEND_ID,
    gameId: `game-${session.serial}`,
    levelId: LEVEL_ID,
    staticHash: game.staticHash,
    width: game.width,
    height: game.height,
    fovRadius: game.fovRadius,
    turn: game.turn,
    seed: game.seed,
    monstersAct: game.ai,
  };
  return checked(game, result);
}

function createCharacter(session: Session, raw: unknown) {
  const game = requireGame(session);
  if (isError(game)) return game;
  if (game.player) return fail("character_exists", "A character already exists. Call start_game to reset.");
  const args = parse(createCharacterInput, raw);
  if ("ok" in args) return args;
  const name = args.name.trim();
  if (!isValidName(name)) {
    return fail("invalid_name", "Name must start with a letter and be at most 24 characters.");
  }
  const before = emptyPerception();
  placeCharacter(game, name, args.archetype);
  return finish(game, before, "create_character", 0);
}

function staticTerrain(session: Session, raw: unknown) {
  const game = requireGame(session);
  if (isError(game)) return game;
  const args = parse(staticInput, raw);
  if ("ok" in args) return args;
  if (args.levelId && args.levelId !== LEVEL_ID) return fail("unknown_level", "That level is not loaded.");
  return checked(game, projectStatic(game));
}

function visibleState(session: Session, raw: unknown = {}) {
  const args = parse(emptyInput, raw);
  if ("ok" in args) return args;
  const game = requireActor(session, true);
  if (isError(game)) return game;
  return checked(game, projectDynamic(game));
}

function screen(session: Session, raw: unknown) {
  const game = requireActor(session, true);
  if (isError(game)) return game;
  const args = parse(screenInput, raw);
  if ("ok" in args) return args;
  const provided = [args.x, args.y, args.width, args.height].filter((value) => value !== undefined);
  if (provided.length !== 0 && provided.length !== 4) {
    return fail("invalid_rect", "Provide x, y, width, and height together, or omit all of them.");
  }
  if (args.width !== undefined && (args.width < 1 || args.width > 128 || args.height! < 1 || args.height! > 128)) {
    return fail("invalid_rect", "width and height must be between 1 and 128.");
  }
  const request =
    args.x === undefined
      ? null
      : { x: args.x, y: args.y!, width: args.width!, height: args.height! };
  return checked(game, projectScreen(game, request));
}

function move(session: Session, raw: unknown) {
  const game = requireActor(session);
  if (isError(game)) return game;
  const args = parse(directionInput, raw);
  if ("ok" in args) return args;
  const player = game.player!;
  const delta = directionDelta(args.direction);
  const step = classifyStep(game, player.x, player.y, delta.x, delta.y);
  if (step === "blocked") return fail("blocked", "That way is blocked.");
  if (step === "attack") {
    const monster = monsterAt(game, player.x + delta.x, player.y + delta.y)!;
    if (!game.visible.has(tileKey(monster.x, monster.y))) {
      return fail("not_visible", "That tile is not currently visible.");
    }
    return resolveAttack(game, monster);
  }
  const before = perception(game);
  const start = game.messages.length;
  spendTurn(game, () => {
    player.x += delta.x;
    player.y += delta.y;
    pushMessage(game, "moved", { x: player.x, y: player.y, direction: args.direction }, `Moved ${args.direction}.`);
  });
  return finish(game, before, "move", start);
}

function attack(session: Session, raw: unknown) {
  const game = requireActor(session);
  if (isError(game)) return game;
  const args = parse(attackInput, raw);
  if ("ok" in args) return args;
  const player = game.player!;
  let x: number;
  let y: number;
  const hasDirection = args.direction !== undefined;
  const hasPoint = args.x !== undefined || args.y !== undefined;
  if (hasDirection === hasPoint) return fail("invalid_target", "Provide a direction or both x and y, not both.");
  if (args.direction) {
    const delta = directionDelta(args.direction as Direction);
    x = player.x + delta.x;
    y = player.y + delta.y;
  } else if (args.x !== undefined && args.y !== undefined) {
    x = args.x;
    y = args.y;
  } else {
    return fail("invalid_target", "Provide both x and y.");
  }
  if (!inBounds(game, x, y)) return fail("out_of_bounds", "That tile is outside the map.");
  if (!game.visible.has(tileKey(x, y))) return fail("not_visible", "That tile is not currently visible.");
  if (Math.max(Math.abs(player.x - x), Math.abs(player.y - y)) !== 1) {
    return fail("out_of_range", "You can only attack an adjacent tile.");
  }
  const monster = monsterAt(game, x, y);
  if (!monster) return fail("no_target", "Nothing there to attack.");
  return resolveAttack(game, monster);
}

function resolveAttack(game: GameState, monster: Entity) {
  const before = perception(game);
  const start = game.messages.length;
  spendTurn(game, () => playerAttack(game, monster));
  return finish(game, before, "attack", start);
}

function openDoor(session: Session, raw: unknown) {
  return doorAction(session, raw, "open");
}

function closeDoor(session: Session, raw: unknown) {
  return doorAction(session, raw, "close");
}

function doorAction(session: Session, raw: unknown, mode: "open" | "close") {
  const game = requireActor(session);
  if (isError(game)) return game;
  const args = parse(directionInput, raw);
  if ("ok" in args) return args;
  const player = game.player!;
  const delta = directionDelta(args.direction);
  const x = player.x + delta.x;
  const y = player.y + delta.y;
  if (!inBounds(game, x, y)) return fail("out_of_bounds", "That tile is outside the map.");
  if (!game.visible.has(tileKey(x, y))) return fail("not_visible", "That tile is not currently visible.");
  if (game.tiles[y]![x] !== "door") return fail("not_a_door", "There is no door there.");
  const open = game.doorOpen[y]![x]!;
  if (mode === "open" && open) return fail("already_open", "That door is already open.");
  if (mode === "close" && !open) return fail("already_closed", "That door is already closed.");
  if (mode === "close" && monsterAt(game, x, y)) return fail("blocked", "Something is in the doorway.");
  const before = perception(game);
  const start = game.messages.length;
  spendTurn(game, () => {
    game.doorOpen[y]![x] = mode === "open";
    pushMessage(
      game,
      mode === "open" ? "door_opened" : "door_closed",
      { x, y, open: mode === "open" },
      mode === "open" ? "You open the door." : "You close the door.",
    );
  });
  return finish(game, before, mode === "open" ? "open_door" : "close_door", start);
}

function pickup(session: Session, raw: unknown = {}) {
  const args = parse(emptyInput, raw);
  if ("ok" in args) return args;
  const game = requireActor(session);
  if (isError(game)) return game;
  const player = game.player!;
  const items = itemsAt(game, player.x, player.y).sort((a, b) => a.id.localeCompare(b.id));
  const item = items[0];
  if (!item) return fail("no_item", "Nothing here to pick up.");
  const before = perception(game);
  const start = game.messages.length;
  spendTurn(game, () => {
    game.entities = game.entities.filter((entity) => entity.id !== item.id);
    player.inventory.push({
      id: item.id,
      kind: item.species === "sword" ? "sword" : "potion",
      species: item.species,
      name: item.name,
      glyph: item.glyph,
      heal: item.heal,
      attackBonus: item.attackBonus,
    });
    pushMessage(
      game,
      "picked_up",
      { entityId: item.id, name: item.name, attackBonus: item.attackBonus, heal: item.heal },
      `Picked up ${item.name}.`,
    );
  });
  return finish(game, before, "pickup", start);
}

function useItem(session: Session, raw: unknown) {
  const game = requireActor(session);
  if (isError(game)) return game;
  const args = parse(useItemInput, raw);
  if ("ok" in args) return args;
  const player = game.player!;
  const item = player.inventory[args.index];
  if (!item) return fail("no_item", "No item at that inventory index.");
  if (item.kind !== "potion" || item.heal === null) return fail("cannot_use", "That item cannot be used.");
  const before = perception(game);
  const start = game.messages.length;
  const heal = item.heal;
  spendTurn(game, () => {
    const gained = Math.min(player.maxHp, player.hp + heal) - player.hp;
    player.hp += gained;
    player.inventory.splice(args.index, 1);
    pushMessage(game, "healed", { amount: gained, hp: player.hp, entityId: item.id }, `You heal ${gained}.`);
  });
  return finish(game, before, "use_item", start);
}

function wait(session: Session, raw: unknown = {}) {
  const args = parse(emptyInput, raw);
  if ("ok" in args) return args;
  const game = requireActor(session);
  if (isError(game)) return game;
  const before = perception(game);
  const start = game.messages.length;
  spendTurn(game, () => {
    pushMessage(game, "waited", {}, "You wait.");
  });
  return finish(game, before, "wait", start);
}

function inspect(session: Session, raw: unknown) {
  const game = requireActor(session, true);
  if (isError(game)) return game;
  const args = parse(inspectInput, raw);
  if ("ok" in args) return args;
  const hasPoint = args.x !== undefined || args.y !== undefined;
  if (args.entityId && hasPoint) return fail("invalid_target", "Provide entityId or x and y, not both.");
  if (args.entityId) {
    const entity = game.entities.find((candidate) => candidate.id === args.entityId);
    if (!entity || !game.visible.has(tileKey(entity.x, entity.y))) {
      return fail("not_visible", "That is not currently visible.");
    }
    const cell = projectCell(game, entity.x, entity.y);
    if (!cell) return fail("not_visible", "That is not currently visible.");
    return checked(game, { ok: true as const, schemaVersion: SCHEMA_VERSION, legendId: LEGEND_ID, cell });
  }
  if (args.x === undefined || args.y === undefined) return fail("invalid_target", "Provide entityId or both x and y.");
  if (!inBounds(game, args.x, args.y)) return fail("out_of_bounds", "That tile is outside the map.");
  const cell = projectCell(game, args.x, args.y);
  if (!cell) return fail("not_visible", "That tile is not currently visible.");
  return checked(game, { ok: true as const, schemaVersion: SCHEMA_VERSION, legendId: LEGEND_ID, cell });
}

export type ToolResult = ReturnType<typeof callTool>;

