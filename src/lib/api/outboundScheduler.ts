export const GLOBAL_SOURCE_CONCURRENCY = 10;
export const PER_HOST_SOURCE_CONCURRENCY = 1;

type QueuedTask<T> = {
  host: string;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/**
 * Fair process-wide scheduler for source polling. Fetch groups start in parallel,
 * so their individual concurrency limits alone do not protect the runner from a
 * combined RSS, Reddit, Telegram, and X burst.
 */
export class OutboundScheduler {
  private active = 0;
  private readonly activeByHost = new Map<string, number>();
  private readonly queue: QueuedTask<unknown>[] = [];

  constructor(
    private readonly maxGlobal = GLOBAL_SOURCE_CONCURRENCY,
    private readonly maxPerHost = PER_HOST_SOURCE_CONCURRENCY,
  ) {}

  run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const normalizedHost = host.trim().toLowerCase() || 'unknown';
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        host: normalizedHost,
        task,
        resolve,
        reject,
      } as QueuedTask<unknown>);
      this.drain();
    });
  }

  private drain() {
    while (this.active < this.maxGlobal) {
      const index = this.queue.findIndex((queued) =>
        (this.activeByHost.get(queued.host) ?? 0) < this.maxPerHost
      );
      if (index < 0) return;
      const [queued] = this.queue.splice(index, 1);
      this.active += 1;
      this.activeByHost.set(queued.host, (this.activeByHost.get(queued.host) ?? 0) + 1);

      void Promise.resolve()
        .then(queued.task)
        .then(queued.resolve, queued.reject)
        .finally(() => {
          this.active -= 1;
          const hostActive = (this.activeByHost.get(queued.host) ?? 1) - 1;
          if (hostActive <= 0) this.activeByHost.delete(queued.host);
          else this.activeByHost.set(queued.host, hostActive);
          this.drain();
        });
    }
  }
}

const sharedOutboundScheduler = new OutboundScheduler();

export function scheduleOutboundSource<T>(host: string, task: () => Promise<T>) {
  return sharedOutboundScheduler.run(host, task);
}

export function sourceHost(rawUrl: string, fallback: string) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return fallback;
  }
}
