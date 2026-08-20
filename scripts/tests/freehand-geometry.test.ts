import { describe, expect, it } from 'vitest';
import {
  tessellateFreehandCoordinates,
  type FreehandCoordinate,
} from '../../src/components/map/draw/freehandGeometry';

const CONTROL_POINTS: FreehandCoordinate[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [2, 0.5],
];

describe('tessellateFreehandCoordinates', () => {
  it('preserves the stroke endpoints and does not mutate its controls', () => {
    const original = structuredClone(CONTROL_POINTS);
    const result = tessellateFreehandCoordinates(CONTROL_POINTS, { zoom: 8 });

    expect(result[0]).toEqual(CONTROL_POINTS[0]);
    expect(result.at(-1)).toEqual(CONTROL_POINTS.at(-1));
    expect(CONTROL_POINTS).toEqual(original);
  });

  it('adds more display vertices as zoom exposes more of the curve', () => {
    const lowZoom = tessellateFreehandCoordinates(CONTROL_POINTS, { zoom: 2 });
    const highZoom = tessellateFreehandCoordinates(CONTROL_POINTS, { zoom: 12 });

    expect(highZoom.length).toBeGreaterThan(lowZoom.length);
  });

  it('keeps antimeridian strokes on the short wrapped path', () => {
    const result = tessellateFreehandCoordinates([
      [179, 0],
      [-179, 1],
      [-178, 0],
    ], { zoom: 8 });

    for (let index = 1; index < result.length; index += 1) {
      expect(Math.abs(result[index][0] - result[index - 1][0])).toBeLessThan(10);
    }
  });

  it('caps per-segment work for very large zoom differences', () => {
    const result = tessellateFreehandCoordinates(CONTROL_POINTS, {
      zoom: 18,
      maxSubdivisionsPerSegment: 4,
    });

    expect(result.length).toBeLessThanOrEqual(((CONTROL_POINTS.length - 1) * 4) + 1);
  });

  it('drops invalid and consecutive duplicate controls safely', () => {
    const result = tessellateFreehandCoordinates([
      [0, 0],
      [0, 0],
      [Number.NaN, 1],
      [1, 1],
    ], { zoom: 6 });

    expect(result).toEqual([[0, 0], [1, 1]]);
  });
});
