import { tileKey } from "./types.js";

/**
 * Recursive shadowcasting (RogueBasin / rot.js octants).
 *
 * A blocking tile is visible and stops light. Radius is Euclidean
 * (`dx² + dy² <= radius²`). Out-of-bounds tiles block and are not marked.
 */
const OCTANTS = [
  { xx: 1, xy: 0, yx: 0, yy: 1 },
  { xx: 0, xy: 1, yx: 1, yy: 0 },
  { xx: 0, xy: -1, yx: 1, yy: 0 },
  { xx: -1, xy: 0, yx: 0, yy: 1 },
  { xx: -1, xy: 0, yx: 0, yy: -1 },
  { xx: 0, xy: -1, yx: -1, yy: 0 },
  { xx: 0, xy: 1, yx: -1, yy: 0 },
  { xx: 1, xy: 0, yx: 0, yy: -1 },
] as const;

export function computeFov(
  originX: number,
  originY: number,
  radius: number,
  width: number,
  height: number,
  blocks: (x: number, y: number) => boolean,
): Set<string> {
  const visible = new Set<string>();
  const mark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    visible.add(tileKey(x, y));
  };
  mark(originX, originY);
  for (const octant of OCTANTS) {
    cast(originX, originY, 1, 1, 0, radius, octant, blocks, mark);
  }
  return visible;
}

function cast(
  cx: number,
  cy: number,
  row: number,
  startSlope: number,
  endSlope: number,
  radius: number,
  octant: (typeof OCTANTS)[number],
  blocks: (x: number, y: number) => boolean,
  mark: (x: number, y: number) => void,
): void {
  if (startSlope < endSlope) return;
  let nextStart = startSlope;
  for (let distance = row; distance <= radius; distance++) {
    let blocked = false;
    for (let dx = -distance; dx <= 0; dx++) {
      const dy = -distance;
      const mapX = cx + dx * octant.xx + dy * octant.xy;
      const mapY = cy + dx * octant.yx + dy * octant.yy;
      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);
      if (startSlope < rightSlope) continue;
      if (endSlope > leftSlope) break;
      if (dx * dx + dy * dy <= radius * radius) mark(mapX, mapY);
      if (blocked) {
        if (blocks(mapX, mapY)) {
          nextStart = rightSlope;
          continue;
        }
        blocked = false;
        startSlope = nextStart;
      } else if (blocks(mapX, mapY) && distance < radius) {
        blocked = true;
        cast(cx, cy, distance + 1, startSlope, leftSlope, radius, octant, blocks, mark);
        nextStart = rightSlope;
      }
    }
    if (blocked) break;
  }
}
