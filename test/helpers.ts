import { expect } from "vitest";
import { callTool, createSession, type Session, type ToolResult } from "../src/tools.js";
import type { ActionView, CellView, DynamicView, ScreenView, StaticView } from "../src/game/view.js";

export function boot(options?: { ai?: boolean; archetype?: "warrior" | "rogue" | "mage"; name?: string }): Session {
  const session = createSession();
  const started = callTool(session, "start_game", {});
  expect(started.ok).toBe(true);
  if (options?.ai === false && session.game) session.game.ai = false;
  const created = callTool(session, "create_character", {
    name: options?.name ?? "Ada",
    archetype: options?.archetype ?? "warrior",
  });
  expect(created.ok).toBe(true);
  return session;
}

export function okAction(result: ToolResult): ActionView {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as ActionView;
}

export function okScreen(result: ToolResult): ScreenView {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as ScreenView;
}

export function okStatic(result: ToolResult): StaticView {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as StaticView;
}

export function okDynamic(result: ToolResult): DynamicView {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as DynamicView;
}

export function move(session: Session, direction: string): ActionView {
  return okAction(callTool(session, "move", { direction }));
}

export function cellAt(screen: ScreenView, x: number, y: number): CellView | undefined {
  return screen.cells.find((cell) => cell.x === x && cell.y === y);
}

export function hiddenStrings(result: unknown, ...secrets: string[]): void {
  const text = JSON.stringify(result);
  for (const secret of secrets) {
    expect(text, `leaked ${secret}`).not.toContain(secret);
  }
}
