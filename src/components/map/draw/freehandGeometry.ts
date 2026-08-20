export type FreehandCoordinate = [number, number];

interface ProjectedCoordinate {
  x: number;
  y: number;
}

interface TessellateFreehandOptions {
  zoom: number;
  maxSegmentPixels?: number;
  maxSubdivisionsPerSegment?: number;
}

const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
const MAPLIBRE_WORLD_SIZE_AT_ZOOM_ZERO = 512;
const DEFAULT_MAX_SEGMENT_PIXELS = 3;
const DEFAULT_MAX_SUBDIVISIONS_PER_SEGMENT = 64;

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

const lngLatToWorld = ([longitude, latitude]: FreehandCoordinate): ProjectedCoordinate => {
  const clampedLatitude = clamp(latitude, -WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE);
  const latitudeRadians = clampedLatitude * Math.PI / 180;

  return {
    x: (longitude + 180) / 360,
    y: (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2,
  };
};

const worldToLngLat = ({ x, y }: ProjectedCoordinate): FreehandCoordinate => {
  const clampedY = clamp(y, 0, 1);
  const latitudeRadians = Math.atan(Math.sinh(Math.PI * (1 - (2 * clampedY))));

  return [
    (x * 360) - 180,
    latitudeRadians * 180 / Math.PI,
  ];
};

const projectedDistance = (first: ProjectedCoordinate, second: ProjectedCoordinate) => (
  Math.hypot(second.x - first.x, second.y - first.y)
);

const interpolateCatmullRom = (
  first: ProjectedCoordinate,
  start: ProjectedCoordinate,
  end: ProjectedCoordinate,
  last: ProjectedCoordinate,
  progress: number,
): ProjectedCoordinate => {
  const squared = progress * progress;
  const cubed = squared * progress;

  return {
    x: 0.5 * (
      (2 * start.x)
      + ((-first.x + end.x) * progress)
      + (((2 * first.x) - (5 * start.x) + (4 * end.x) - last.x) * squared)
      + ((-first.x + (3 * start.x) - (3 * end.x) + last.x) * cubed)
    ),
    y: 0.5 * (
      (2 * start.y)
      + ((-first.y + end.y) * progress)
      + (((2 * first.y) - (5 * start.y) + (4 * end.y) - last.y) * squared)
      + ((-first.y + (3 * start.y) - (3 * end.y) + last.y) * cubed)
    ),
  };
};

const removeConsecutiveDuplicates = (coordinates: FreehandCoordinate[]) => {
  const unique: FreehandCoordinate[] = [];

  for (const coordinate of coordinates) {
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
    const previous = unique[unique.length - 1];
    if (previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) continue;
    unique.push([coordinate[0], coordinate[1]]);
  }

  return unique;
};

const unwrapWorldLongitudes = (coordinates: ProjectedCoordinate[]) => {
  if (coordinates.length === 0) return [];

  const unwrapped: ProjectedCoordinate[] = [{ ...coordinates[0] }];
  for (let index = 1; index < coordinates.length; index += 1) {
    const previousX = unwrapped[index - 1].x;
    let nextX = coordinates[index].x;

    while (nextX - previousX > 0.5) nextX -= 1;
    while (nextX - previousX < -0.5) nextX += 1;

    unwrapped.push({ x: nextX, y: coordinates[index].y });
  }

  return unwrapped;
};

/**
 * Builds a smooth display geometry from raw freehand control points. The curve
 * is tessellated in Web Mercator space so its visible segment length remains
 * approximately stable as the map zoom changes.
 */
export const tessellateFreehandCoordinates = (
  coordinates: FreehandCoordinate[],
  {
    zoom,
    maxSegmentPixels = DEFAULT_MAX_SEGMENT_PIXELS,
    maxSubdivisionsPerSegment = DEFAULT_MAX_SUBDIVISIONS_PER_SEGMENT,
  }: TessellateFreehandOptions,
): FreehandCoordinate[] => {
  const controlCoordinates = removeConsecutiveDuplicates(coordinates);
  if (controlCoordinates.length < 3) return controlCoordinates;

  const projected = unwrapWorldLongitudes(controlCoordinates.map(lngLatToWorld));
  const worldPixelSize = MAPLIBRE_WORLD_SIZE_AT_ZOOM_ZERO * (2 ** Math.max(0, zoom));
  const safeMaxSegmentPixels = Math.max(0.5, maxSegmentPixels);
  const subdivisionLimit = Math.max(1, Math.floor(maxSubdivisionsPerSegment));
  const tessellated: FreehandCoordinate[] = [];

  for (let index = 0; index < projected.length - 1; index += 1) {
    const first = projected[Math.max(0, index - 1)];
    const start = projected[index];
    const end = projected[index + 1];
    const last = projected[Math.min(projected.length - 1, index + 2)];

    const directLength = projectedDistance(start, end);
    const neighboringLength = (
      projectedDistance(first, start)
      + directLength
      + projectedDistance(end, last)
    ) / 3;
    const estimatedPixelLength = Math.max(directLength, neighboringLength) * worldPixelSize;
    const subdivisions = clamp(
      Math.ceil(estimatedPixelLength / safeMaxSegmentPixels),
      1,
      subdivisionLimit,
    );

    for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
      const progress = subdivision / subdivisions;
      tessellated.push(worldToLngLat(interpolateCatmullRom(first, start, end, last, progress)));
    }
  }

  // Preserve the exact geographic endpoint while keeping its longitude in the
  // same wrapped world as the preceding curve points.
  const finalCoordinate: FreehandCoordinate = [...controlCoordinates[controlCoordinates.length - 1]];
  const precedingCoordinate = tessellated[tessellated.length - 1];
  if (precedingCoordinate) {
    while (finalCoordinate[0] - precedingCoordinate[0] > 180) finalCoordinate[0] -= 360;
    while (finalCoordinate[0] - precedingCoordinate[0] < -180) finalCoordinate[0] += 360;
  }
  tessellated.push(finalCoordinate);
  return tessellated;
};
