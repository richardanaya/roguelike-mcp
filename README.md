# roguelike-mcp

A one-level roguelike exposed entirely as an [MCP](https://modelcontextprotocol.io) server. The server never draws a picture. It returns structured JSON so an agent that writes and runs code can render, cache, and decide.

This is a prototype: one hand-built dungeon, three monsters, a sword, two potions, and a closed door. It is enough to start a game, create a character, move, fight, open doors, pick things up, and query the screen in a loop without ever seeing a hidden tile.

## Why TypeScript and the official SDK

The server is TypeScript on Node, using `@modelcontextprotocol/sdk` over stdio.

- Tool inputs and outputs are Zod schemas. The SDK publishes them as JSON Schema and checks `structuredContent` before the result leaves the process.
- Stdio is the transport Claude Desktop and Cursor already launch. There is no port and no HTTP session to invent.
- The game rules are plain functions. Tests call those functions directly, and one test drives the real MCP client against an in-memory transport, so a schema mismatch fails the suite.

Python or a Streamable HTTP transport would also work. Stdio plus the official TypeScript SDK is the smallest path that still gives typed structured output.

## Setup

Requires Node.js 18 or newer.

```bash
npm install
npm test
npm run build
npm start          # stdio MCP server: node dist/index.js
npm run demo       # scripted client, a few turns, then a local ASCII render
```

`npm run dev` is the same server under `tsx`, without a build. The demo spawns `node --import tsx src/index.ts` itself.

Nothing is written to stdout except MCP messages. Diagnostics, if a visibility check ever trips, go to stderr.

## Connect a client

Build first so the path points at `dist/index.js`. Replace the path with this checkout.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "roguelike": {
      "command": "node",
      "args": ["/absolute/path/to/roguelike-mcp/dist/index.js"]
    }
  }
}
```

Cursor (`.cursor/mcp.json` or the MCP settings UI):

```json
{
  "mcpServers": {
    "roguelike": {
      "command": "node",
      "args": ["/absolute/path/to/roguelike-mcp/dist/index.js"]
    }
  }
}
```

Without a build step, `args` can be `["--import", "tsx", "/absolute/path/to/roguelike-mcp/src/index.ts"]` and `command` stays `node`. `tsx` must be installed (`npm install`).

The server's `instructions` field repeats the contract below in short form. `get_legend` is the machine-readable version of the glyph table and the visibility rules.

## Contract for code-mode agents

Every tool result is JSON. It is in `structuredContent` and copied into the text block for clients that only show text. Branch on `ok`, `error.code`, and `message.code`. The `text` on a message is a convenience, not the contract.

`schemaVersion` is `1`. `legendId` is `"v1"`.

### Coordinates

- Origin is the top-left tile. `x` increases east. `y` increases south. Both are zero-based integers.
- The map is **24 by 16**. Width and height are public. Unexplored contents are not.
- A step is one of `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`. Each successful step spends one turn. Adjacency is Chebyshev distance 1 (a diagonal is adjacent).
- A diagonal step is legal only when **both** adjacent cardinal tiles are passable. Corner cutting is blocked.
- Field of view is recursive shadowcasting with Euclidean radius **8** (`dx² + dy² <= 64`). Walls and closed doors block sight and are themselves visible. The radius is fixed by the server. Clients cannot pass a larger radius.

### Static terrain and dynamic state

Static terrain is the tile kind: `wall`, `floor`, or `door`. It does not include whether a door is open, and it does not include creatures or items.

- `levelId` is `"level-1"`.
- `staticHash` is the SHA-256 of the full kind grid. Opening a door does not change it. Cache the grid under `(levelId, staticHash)`.
- `get_static_terrain` returns every **explored** tile once. Unexplored tiles are omitted, not filled with a placeholder.
- Each action also returns `newlySeenTerrain`: tiles that entered memory on that action and were not in it before. Merge those into the cache. They are kinds only.
- Door open/closed is dynamic. Apply `doorChanges` and, when you need a full refresh, `visibleDoors` or the `doorOpen` field on screen cells. A door you have not seen this turn keeps the last value you stored.

Dynamic state is the player, monsters, items, door bits, and messages.

- `visibleEntities` on an action result is the **authoritative** set of monsters and items currently in sight. Replace your visible set with it.
- `appearedEntities`, `updatedEntities`, and `disappearedEntityIds` are the diff against the previous visible set. A disappeared id is an id you were already shown. It is never accompanied by a new coordinate. If a monster walks out of sight, you are not told where it went.
- `player` is also authoritative (position, hp, attack, defense, inventory), not a patch.

### Visibility

The server tracks two sets:

- **Visible**: in the current field of view.
- **Explored**: visible now or on an earlier turn. Memory stores the kind and the last-seen door bit. It never stores entities.

**Remembered terrain is returned. Remembered entities are not.** Unexplored tiles are omitted entirely.

| Query | Explored, in view | Explored, dark | Never seen |
| --- | --- | --- | --- |
| Tile kind | yes | yes (memory) | omitted |
| Door open/closed | current | last seen | omitted |
| Monsters and items | yes | omitted | omitted |
| `glyph` | topmost occupant | terrain glyph only | omitted |

A dark cell has `visible: false`, `actor: null`, `items: []`, and a terrain glyph (`#`, `.`, `+`, `/`). An unexplored cell is not in the array. `omitted` counts how many cells of the request were dropped. Empty does **not** mean floor.

`inspect` of an unknown id and `inspect` of a real but unseen id return the same `not_visible` error, so probing ids does not reveal who exists. Attack and screen requests for a hidden region also return no hidden contents.

Illegal actions (wall, bad target, unseen tile) do not spend a turn and do not run monsters.

There is one in-memory game per process. `start_game` resets it.

## The level

```
########################
#..........###.........#
#.@r.......###.........#
#..........###.......o.#
#...........+...g......#
#....).....###.........#
#.!........###.......!.#
#..........###.........#
#..........###.........#
####.###################
####.###################
#..........#############
#..........#############
#..........#############
#..........#############
########################
```

`@` starts at `(2, 2)`. The rat at `(3, 2)` is in view and will bite if you spend a turn next to it. The sword is `)` at `(5, 5)`. A minor potion is `!` at `(2, 6)`. The closed door `+` at `(12, 4)` seals the east wing: a goblin `g` at `(16, 4)`, an orc `o` at `(21, 3)`, and a healing potion at `(21, 6)`. From the west side of the door the goblin is inside radius 8 and the orc is not. Monsters only step toward you when they can see you and the Chebyshev distance is **4 or less**. Adjacent monsters always attack instead of stepping. They do not open doors.

Damage is `max(1, attack - defense)` with no randomness. Bumping a monster attacks it and does not move you onto its tile. Swords add `attackBonus` to `player.attack` as soon as they are picked up. Potions sit in inventory until `use_item`.

| Archetype | HP | Attack | Defense |
| --- | --- | --- | --- |
| warrior | 30 | 5 | 2 |
| rogue | 22 | 4 | 1 |
| mage | 16 | 7 | 0 |

| Creature | HP | Attack | Defense |
| --- | --- | --- | --- |
| rat | 8 | 3 | 0 |
| goblin | 10 | 4 | 0 |
| orc | 14 | 5 | 1 |

A warrior therefore hits the rat for 5 and is hit for 1.

## Glyphs (`legendId` `"v1"`)

| Glyph | Layer | Meaning | Blocks move | Blocks sight |
| --- | --- | --- | --- | --- |
| `#` | terrain | wall | yes | yes |
| `.` | terrain | floor | no | no |
| `+` | terrain | closed door | yes | yes |
| `/` | terrain | open door | no | no |
| `@` | actor | player | | |
| `r` | actor | rat | | |
| `g` | actor | goblin | | |
| `o` | actor | orc | | |
| `!` | item | potion | | |
| `)` | item | sword | | |

On a visible cell the glyph is the topmost occupant: player, then monster, then item, then terrain. `actor`, `items`, `playerHere`, and `tile` are the fields to branch on. The glyph is for a terminal-style renderer.

## Shared result shapes

```ts
type ErrorResult = {
  ok: false;
  schemaVersion: 1;
  legendId: "v1";
  error: { code: string; message: string };
};

type EntityView = {
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
};

type PlayerView = {
  name: string;
  archetype: "warrior" | "rogue" | "mage";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;   // base + sword bonuses
  defense: number;
  alive: boolean;
  inventory: Array<{
    index: number;
    id: string;
    kind: "potion" | "sword";
    species: string;
    name: string;
    glyph: string;
    heal: number | null;
    attackBonus: number | null;
  }>;
};

type Cell = {
  x: number;
  y: number;
  glyph: string;
  tile: "wall" | "floor" | "door";
  doorOpen: boolean | null;
  visible: boolean;
  playerHere: boolean;
  actor: EntityView | null;
  items: EntityView[];
};

type ActionResult = {
  ok: true;
  schemaVersion: 1;
  legendId: "v1";
  action: string;
  turn: number;
  levelId: "level-1";
  staticHash: string;
  width: number;
  height: number;
  fovRadius: number;
  player: PlayerView;
  died: boolean;
  messages: Array<{
    id: number;
    turn: number;
    code: string;
    text: string;
    data: Record<string, string | number | boolean | null>;
  }>;
  newlySeenTerrain: Array<{ x: number; y: number; kind: "wall" | "floor" | "door" }>;
  doorChanges: Array<{ x: number; y: number; open: boolean }>;
  disappearedEntityIds: string[];
  appearedEntities: EntityView[];
  updatedEntities: EntityView[];
  visibleEntities: EntityView[];   // authoritative
  visibleDoors: Array<{ x: number; y: number; open: boolean }>;
};
```

Message `code` values: `character_created`, `moved`, `attacked`, `damaged`, `killed`, `monster_attacked`, `monster_moved`, `monster_spotted`, `monster_lost`, `door_opened`, `door_closed`, `picked_up`, `healed`, `waited`, `player_died`.

`monster_moved` includes `fromX`, `fromY`, `toX`, `toY` only when both tiles are currently visible. `monster_spotted` includes the visible destination only. `monster_lost` includes `entityId` and no coordinates. `data` is flat; canonical keys are `code` plus `data`, not `text`.

Error `code` values: `no_game`, `no_character`, `character_exists`, `invalid_name`, `invalid_arguments`, `dead`, `blocked`, `not_visible`, `out_of_bounds`, `out_of_range`, `no_target`, `invalid_target`, `not_a_door`, `already_open`, `already_closed`, `no_item`, `cannot_use`, `invalid_rect`, `unknown_level`, `unknown_tool`, `internal`.

Unknown input fields are rejected (`invalid_arguments`), including anything like `fovRadius` or `showHidden`.

## Tools

### `get_legend`

No game required.

```ts
input: {}
output: {
  ok: true;
  schemaVersion: 1;
  legendId: "v1";
  coordinates: {
    origin: string; xAxis: string; yAxis: string; indexing: string;
    movement: string; diagonalMovement: string; fov: string;
  };
  visibility: {
    rememberedTerrain: true;
    rememberedEntities: false;
    unexploredTiles: "omitted";
    fovRadius: number;
    aggroRange: number;
  };
  glyphs: Array<{
    glyph: string;
    layer: "terrain" | "actor" | "item";
    kind: string;
    blocksMovement: boolean | null;
    blocksSight: boolean | null;
    doorOpen: boolean | null;
  }>;
  archetypes: Array<{ id: "warrior" | "rogue" | "mage"; maxHp: number; attack: number; defense: number }>;
  combat: { formula: string; minimumDamage: 1; randomness: "none"; range: "adjacent" };
}
```

### `start_game`

Resets the session. Reveals no tiles.

```ts
input: { seed?: number }   // integer 0 .. 2^31-1, stored and echoed, does not change the layout
output: {
  ok: true; schemaVersion: 1; legendId: "v1";
  gameId: string;          // "game-1", "game-2", ...
  levelId: "level-1";
  staticHash: string;
  width: number; height: number;
  fovRadius: number;       // always 8
  turn: 0;
  seed: number | null;
  monstersAct: true;
} | ErrorResult
```

### `create_character`

```ts
input: { name: string; archetype: "warrior" | "rogue" | "mage" }
output: ActionResult   // action: "create_character"
```

`name` must match `^[A-Za-z][A-Za-z0-9 '-]{0,23}$`. Does not spend a turn. `newlySeenTerrain` is the opening field of view. `appearedEntities` is everything in sight. Fails with `character_exists` if you already have one.

### `get_static_terrain`

```ts
input: { levelId?: string }
output: {
  ok: true; schemaVersion: 1; legendId: "v1";
  levelId: "level-1";
  staticHash: string;
  width: number; height: number;
  explored: number;
  tiles: Array<{ x: number; y: number; kind: "wall" | "floor" | "door" }>;
} | ErrorResult
```

Tiles are explored only, sorted by `y` then `x`. Before a character exists, `tiles` is empty and the hash and size are still returned. A wrong `levelId` is `unknown_level`.

### `get_visible_state`

```ts
input: {}
output: {
  ok: true; schemaVersion: 1; legendId: "v1";
  levelId: "level-1";
  staticHash: string;
  turn: number;
  fovRadius: number;
  player: PlayerView;
  entities: EntityView[];     // in sight right now
  doors: Array<{ x: number; y: number; open: boolean }>;
  messages: ActionResult["messages"];   // the log
} | ErrorResult
```

Requires a character. Works after death. Does not spend a turn.

### `get_screen`

The screen grab. Omit the rectangle for every explored cell. Otherwise all four numbers are required. `width` and `height` are in `1..128`. The rectangle is half-open: `x <= col < x+width`, `y <= row < y+height`.

```ts
input: { x?: number; y?: number; width?: number; height?: number }
output: {
  ok: true; schemaVersion: 1; legendId: "v1";
  levelId: "level-1";
  staticHash: string;
  turn: number;
  width: number; height: number;
  request: { x: number; y: number; width: number; height: number } | null;
  omitted: number;
  cells: Cell[];
} | ErrorResult
```

With no rectangle, `omitted` is `width * height - explored`. With a rectangle, `omitted` counts cells inside it that are off the map or unexplored. Cells are not returned for those. A request that covers only the orc's room before you have seen it comes back as `cells: []`.

### `move`

```ts
input: { direction: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" }
output: ActionResult   // action: "move", or "attack" when the destination is a monster
```

`blocked` if the destination is a wall, a closed door, a cut corner, or outside the map. That does not spend a turn.

### `attack`

```ts
input: { direction?: Direction; x?: number; y?: number }
```

Provide a direction **or** both `x` and `y`. Output is `ActionResult` with `action: "attack"`, or `ErrorResult`.

Order of checks: outside the map → `out_of_bounds`; not currently visible → `not_visible` (no tile contents); not adjacent → `out_of_range`; no monster → `no_target`.

### `open_door` / `close_door`

```ts
input: { direction: Direction }
output: ActionResult   // action: "open_door" | "close_door"
```

The door must be the adjacent visible tile in that direction. `not_a_door`, `already_open`, `already_closed`, and a blocked doorway (`blocked` while closing) do not spend a turn. A successful open puts the new state in `doorChanges` and any newly lit floor in `newlySeenTerrain`. The static hash does not change.

### `pickup`

```ts
input: {}
output: ActionResult   // action: "pickup"
```

Picks up one item on your tile, lowest id first. `no_item` does not spend a turn.

### `use_item`

```ts
input: { index: number }   // integer >= 0, an inventory index
output: ActionResult       // action: "use_item"
```

Potions heal `min(maxHp - hp, heal)` (the `healed` message's `amount` is the actual gain) and are removed. Swords return `cannot_use` without spending a turn.

### `wait`

```ts
input: {}
output: ActionResult   // action: "wait"
```

Spends a turn. Monsters who can see you and are within aggro range still act.

### `inspect`

```ts
input: { x?: number; y?: number; entityId?: string }
output: { ok: true; schemaVersion: 1; legendId: "v1"; cell: Cell } | ErrorResult
```

Does not spend a turn. `entityId` or both coordinates, not both. Unexplored tiles, unseen entities, and unknown ids are all `not_visible`. An explored dark tile returns the memory cell (`visible: false`, no actor, no items).

## Sample agent loop

```js
const terrain = new Map();
let hash = null;

function remember(result) {
  if (result.staticHash && hash && result.staticHash !== hash) terrain.clear();
  hash = result.staticHash ?? hash;
  for (const tile of result.newlySeenTerrain ?? []) {
    terrain.set(`${tile.x},${tile.y}`, tile);
  }
  for (const door of result.doorChanges ?? []) {
    const key = `${door.x},${door.y}`;
    const tile = terrain.get(key);
    if (tile) tile.doorOpen = door.open; // dynamic; kind stays "door"
  }
}

const legend = await tool("get_legend", {});
await tool("start_game", { seed: 1 });
let last = await tool("create_character", { name: "Ada", archetype: "rogue" });
remember(last);
let visible = new Map(last.visibleEntities.map((entity) => [entity.id, entity]));

while (last.player.alive) {
  const screen = await tool("get_screen", {});
  const here = screen.cells.find((cell) => cell.playerHere);
  const step = screen.cells.find(
    (cell) =>
      cell.visible &&
      cell.tile !== "wall" &&
      !(cell.tile === "door" && cell.doorOpen === false) &&
      !cell.actor &&
      Math.max(Math.abs(cell.x - here.x), Math.abs(cell.y - here.y)) === 1,
  );
  if (!step) {
    last = await tool("wait", {});
  } else if (step.tile === "door" && step.doorOpen === false) {
    last = await tool("open_door", { direction: directionOf(here, step) });
  } else {
    last = await tool("move", { direction: directionOf(here, step) });
  }
  if (!last.ok) continue;
  remember(last);
  visible = new Map(last.visibleEntities.map((entity) => [entity.id, entity]));
}
```

`directionOf` is the `n`/`ne`/… name for the sign of `step.x - here.x` and `step.y - here.y`. Do not treat a missing screen cell as floor. Do not keep an entity after its id disappears.

## Demo

`npm run demo` connects over stdio, creates Ada the warrior, kills the adjacent rat, picks up the sword, walks to the door, and opens it. It then checks that the goblin is in the dynamic snapshot, that a 1×1 screen grab of the orc's tile is empty, and that the static hash did not change. The ASCII picture it prints is drawn by the client from `get_screen` cells. Omitted tiles are spaces. The server does not produce that picture.

## Tests

`npm test` covers:

- movement onto floor, into a wall (turn not spent), diagonals, and rejected cheat fields
- opening and closing the door, bumping a closed door, static hash stability
- combat math, retaliation, a killing blow, bump-to-attack, sword equip, potion use, and death
- the static cache, incremental `newlySeenTerrain`, and an item that leaves view (terrain remembered, item gone)
- visibility: full-map and rectangle grabs, `inspect` by coordinate and by id, attacks on hidden tiles, a widened `fovRadius` rejected by the schema, the goblin revealed through the open door, the orc still hidden until you walk in, and a dark goblin tile with no actor
- an MCP client round trip (`listTools`, structured output, one attack, a hidden rectangle)

A projection check runs on every tool result. If a hidden entity id or an unexplored coordinate would leak, the MCP handler logs the failure to stderr and returns `error.code` `"internal"` instead of the payload.

## Layout

```
src/index.ts          stdio entry
src/server.ts         tool registration
src/tools.ts          the only path from a tool call into the game
src/schemas.ts        Zod input/output schemas
src/game/level.ts     the fixed map
src/game/fov.ts       shadowcasting
src/game/engine.ts    rules and monster turns
src/game/view.ts      state -> JSON, the visibility boundary
src/game/safety.ts    rejects a payload that leaks
src/demo/play.ts      scripted MCP client
test/                 vitest
```

## Defaults you may want to change

These are prototype choices, not protocol requirements.

- **Remembered terrain is sent; remembered entities are not.** A stricter fog would omit dark tiles too. A looser one would let the agent remember items it had seen.
- **Map width and height are public**, so the agent can tell how much of the rectangle is still dark. Hiding the bounds is possible; walking into the border reveals them anyway.
- **`staticHash` covers the whole kind grid**, including tiles the player has not explored. It is a cache key, not a description. A client that tried to invert SHA-256 of a 24×16 three-symbol grid would not learn the map in practice, but a version string such as `"level-1-v1"` would avoid hashing hidden data at all.
- **`seed` is accepted and echoed and does not change the level.** Procedural levels are not implemented.
- **Field of view radius is 8 and is not a parameter.** Monster vision and the aggro leash of 4 are also server constants.
- **No combat randomness.** Every hit lands for `max(1, attack - defense)`.
- **Illegal actions are free.** Some roguelikes spend a turn bumping a wall.
- **Bump-to-attack** is on. `attack` is also a separate tool.
- **One session per process**, stdio, no save files, no second level, no corpses, no inventory screen beyond the `player` object.
- **Weapons auto-equip. Only potions are "used".**
- **Monsters do not open doors** and do not wander until they can see you inside the aggro range.
- **License is unset** (`UNLICENSED` in `package.json`). Pick one before publishing.
