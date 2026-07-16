type VisibilityTarget = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export interface VisiblePollingOptions {
  intervalMs: number;
  poll: (signal: AbortSignal) => Promise<void>;
  visibilityTarget?: VisibilityTarget;
  onError?: (error: unknown) => void;
}

/**
 * Starts one immediate poll, then waits until it settles before scheduling the
 * next one. Hidden documents stop polling and abort outstanding browser work;
 * returning to the tab triggers an immediate refresh.
 */
export function startVisiblePolling({
  intervalMs,
  poll,
  visibilityTarget = document,
  onError,
}: VisiblePollingOptions) {
  let stopped = false;
  let running = false;
  let resumeImmediately = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const isHidden = () => visibilityTarget.visibilityState === 'hidden';

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (stopped || isHidden()) return;
    timer = setTimeout(() => void run(), intervalMs);
  };

  const run = async () => {
    if (stopped || running || isHidden()) return;
    running = true;
    controller = new AbortController();
    const signal = controller.signal;

    try {
      await poll(signal);
    } catch (error) {
      if (!signal.aborted) onError?.(error);
    } finally {
      running = false;
      controller = null;
      if (stopped || isHidden()) return;
      if (resumeImmediately) {
        resumeImmediately = false;
        void run();
      } else {
        schedule();
      }
    }
  };

  const handleVisibilityChange = () => {
    clearTimer();
    if (isHidden()) {
      controller?.abort();
      return;
    }
    if (running) {
      resumeImmediately = true;
    } else {
      void run();
    }
  };

  visibilityTarget.addEventListener('visibilitychange', handleVisibilityChange);
  void run();

  return () => {
    stopped = true;
    resumeImmediately = false;
    clearTimer();
    controller?.abort();
    visibilityTarget.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
