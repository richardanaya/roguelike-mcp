import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { ORC, RAT } from "../src/game/level.js";
import { createMcpServer, TOOLS } from "../src/server.js";

const clientHolder: { client?: Client; server?: ReturnType<typeof createMcpServer> } = {};

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "roguelike-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  clientHolder.client = client;
  clientHolder.server = server;
  return client;
}

afterEach(async () => {
  await clientHolder.client?.close();
  await clientHolder.server?.close();
  clientHolder.client = undefined;
  clientHolder.server = undefined;
});

function payload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") throw new Error("tool returned no JSON");
  const record = result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return record.structuredContent as Record<string, unknown>;
  }
  const text = record.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("tool returned no JSON");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP server", () => {
  it("lists every tool and plays a clipped turn over the protocol", async () => {
    const client = await connect();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
    }

    const legend = payload(await client.callTool({ name: "get_legend", arguments: {} }));
    expect(legend.legendId).toBe("v1");
    expect(legend.visibility).toMatchObject({ rememberedTerrain: true, rememberedEntities: false });

    const started = payload(await client.callTool({ name: "start_game", arguments: { seed: 1 } }));
    expect(started).toMatchObject({ ok: true, seed: 1, fovRadius: 8, levelId: "level-1" });

    const created = payload(
      await client.callTool({
        name: "create_character",
        arguments: { name: "Ada", archetype: "warrior" },
      }),
    );
    expect(created.ok).toBe(true);
    expect(JSON.stringify(created)).not.toContain(ORC.id);
    expect(JSON.stringify(created)).toContain(RAT.id);

    const attacked = payload(await client.callTool({ name: "attack", arguments: { direction: "e" } }));
    expect(attacked.ok).toBe(true);
    const player = attacked.player as { hp: number };
    expect(player.hp).toBe(29);

    const hidden = payload(
      await client.callTool({
        name: "get_screen",
        arguments: { x: ORC.x, y: ORC.y, width: 2, height: 2 },
      }),
    );
    expect(hidden.cells).toEqual([]);
    expect(hidden.omitted).toBe(4);
    expect(JSON.stringify(hidden)).not.toContain(ORC.id);
  });
});
