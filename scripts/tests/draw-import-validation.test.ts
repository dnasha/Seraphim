import { expect, it } from 'vitest';
import { validateImportedFeatures } from '@/components/map/draw/importValidation';
const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20] }, properties: { isText: true, text: 'Test', initialZoom: 4 } };
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features });
it('accepts supported drawings and text without dropping their properties', () => {
  expect(validateImportedFeatures(collection([point]))).toEqual([point]);
});
it('rejects malformed, oversized, and unsupported geometry before import', () => {
  expect(() => validateImportedFeatures(collection([{ ...point, geometry: { type: 'Point', coordinates: [10, 999] } }]))).toThrow();
  expect(() => validateImportedFeatures(collection([{ ...point, geometry: { type: 'LineString', coordinates: [[0, 0]] } }]))).toThrow();
  expect(() => validateImportedFeatures(collection([{ ...point, properties: { isText: true, text: 'x'.repeat(2001) } }]))).toThrow();
  expect(() => validateImportedFeatures(collection(Array.from({ length: 1001 }, () => point)))).toThrow();
  expect(() => validateImportedFeatures({ type: 'FeatureCollection', features: 'wrong' })).toThrow();
});
