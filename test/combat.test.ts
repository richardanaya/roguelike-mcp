import { describe, expect, it } from "vitest";
import { meleeDamage } from "../src/game/engine.js";
import { RAT, STARTER_POTION, SWORD } from "../src/game/level.js";
import { callTool } from "../src/tools.js";
import { boot, move, okAction } from "./helpers.js";

describe("combat", () => {
  it("uses a deterministic damage formula", () => {
    expect(meleeDamage(5, 0)).toBe(5);
    expect(meleeDamage(3, 2)).toBe(1);
    expect(meleeDamage(1, 9)).toBe(1);
  });

  it("hurts the rat, takes a hit, and kills it on the second attack", () => {
    const session = boot();
    const first = okAction(callTool(session, "attack", { direction: "e" }));
    const rat = first.visibleEntities.find((entity) => entity.id === RAT.id);
    expect(rat).toMatchObject({ hp: 3, x: RAT.x, y: RAT.y });
    expect(first.player.hp).toBe(29);
    expect(first.messages.some((message) => message.code === "damaged" && message.data.entityId === RAT.id)).toBe(true);
    expect(first.messages.some((message) => message.code === "monster_attacked" && message.data.damage === 1)).toBe(true);
    expect(first.player).toMatchObject({ x: 2, y: 2 });

    const second = okAction(callTool(session, "attack", { x: RAT.x, y: RAT.y }));
    expect(second.visibleEntities.some((entity) => entity.id === RAT.id)).toBe(false);
    expect(second.disappearedEntityIds).toContain(RAT.id);
    expect(second.player.hp).toBe(29);
    expect(second.messages.some((message) => message.code === "killed" && message.data.entityId === RAT.id)).toBe(true);
    expect(second.messages.some((message) => message.code === "monster_attacked")).toBe(false);
  });

  it("treats bumping a monster as an attack and does not move onto its tile", () => {
    const session = boot({ ai: false });
    const bump = move(session, "e");
    expect(bump.action).toBe("attack");
    expect(bump.player).toMatchObject({ x: 2, y: 2, hp: 30 });
    expect(bump.visibleEntities.find((entity) => entity.id === RAT.id)?.hp).toBe(3);
  });

  it("equips a sword on pickup and heals from a potion", () => {
    const session = boot({ ai: false });
    move(session, "se");
    move(session, "se");
    const equipped = move(session, "se");
    expect(equipped.player).toMatchObject({ x: SWORD.x, y: SWORD.y, attack: 5 });
    const picked = okAction(callTool(session, "pickup", {}));
    expect(picked.player.attack).toBe(7);
    expect(picked.player.inventory.map((item) => item.id)).toEqual([SWORD.id]);
    expect(picked.messages.some((message) => message.code === "picked_up")).toBe(true);

    session.game!.player!.hp = 10;
    for (let y = SWORD.y; y < STARTER_POTION.y; y++) move(session, "s");
    move(session, "w");
    move(session, "w");
    move(session, "w");
    expect(session.game!.player).toMatchObject({ x: STARTER_POTION.x, y: STARTER_POTION.y });
    okAction(callTool(session, "pickup", {}));
    const healed = okAction(callTool(session, "use_item", { index: 1 }));
    expect(healed.player.hp).toBe(18);
    expect(healed.player.inventory.map((item) => item.id)).toEqual([SWORD.id]);
    expect(healed.messages.some((message) => message.code === "healed" && message.data.amount === 8)).toBe(true);

    const sword = callTool(session, "use_item", { index: 0 });
    expect(sword.ok).toBe(false);
    if (!sword.ok) expect(sword.error.code).toBe("cannot_use");
  });

  it("ends the game when the player dies and still allows a screen grab", () => {
    const session = boot();
    session.game!.player!.hp = 1;
    const death = move(session, "n");
    expect(death.died).toBe(true);
    expect(death.player).toMatchObject({ alive: false, hp: 0 });
    const after = callTool(session, "wait", {});
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("dead");
    const screen = callTool(session, "get_screen", {});
    expect(screen.ok).toBe(true);
  });
});
