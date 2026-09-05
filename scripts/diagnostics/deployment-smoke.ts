const origin = 'https://www.seraphi.me';
const expectedCommit = process.env.EXPECTED_COMMIT;
const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) });
if (!health.ok) throw new Error(`Health endpoint returned ${health.status}`);
const version = await health.json() as { status: string; commit: string | null };
if (version.status !== 'ok' || (expectedCommit && version.commit !== expectedCommit)) throw new Error('Unexpected deployed version');
const response = await fetch(`${origin}/api/news?scope=global&time_range=1d&limit=1000`, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`Guest news endpoint returned ${response.status}`);
const news = await response.json() as { items: unknown[]; meta: { appliedLimit: number; stale?: boolean } };
if (!Array.isArray(news.items) || news.items.length > 10 || news.meta.appliedLimit !== 10 || news.meta.stale) {
  throw new Error('Guest feed contract failed');
}
const home = await fetch(origin, { signal: AbortSignal.timeout(15_000) });
if (!home.ok || !(await home.text()).includes('Seraphim')) throw new Error('Homepage smoke test failed');
console.log(JSON.stringify({ status: 'passed', commit: version.commit, guestStories: news.items.length }));
export {};
