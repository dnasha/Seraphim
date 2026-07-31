import type { RuntimeCaching } from 'serwist';
import { CacheFirst, ExpirationPlugin, NetworkOnly } from 'serwist';

export const LEGACY_API_CACHE_NAME = 'apis';
export const PUBLIC_NEWS_IMAGE_CACHE_NAME = 'public-news-images';

type MatchContext = {
  sameOrigin: boolean;
  url: URL;
};

export function isPublicNewsImageRequest({ sameOrigin, url }: MatchContext) {
  return sameOrigin && url.pathname.startsWith('/api/news-image/');
}

export function isSameOriginApiRequest({ sameOrigin, url }: MatchContext) {
  return sameOrigin && url.pathname.startsWith('/api/');
}

export const apiRuntimeCaching: RuntimeCaching[] = [
  {
    matcher: isPublicNewsImageRequest,
    method: 'GET',
    handler: new CacheFirst({
      cacheName: PUBLIC_NEWS_IMAGE_CACHE_NAME,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60,
          maxAgeFrom: 'last-used',
        }),
      ],
    }),
  },
  {
    matcher: isSameOriginApiRequest,
    method: 'GET',
    handler: new NetworkOnly(),
  },
];

export function purgeLegacyApiCache(cacheStorage: Pick<CacheStorage, 'delete'>) {
  return cacheStorage.delete(LEGACY_API_CACHE_NAME);
}
