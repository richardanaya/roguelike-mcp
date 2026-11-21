import type { GameState } from "./types.js";
import { tileKey } from "./types.js";

const TERRAIN_GLYPHS = new Set(["#", ".", "+", "/"]);

function requireVisiblePair(
  record: Record<string, unknown>,
  xKey: string,
  yKey: string,
  path: string,
  state: GameState,
  problems: string[],
): void {
  if (typeof record[xKey] !== "number" || typeof record[yKey] !== "number") return;
  const x = record[xKey] as number;
  const y = record[yKey] as number;
  if (!state.visible.has(tileKey(x, y))) {
    problems.push(`${path} ${xKey},${yKey} ${x},${y} is not visible`);
  }
}

/**
 * Fail closed if a payload carries a hidden entity or an unexplored coordinate.
 * `request` echoes the caller's rectangle and is exempt. `disappearedEntityIds`
 * may name an entity that just left sight, without coordinates.
 */
export function assertClientPayloadSafe(state: GameState, payload: unknown): void {
  const hidden = new Set(
    state.entities
      .filter((entity) => !state.visible.has(tileKey(entity.x, entity.y)))
      .map((entity) => entity.id),
  );
  const problems: string[] = [];
  walk(payload, "$", hidden, state, problems);
  const text = JSON.stringify(scrubAllowedMentions(payload));
  for (const id of hidden) {
    if (text.includes(id)) problems.push(`payload mentions hidden entity ${id}`);
  }
  if (problems.length > 0) {
    throw new Error(`visibility check failed:\n${problems.join("\n")}`);
  }
}

/** Drop the only fields allowed to name an entity that is no longer in sight. */
function scrubAllowedMentions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubAllowedMentions);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.code === "monster_lost" && record.data && typeof record.data === "object") {
    const data = { ...(record.data as Record<string, unknown>) };
    delete data.entityId;
    return { ...scrubRecord(record), data };
  }
  return scrubRecord(record);
}

function scrubRecord(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "disappearedEntityIds") continue;
    copy[key] = scrubAllowedMentions(child);
  }
  return copy;
}

function walk(
  value: unknown,
  path: string,
  hidden: Set<string>,
  state: GameState,
  problems: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, hidden, state, problems));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;

  if (typeof record.id === "string" && hidden.has(record.id)) {
    problems.push(`${path} includes hidden entity ${record.id}`);
  }
  if (record.visible === false && typeof record.glyph === "string" && !TERRAIN_GLYPHS.has(record.glyph)) {
    problems.push(`${path} remembered glyph ${record.glyph}`);
  }
  if (record.visible === false && record.actor) problems.push(`${path} remembered actor`);
  if (record.visible === false && Array.isArray(record.items) && record.items.length > 0) {
    problems.push(`${path} remembered items`);
  }
  if (
    record.visible === false &&
    record.playerHere === true
  ) {
    problems.push(`${path} remembered player`);
  }
  if (typeof record.visible === "boolean" && typeof record.x === "number" && typeof record.y === "number") {
    const actually = state.visible.has(tileKey(record.x, record.y));
    if (record.visible !== actually) problems.push(`${path} visible flag mismatch at ${record.x},${record.y}`);
  }
  if (typeof record.x === "number" && typeof record.y === "number") {
    if (!state.explored.has(tileKey(record.x, record.y))) {
      problems.push(`${path} unexplored coordinate ${record.x},${record.y}`);
    }
  }
  requireVisiblePair(record, "fromX", "fromY", path, state, problems);
  requireVisiblePair(record, "toX", "toY", path, state, problems);
  if (record.code === "monster_lost" && record.data && typeof record.data === "object") {
    const keys = Object.keys(record.data as object);
    if (keys.some((key) => key !== "entityId")) {
      problems.push(`${path} monster_lost carries extra data: ${keys.join(",")}`);
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "request" || key === "disappearedEntityIds") continue;
    walk(child, `${path}.${key}`, hidden, state, problems);
  }
}
