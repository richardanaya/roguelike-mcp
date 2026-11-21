import { describe, expect, it } from "vitest";
import { callTool } from "../src/tools.js";
import { boot, move, okAction, okDynamic } from "./helpers.js";

describe("movement", () => {
  it("walks onto a floor tile and refuses a wall without spending a turn", () => {
    const session = boot();
    const north = move(session, "n");
    expect(north.player).toMatchObject({ x: 2, y: 1, hp: 29 });
    expect(north.turn).toBe(1);
    expect(north.messages.some((message) => message.code === "monster_attacked")).toBe(true);
    expect(north.messages.some((message) => message.code === "moved")).toBe(true);

    const blocked = callTool(session, "move", { direction: "n" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("blocked");

    const state = okDynamic(callTool(session, "get_visible_state", {}));
    expect(state.player).toMatchObject({ x: 2, y: 1, hp: 29 });
    expect(state.turn).toBe(1);
  });

  it("moves diagonally and back when both cardinals are open", () => {
    const session = boot({ ai: false });
    const sw = move(session, "sw");
    expect(sw.player).toMatchObject({ x: 1, y: 3 });
    const back = move(session, "ne");
    expect(back.player).toMatchObject({ x: 2, y: 2 });
  });

  it("rejects a move that would leave the map's interior through the border wall", () => {
    const session = boot({ ai: false });
    move(session, "w");
    const blocked = callTool(session, "move", { direction: "w" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("blocked");
    expect(okAction(callTool(session, "wait", {})).player.x).toBe(1);
  });

  it("rejects unknown directions and cheat fields", () => {
    const session = boot({ ai: false });
    const bad = callTool(session, "move", { direction: "north", reveal: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("invalid_arguments");
  });
});
