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
