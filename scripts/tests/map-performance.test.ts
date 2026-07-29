import { describe, expect, it, vi } from "vitest";
import { buildNewsFeatureCollection } from "@/components/map/newsGeoJson";
import {
  createHotStoryPulseController,
  type PulsePaintMap,
  type PulseScheduler,
} from "@/components/map/pulseController";

describe("map feature payload", () => {
  it("keeps article and image metadata out of MapLibre worker data", () => {
    const collection = buildNewsFeatureCollection([
      {
        id: "event-1",
        title: "Large story",
        description: "A long body that should remain in React state.",
        url: "https://example.com/story",
        source: "Example",
        sourceType: "rss",
        category: "world",
        publishedAt: "2026-07-27T00:00:00.000Z",
        imageUrl: "https://example.com/large.jpg",
        latitude: 20,
        longitude: 10,
        storyCount: 4,
        isTopHot: true,
      },
    ]);

    expect(collection.features[0].properties).toEqual({
      id: "event-1",
      canonicalId: "event-1",
      category: "world",
      storyCount: 4,
      isTopHot: true,
    });
    expect(collection.features[0].properties).not.toHaveProperty("imageUrl");
    expect(collection.features[0].properties).not.toHaveProperty("description");
    expect(collection.features[0].properties).not.toHaveProperty("title");
  });
});

describe("hot-story pulse controller", () => {
  it("keeps expansion linear, throttled, and briefly paused", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const timerCallbacks: Array<() => void> = [];
    const paintCalls: Array<[string, unknown]> = [];
    const map: PulsePaintMap = {
      getLayer: () => ({}),
      setPaintProperty: (_layer, property, value) => {
        paintCalls.push([property, value]);
      },
    };
    const scheduler: PulseScheduler = {
      requestFrame: vi.fn((callback) => {
        frameCallbacks.push(callback);
        return 1;
      }),
      cancelFrame: vi.fn(),
      setTimer: vi.fn((callback) => {
        timerCallbacks.push(callback);
        return 2 as unknown as ReturnType<typeof setTimeout>;
      }),
      clearTimer: vi.fn(),
    };

    const pulse = createHotStoryPulseController(map, scheduler);
    pulse.start();
    expect(paintCalls).toHaveLength(4);
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);

    const runNextFrame = (timestamp: number) => frameCallbacks.shift()?.(timestamp);
    runNextFrame(0);
    runNextFrame(16);
    expect(paintCalls).toHaveLength(6);

    runNextFrame(34);
    runNextFrame(1_000);
    expect(paintCalls.slice(-2)).toEqual([
      ["circle-radius", 29.5],
      ["circle-opacity", 0.3],
    ]);

    runNextFrame(2_000);
    expect(scheduler.setTimer).toHaveBeenCalledTimes(1);
    expect(scheduler.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 750);
    expect(paintCalls.slice(-2)).toEqual([
      ["circle-radius", 55],
      ["circle-opacity", 0],
    ]);

    timerCallbacks.shift()?.();
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(6);

    pulse.stop();
    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1);
    expect(paintCalls.slice(-2)).toEqual([
      ["circle-radius", 0],
      ["circle-opacity", 0],
    ]);
  });
});
