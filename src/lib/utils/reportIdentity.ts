const X_STATUS_HOSTS = new Set([
  'x.com', 'twitter.com', 'mobile.twitter.com', 'nitter.privacydev.net',
  'nitter.poast.org', 'xcancel.com', 'nitter.cz',
  // Historical mirrors observed in saved reports; these are identity aliases,
  // not additional outbound fetch destinations.
  'nitter.jaydenha.uk', 'nitter.kareem.one', 'nitter.netbub.com',
  'shitter.thepixora.com', 'x.yuuki.sh',
]);

/** A comparison key only: keep the original article URL for display and attribution. */
export function reportIdentityKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (X_STATUS_HOSTS.has(host)) {
      const status = url.pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)(?:\/|$)/);
      if (status) return `x-status:${status[1]}`;
    }
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)
        || (host === 'dw.com' && key.toLowerCase() === 'maca')) {
        url.searchParams.delete(key);
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return rawUrl;
  }
}
