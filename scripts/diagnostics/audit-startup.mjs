/**
 * Read-only HTTP startup audit. These are network timings, not browser/WebGL timings.
 * Usage: node scripts/diagnostics/audit-startup.mjs [https://www.seraphi.me]
 */
const origin = new URL(process.argv[2] || 'https://www.seraphi.me');

async function measure(url) {
  const start = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const headersAt = performance.now();
  const body = await response.text();
  return {
    url: String(url), status: response.status,
    ttfbMs: Math.round(headersAt - start), totalMs: Math.round(performance.now() - start),
    decodedBytes: Buffer.byteLength(body),
    cache: response.headers.get('x-vercel-cache') ?? response.headers.get('cf-cache-status'),
    body,
  };
}

const page = await measure(origin);
const scriptUrls = [...new Set([...page.body.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(match => new URL(match[1].replaceAll('&amp;', '&'), origin).href))];
const results = [page];
// Small batches avoid adding artificial request contention to the samples.
for (let index = 0; index < scriptUrls.length; index += 4) {
  const batch = await Promise.allSettled(scriptUrls.slice(index, index + 4).map(measure));
  for (const result of batch) {
    if (result.status === 'fulfilled') results.push(result.value);
    else console.error(String(result.reason));
  }
}
results.push(await measure(new URL('/api/news?sort=hot&time_range=1d&view=map&scope=global&force_raw=true&limit=50', origin)));
console.log(JSON.stringify({
  note: 'HTTP samples only; dynamic imports, tile rendering, and CPU work require browser profiling.',
  initialScriptCount: scriptUrls.length,
  initialScriptDecodedBytes: results.filter(result => scriptUrls.includes(result.url)).reduce((sum, result) => sum + result.decodedBytes, 0),
  requests: results.map(result => ({ ...result, body: undefined })),
}, null, 2));
