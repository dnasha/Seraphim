import type { NewsItem } from "@/lib/core/types";

export const NEWS_IMAGE_HOSTS = [
  "www.nj.com",
  "external-preview.redd.it",
  "preview.redd.it",
  "cdn.i-scmp.com",
  "c.ndtvimg.com",
  "ichef.bbci.co.uk",
  "img.yna.co.kr",
  "scx1.b-cdn.net",
  "i.dawn.com",
  "www.al.com",
  "i.guim.co.uk",
  "www.japantimes.co.jp",
  "static01.nyt.com",
  "globalnews.ca",
  "th-i.thgim.com",
  "www.oregonlive.com",
  "img.lemde.fr",
  "dam.mediacorp.sg",
  "cdn.dailymaverick.co.za",
  "images.euronews.com",
  "images.thediplomat.com",
  "images.indianexpress.com",
  "cdn.arstechnica.net",
  "komonews.com",
  "ca-times.brightspotcdn.com",
  "images.dailynewsegypt.com",
  "images.mktw.net",
  "s.yimg.com",
  "s.france24.com",
  "apicms.thestar.com.my",
  "static.toiimg.com",
  "i.cbc.ca",
  "i0.wp.com",
  "www.rte.ie",
  "static.ffx.io",
  "whyy.org",
  "en.mercopress.com",
  "media.wbur.org",
  "balkaninsight.com",
  "www.nzherald.co.nz",
] as const;

const NEWS_IMAGE_HOST_SET = new Set<string>(NEWS_IMAGE_HOSTS);

export function canOptimizeNewsImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && NEWS_IMAGE_HOST_SET.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROXY_WIDTHS = [176, 640, 960] as const;

function imageVersion(url: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < url.length; index++) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function selectNewsImageWidth(requestedWidth: number) {
  const safeWidth = Number.isFinite(requestedWidth) ? Math.max(1, requestedWidth) : PROXY_WIDTHS[0];
  return PROXY_WIDTHS.find((width) => width >= safeWidth) ?? PROXY_WIDTHS.at(-1)!;
}

export type NewsImagePresentation = {
  src: string;
  unoptimized: boolean;
  proxied: boolean;
};

/**
 * Known hosts use Next's optimizer. Other ingested sources use the bounded
 * same-origin thumbnail endpoint when the API supplied a real backing event ID.
 */
export function getNewsImagePresentation(
  item: Pick<NewsItem, "id" | "originalId" | "imageUrl">,
  requestedWidth: number,
): NewsImagePresentation | null {
  if (!item.imageUrl) return null;
  if (canOptimizeNewsImage(item.imageUrl)) {
    return { src: item.imageUrl, unoptimized: false, proxied: false };
  }

  const eventId = item.originalId ?? item.id;
  if (!UUID_PATTERN.test(eventId)) {
    return { src: item.imageUrl, unoptimized: true, proxied: false };
  }

  const width = selectNewsImageWidth(requestedWidth);
  const version = imageVersion(item.imageUrl);
  return {
    src: `/api/news-image/${encodeURIComponent(eventId)}?w=${width}&v=${version}`,
    unoptimized: true,
    proxied: true,
  };
}
