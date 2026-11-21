import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOOR, GOBLIN, ORC, SWORD } from "../game/level.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Payload = Record<string, unknown>;

function read(result: unknown): Payload {
  if (!result || typeof result !== "object") throw new Error("tool returned no content");
  const record = result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return record.structuredContent as Payload;
  }
  const text = record.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("tool returned no content");
  return JSON.parse(text) as Payload;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Payload> {
  const result = read(await client.callTool({ name, arguments: args }));
  if (result.ok === false) {
    const error = result.error as { code?: string; message?: string };
    throw new Error(`${name} failed: ${error.code ?? ""} ${error.message ?? ""}`);
  }
  return result;
}

function render(screen: Payload): string {
  const width = screen.width as number;
  const height = screen.height as number;
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  for (const cell of screen.cells as Array<{ x: number; y: number; glyph: string }>) {
    rows[cell.y]![cell.x] = cell.glyph;
  }
  return rows.map((row) => row.join("")).join("\n");
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.join(root, "src/index.ts")],
    cwd: root,
    stderr: "inherit",
  });
  const client = new Client({ name: "roguelike-demo", version: "0.1.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const legend = await call(client, "get_legend");
    const started = await call(client, "start_game", { seed: 1 });
    const created = await call(client, "create_character", { name: "Ada", archetype: "warrior" });
    const first = await call(client, "attack", { direction: "e" });
    const second = await call(client, "attack", { direction: "e" });
    await call(client, "move", { direction: "se" });
    await call(client, "move", { direction: "se" });
    await call(client, "move", { direction: "se" });
    const picked = await call(client, "pickup");
    const walk = ["e", "e", "e", "e", "e", "n", "e"];
    for (const direction of walk) await call(client, "move", { direction });
    const opened = await call(client, "open_door", { direction: "e" });
    const screen = await call(client, "get_screen");
    const hidden = await call(client, "get_screen", { x: ORC.x, y: ORC.y, width: 1, height: 1 });
    const terrain = await call(client, "get_static_terrain");

    const player = second.player as { hp: number; x: number; y: number };
    const equipped = picked.player as { attack: number; x: number; y: number };
    const visible = opened.visibleEntities as Array<{ id: string }>;
    if (player.hp !== 29) throw new Error(`expected the rat to hit once, hp=${player.hp}`);
    if ((second.visibleEntities as Array<{ id: string }>).some((entity) => entity.id === "rat-1")) {
      throw new Error("rat survived two attacks");
    }
    if (equipped.attack !== 7 || equipped.x !== SWORD.x) throw new Error("sword was not equipped");
    if (!(visible.some((entity) => entity.id === GOBLIN.id))) throw new Error("goblin was not visible through the open door");
    if (visible.some((entity) => entity.id === ORC.id)) throw new Error("orc leaked through the doorway");
    if ((hidden.cells as unknown[]).length !== 0) throw new Error("hidden screen rect was not empty");
    if (JSON.stringify(hidden).includes(ORC.id)) throw new Error("hidden rect named the orc");
    if ((opened.newlySeenTerrain as Array<{ x: number; y: number }>).some((tile) => tile.x === ORC.x && tile.y === ORC.y)) {
      throw new Error("static diff included the orc tile");
    }
    if (opened.staticHash !== started.staticHash) throw new Error("static hash changed when the door opened");

    console.log(`tools: ${tools.tools.map((tool) => tool.name).join(", ")}`);
    console.log(`legend ${String(legend.legendId)}  level ${String(started.levelId)}  hash ${String(started.staticHash).slice(0, 12)}…`);
    console.log(`Ada opened the door at ${DOOR.x},${DOOR.y}. Explored tiles: ${String(terrain.explored)}.`);
    console.log(render(screen));
    const messages = (opened.messages as Array<{ text: string }>).map((message) => message.text).join(" ");
    console.log(messages);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
