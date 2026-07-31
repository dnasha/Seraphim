import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_API_CACHE_NAME,
  apiRuntimeCaching,
  isPublicNewsImageRequest,
  isSameOriginApiRequest,
  purgeLegacyApiCache,
} from '@/lib/pwa/runtimeCaching';

describe('service-worker API cache policy', () => {
  it('allowlists only public transformed thumbnails', () => {
    expect(isPublicNewsImageRequest({
      sameOrigin: true,
      url: new URL('https://seraphim.example/api/news-image/123?w=640'),
    })).toBe(true);
    expect(isPublicNewsImageRequest({
      sameOrigin: true,
      url: new URL('https://seraphim.example/api/news?scope=global'),
    })).toBe(false);
  });

  it.each([
    '/api/news',
    '/api/account/profile',
    '/api/map-style/basic',
    '/api/stripe/angel-count',
    '/api/future-private-route',
  ])('forces %s through the generic API network-only rule', (pathname) => {
    expect(isSameOriginApiRequest({
      sameOrigin: true,
      url: new URL(pathname, 'https://seraphim.example'),
    })).toBe(true);
    expect(apiRuntimeCaching[1].handler.constructor.name).toBe('NetworkOnly');
  });

  it('orders the thumbnail exception before the generic API rule', () => {
    expect(apiRuntimeCaching).toHaveLength(2);
    expect(apiRuntimeCaching[0].handler.constructor.name).toBe('CacheFirst');
    expect(apiRuntimeCaching[1].handler.constructor.name).toBe('NetworkOnly');
  });

  it('purges the legacy generic API cache during activation', async () => {
    const deleteCache = vi.fn(async () => true);
    await expect(purgeLegacyApiCache({ delete: deleteCache })).resolves.toBe(true);
    expect(deleteCache).toHaveBeenCalledWith(LEGACY_API_CACHE_NAME);
  });
});
