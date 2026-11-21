import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  actionOutput,
  attackInput,
  createCharacterInput,
  directionInput,
  dynamicOutput,
  emptyInput,
  inspectInput,
  inspectOutput,
  legendOutput,
  screenInput,
  screenOutput,
  startGameInput,
  startOutput,
  staticInput,
  staticOutput,
  useItemInput,
} from "./schemas.js";
import { callTool, createSession, fail, type ToolResult } from "./tools.js";

const INSTRUCTIONS = [
  "Single-level turn-based roguelike. You render; this server only returns JSON.",
  "Every tool result is JSON in structuredContent and duplicated as text. Branch on ok, error.code, and message.code — text is a convenience.",
  "Coordinates: x increases east, y increases south, origin top-left, integer tiles.",
  "Call get_legend once. Call start_game, then create_character.",
  "Cache static terrain by levelId + staticHash. Merge newlySeenTerrain. Door open/closed is dynamic (doorChanges, visibleDoors, cell.doorOpen), not part of the hash.",
  "visibleEntities is the authoritative set of monsters and items you can see right now. Drop anything that disappeared. disappearedEntityIds never include a hidden destination.",
  "get_screen omits unexplored tiles. visible:false cells are memory: terrain and last-seen door state only; actor and items are empty. Out-of-sight entities are never returned.",
  "Remembered terrain is returned. Remembered entities are not.",
  "Moving into a monster attacks. Illegal actions do not spend a turn. Combat damage is max(1, attack - defense) with no randomness.",
].join(" ");

interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  readOnly: boolean;
}

function spec(
  name: string,
  title: string,
  description: string,
  inputSchema: unknown,
  outputSchema: unknown,
  readOnly: boolean,
): ToolSpec {
  return { name, title, description, inputSchema, outputSchema, readOnly };
}

type LooseRegister = (
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      openWorldHint?: boolean;
    };
  },
  cb: (args: unknown) => Promise<{
    isError?: boolean;
    content: Array<{ type: "text"; text: string }>;
    structuredContent: Record<string, unknown>;
  }>,
) => void;

export const TOOLS = [
  spec(
    "get_legend",
    "Glyph and rule legend",
    "Return the stable legend (legendId v1): coordinates, glyph meanings, archetypes, combat formula, and the visibility rules. No game required. Call this before interpreting cells.",
    emptyInput,
    legendOutput,
    true,
  ),
  spec(
    "start_game",
    "Start or reset the game",
    "Reset the session to the fixed level. Returns levelId, staticHash, map width/height, and fovRadius. Does not create a character and reveals no tiles. Optional seed is stored and echoed; it does not change the prototype layout. monstersAct is always true.",
    startGameInput,
    startOutput,
    false,
  ),
  spec(
    "create_character",
    "Create the player character",
    "Place a warrior, rogue, or mage on the level and return the first perception diff: newlySeenTerrain for the opening field of view, appearedEntities for monsters and items in sight, and the player object. Does not spend a turn.",
    createCharacterInput,
    actionOutput,
    false,
  ),
  spec(
    "get_static_terrain",
    "Explored static terrain",
    "Return every explored tile kind (wall, floor, door) for the current level, plus levelId and staticHash. Unexplored tiles are omitted. Door open/closed is not included. Safe to cache until staticHash changes (it does not change when doors open).",
    staticInput,
    staticOutput,
    true,
  ),
  spec(
    "get_visible_state",
    "Currently visible dynamic state",
    "Authoritative dynamic snapshot: player, entities you can see right now, visible door states, and the message log. Entities outside the field of view are absent. Does not spend a turn.",
    emptyInput,
    dynamicOutput,
    true,
  ),
  spec(
    "get_screen",
    "Screen grab of known tiles",
    "Return explored cells for the whole map, or for the rectangle x,y,width,height (origin tile plus size, y then x). Unexplored and out-of-bounds cells are counted in omitted and not returned. Each cell has glyph, tile, doorOpen, visible, playerHere, actor, and items. When visible is false, actor and items are empty and glyph is a terrain glyph. This is the screen-grab tool: it is JSON, not pixels.",
    screenInput,
    screenOutput,
    true,
  ),
  spec(
    "move",
    "Move one tile",
    "Move n,s,e,w,ne,nw,se,sw. Walls, closed doors, and diagonal corner cuts return ok:false error.code blocked and do not spend a turn. Moving into a monster attacks it instead. A successful move spends a turn and returns the perception diff.",
    directionInput,
    actionOutput,
    false,
  ),
  spec(
    "attack",
    "Melee attack",
    "Attack an adjacent visible tile by direction or by x,y. Not visible returns not_visible with no tile contents. Out of melee range returns out_of_range. Empty tile returns no_target. A hit spends a turn.",
    attackInput,
    actionOutput,
    false,
  ),
  spec(
    "open_door",
    "Open an adjacent door",
    "Open the closed door in the given direction. Newly seen tiles beyond the door arrive in newlySeenTerrain. The door's new state arrives in doorChanges. Not a door, already open, or not visible does not spend a turn.",
    directionInput,
    actionOutput,
    false,
  ),
  spec(
    "close_door",
    "Close an adjacent door",
    "Close the open door in the given direction. Fails if the doorway is occupied. Entities that drop out of sight are listed by id in disappearedEntityIds and are not given a new position.",
    directionInput,
    actionOutput,
    false,
  ),
  spec(
    "pickup",
    "Pick up the item at your feet",
    "Pick up one item on your tile (lowest id first). Swords add their attackBonus to player.attack automatically. Potions go to inventory and are used with use_item. Fails with no_item without spending a turn.",
    emptyInput,
    actionOutput,
    false,
  ),
  spec(
    "use_item",
    "Use an inventory item",
    "Use inventory[index]. Potions heal min(maxHp, hp + heal) and are consumed. Swords return cannot_use. Missing index returns no_item. A successful use spends a turn.",
    useItemInput,
    actionOutput,
    false,
  ),
  spec(
    "wait",
    "Wait one turn",
    "Spend a turn without moving. Monsters that can see you and are within aggro range still act. Returns the perception diff.",
    emptyInput,
    actionOutput,
    false,
  ),
  spec(
    "inspect",
    "Inspect a visible tile or entity",
    "Look at x,y or entityId without spending a turn. Unexplored tiles and entities that are not currently visible return not_visible, including unknown ids, so a miss does not prove the id exists. Explored but dark tiles return remembered terrain with actor null and items [].",
    inspectInput,
    inspectOutput,
    true,
  ),
];

export function createMcpServer(): McpServer {
  const session = createSession();
  const server = new McpServer(
    { name: "roguelike-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  const register = server.registerTool.bind(server) as unknown as LooseRegister;
  for (const tool of TOOLS) {
    register(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.name === "start_game",
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const result = callTool(session, tool.name, args ?? {});
          return jsonResult(result);
        } catch (error) {
          console.error(error);
          return jsonResult(fail("internal", "The action could not be completed."), true);
        }
      },
    );
  }
  return server;
}

function jsonResult(result: ToolResult, isError = false) {
  const structuredContent = result as unknown as Record<string, unknown>;
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent,
  };
}
