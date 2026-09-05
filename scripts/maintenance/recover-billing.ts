const token = process.env.BILLING_RECOVERY_TOKEN;
if (!token || token.length < 32) throw new Error('Recovery token is not configured');
const deadline = Date.now() + 4 * 60_000;
let completed = 0;
let deployedCommit: string | null = null;
while (Date.now() < deadline && completed < 50) {
  const response = await fetch('https://www.seraphi.me/api/internal/billing-recovery', {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(Math.max(1, Math.min(65_000, deadline - Date.now()))),
  });
  if (!response.ok) throw new Error(`Recovery deferred (HTTP ${response.status})`);
  const result = await response.json() as { processed?: boolean; commit?: string | null };
  if (typeof result.processed !== 'boolean') throw new Error('Invalid recovery response');
  deployedCommit = result.commit ?? null;
  if (!result.processed) break;
  completed += 1;
}
console.log(JSON.stringify({ completed, deployedCommit, workerCommit: process.env.GITHUB_SHA ?? 'local' }));
export {};
