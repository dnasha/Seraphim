import type { Polygon, MultiPolygon, Position } from "geojson";
import type { BBox } from "@/lib/core/types";

export interface RegionSpec {
  version: 1;
  id: string;
  name: string;
  geometry: Polygon | MultiPolygon;
  createdAt: string;
}
export const MAX_REGION_VERTICES = 512;
export const normalizeRegionLongitude = (x: number) =>
  ((((x + 180) % 360) + 360) % 360) - 180;
const lng = normalizeRegionLongitude;
export const regionLongitudeDistance = (a: number, b: number) =>
  Math.abs(normalizeRegionLongitude(a - b));
export const regionPolygons = (
  geometry: Polygon | MultiPolygon,
): Position[][][] =>
  geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

/** Shortest longitude edges, including rings crossing the antimeridian. */
function unwrap(ring: Position[]): Position[] {
  let previous = ring[0][0];
  return ring.map(([x, y]) => {
    while (x - previous > 180) x -= 360;
    while (x - previous < -180) x += 360;
    previous = x;
    return [x, y];
  });
}
function onSegment(p: Position, a: Position, b: Position): boolean {
  return (
    Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) <
      1e-9 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9
  );
}
function inRing(point: Position, raw: Position[]): boolean {
  const ring = unwrap(raw);
  const center =
    (Math.min(...ring.map((p) => p[0])) + Math.max(...ring.map((p) => p[0]))) /
    2;
  const p = [point[0] + 360 * Math.round((center - point[0]) / 360), point[1]];
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1],
      b = ring[i];
    if (onSegment(p, a, b)) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function regionContains(
  geometry: RegionSpec["geometry"],
  longitude: number,
  latitude: number,
): boolean {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90
  )
    return false;
  return regionPolygons(geometry).some(
    ([outer, ...holes]) =>
      inRing([lng(longitude), latitude], outer) &&
      !holes.some((h) => inRing([lng(longitude), latitude], h)),
  );
}
function intersects(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  const cross = (p: Position, q: Position, r: Position) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (
    onSegment(a, c, d) ||
    onSegment(b, c, d) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
  );
}
export function validateRegionSpec(value: unknown): RegionSpec {
  const fail = () => {
    throw new Error(
      "Invalid saved region. Use bounded, closed polygons with valid holes.",
    );
  };
  if (!value || typeof value !== "object") return fail();
  const r = value as RegionSpec;
  if (
    r.version !== 1 ||
    typeof r.id !== "string" ||
    !/^[\w-]{1,80}$/.test(r.id) ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 80 ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    !r.geometry ||
    !["Polygon", "MultiPolygon"].includes(r.geometry.type) ||
    !Array.isArray(r.geometry.coordinates)
  )
    return fail();
  const polygons = regionPolygons(r.geometry);
  if (!polygons.length || polygons.length > 8) return fail();
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length || polygon.length > 16)
      return fail();
    for (const ring of polygon) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        ring.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 90,
        )
      )
        return fail();
      vertices += ring.length;
      if (
        vertices > MAX_REGION_VERTICES ||
        ring[0][0] !== ring.at(-1)![0] ||
        ring[0][1] !== ring.at(-1)![1]
      )
        return fail();
      const unwrapped = unwrap(ring);
      if (
        Math.max(...unwrapped.map((p) => p[0])) -
          Math.min(...unwrapped.map((p) => p[0])) >
          180 ||
        unwrapped[0][0] !== unwrapped.at(-1)![0]
      )
        return fail();
      const area = unwrapped
        .slice(1)
        .reduce(
          (sum, p, i) => sum + unwrapped[i][0] * p[1] - p[0] * unwrapped[i][1],
          0,
        );
      if (Math.abs(area) < 1e-9) return fail();
      for (let i = 1; i < unwrapped.length; i++)
        for (let j = i + 2; j < unwrapped.length; j++) {
          if (i === 1 && j === unwrapped.length - 1) continue;
          if (
            intersects(
              unwrapped[i - 1],
              unwrapped[i],
              unwrapped[j - 1],
              unwrapped[j],
            )
          )
            return fail();
        }
    }
    const outer = unwrap(polygon[0]);
    for (let h = 1; h < polygon.length; h++) {
      if (!polygon[h].every((p) => inRing(p, polygon[0]))) return fail();
      const hole = unwrap(polygon[h]);
      const shift = 360 * Math.round((outer[0][0] - hole[0][0]) / 360);
      const aligned = hole.map(([x, y]) => [x + shift, y]);
      for (let i = 1; i < outer.length; i++)
        for (let j = 1; j < aligned.length; j++)
          if (intersects(outer[i - 1], outer[i], aligned[j - 1], aligned[j]))
            return fail();
      for (let other = 1; other < h; other++) {
        if (
          polygon[h].some((p) => inRing(p, polygon[other])) ||
          polygon[other].some((p) => inRing(p, polygon[h]))
        )
          return fail();
        const otherRing = unwrap(polygon[other]).map(([x, y]) => [
          x + 360 * Math.round((outer[0][0] - polygon[other][0][0]) / 360),
          y,
        ]);
        for (let i = 1; i < aligned.length; i++)
          for (let j = 1; j < otherRing.length; j++)
            if (
              intersects(
                aligned[i - 1],
                aligned[i],
                otherRing[j - 1],
                otherRing[j],
              )
            )
              return fail();
      }
    }
  }
  return {
    version: 1,
    id: r.id,
    name: r.name.trim(),
    geometry: {
      type: r.geometry.type,
      coordinates: structuredClone(r.geometry.coordinates),
    } as RegionSpec["geometry"],
    createdAt: r.createdAt,
  };
}
const rectangle = (
  west: number,
  south: number,
  east: number,
  north: number,
): Position[][] => [
  [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ],
];
export function regionFromViewport(
  bbox: BBox,
  name: string,
  id: string,
  createdAt: string,
): RegionSpec {
  if (
    ![bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat].every(
      Number.isFinite,
    ) ||
    bbox.minLat >= bbox.maxLat
  )
    throw new Error("Move the map to a valid viewport first.");
  let width = bbox.maxLng - bbox.minLng;
  if (width < 0) width += 360;
  width = Math.min(width, 360);
  if (width <= 0) throw new Error("Move the map to a valid viewport first.");
  const polygons: Position[][][] = [];
  let cursor = lng(bbox.minLng);
  while (width > 1e-8) {
    const step = Math.min(width, 120, 180 - cursor);
    if (step < 1e-8) {
      cursor = -180;
      continue;
    }
    polygons.push(
      rectangle(
        cursor,
        Math.max(-90, bbox.minLat),
        cursor + step,
        Math.min(90, bbox.maxLat),
      ),
    );
    width -= step;
    cursor += step;
    if (cursor >= 180) cursor = -180;
  }
  return validateRegionSpec({
    version: 1,
    id,
    name,
    createdAt,
    geometry:
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
  });
}
/** At most 16 raw reads, with each crossing polygon split at ±180. */
export function regionReadBounds(geometry: RegionSpec["geometry"]): BBox[] {
  return regionPolygons(geometry).flatMap(([raw]) => {
    const ring = unwrap(raw);
    const minLat = Math.min(...ring.map((p) => p[1])),
      maxLat = Math.max(...ring.map((p) => p[1]));
    const west = Math.min(...ring.map((p) => p[0])),
      width = Math.max(...ring.map((p) => p[0])) - west;
    const minLng = lng(west),
      east = minLng + width;
    return east <= 180
      ? [{ minLat, maxLat, minLng, maxLng: east }]
      : [
          { minLat, maxLat, minLng, maxLng: 180 },
          { minLat, maxLat, minLng: -180, maxLng: east - 360 },
        ];
  });
}
