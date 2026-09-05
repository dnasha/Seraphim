import { claimRecoveryJob } from '../../src/lib/server/recoveryJobs';
import { runRecoveryJob } from '../../src/lib/server/runRecoveryJob';

const deadline = Date.now() + 4 * 60_000;
let completed = 0;
let failed = 0;
while (Date.now() < deadline && completed + failed < 50) {
  const job = await claimRecoveryJob();
  if (!job) break;
  try {
    await runRecoveryJob(job);
    completed += 1;
  } catch {
    failed += 1;
    console.error('[recovery] Job deferred for retry', job.job_key);
  }
}
console.log(JSON.stringify({ completed, failed, commit: process.env.GITHUB_SHA ?? 'local' }));
if (failed) process.exitCode = 1;
