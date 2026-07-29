const PULSE_LAYER_ID = "hot-story-pulse";
const PULSE_DURATION_MS = 2_000;
const PULSE_PAUSE_MS = 750;
const PULSE_FRAME_INTERVAL_MS = 1_000 / 30;

export type PulsePaintMap = {
  getLayer: (id: string) => unknown;
  setPaintProperty: (
    layerId: string,
    property: string,
    value: unknown,
  ) => unknown;
};

export type PulseScheduler = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
};

const browserScheduler: PulseScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
};

/**
 * Drives a steady linear pulse at a bounded 30 FPS. Callers pause the
 * controller while the map is moving so decorative effects never compete with
 * camera interaction.
 */
export function createHotStoryPulseController(
  map: PulsePaintMap,
  scheduler: PulseScheduler = browserScheduler,
) {
  let running = false;
  let disposed = false;
  let frameHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;

  const hasLayer = () => Boolean(map.getLayer(PULSE_LAYER_ID));

  const setTransitionDuration = (duration: number) => {
    if (!hasLayer()) return;
    const transition = { duration, delay: 0 };
    map.setPaintProperty(
      PULSE_LAYER_ID,
      "circle-radius-transition",
      transition,
    );
    map.setPaintProperty(
      PULSE_LAYER_ID,
      "circle-opacity-transition",
      transition,
    );
  };

  const setPulse = (radius: number, opacity: number) => {
    if (!hasLayer()) return;
    map.setPaintProperty(PULSE_LAYER_ID, "circle-radius", radius);
    map.setPaintProperty(PULSE_LAYER_ID, "circle-opacity", opacity);
  };

  const cancelScheduledWork = () => {
    if (frameHandle != null) {
      scheduler.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (timerHandle != null) {
      scheduler.clearTimer(timerHandle);
      timerHandle = null;
    }
  };

  const start = () => {
    if (running || disposed) return;
    running = true;
    setTransitionDuration(0);
    setPulse(4, 0.6);

    let cycleStartedAt: number | null = null;
    let lastPaintAt: number | null = null;
    const animate = (timestamp: number) => {
      if (!running || disposed) return;
      if (cycleStartedAt == null) cycleStartedAt = timestamp;
      const elapsed = timestamp - cycleStartedAt;

      if (elapsed >= PULSE_DURATION_MS) {
        frameHandle = null;
        setPulse(55, 0);
        timerHandle = scheduler.setTimer(() => {
          timerHandle = null;
          running = false;
          start();
        }, PULSE_PAUSE_MS);
        return;
      }

      if (
        lastPaintAt == null ||
        timestamp - lastPaintAt >= PULSE_FRAME_INTERVAL_MS
      ) {
        const progress = elapsed / PULSE_DURATION_MS;
        setPulse(4 + progress * 51, 0.6 * (1 - progress));
        lastPaintAt = timestamp;
      }
      frameHandle = scheduler.requestFrame(animate);
    };

    frameHandle = scheduler.requestFrame(animate);
  };

  const stop = () => {
    running = false;
    cancelScheduledWork();
    setTransitionDuration(0);
    setPulse(0, 0);
  };

  return {
    start,
    stop,
    dispose() {
      disposed = true;
      stop();
    },
    isRunning() {
      return running;
    },
  };
}
