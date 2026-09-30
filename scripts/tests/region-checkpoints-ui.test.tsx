// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRegionCheckpoints } from "@/components/regions/useRegionCheckpoints";
import RegionCheckpoints from "@/components/regions/RegionCheckpoints";
import {
  checkpointStorageKey,
  decodeCheckpoints,
  type RegionFilters,
} from "@/lib/regions/checkpoints";
import type { NewsItem, NewsResponse } from "@/lib/core/types";
import { useCheckpointMapLayer } from "@/components/regions/useCheckpointMapLayer";
import { regionFromViewport } from "@/lib/regions/geometry";
import type { Map } from "maplibre-gl";

const filters: RegionFilters = {
  timeRange: "1d",
  customStartDate: "",
  customEndDate: "",
  query: "",
  sources: ["news", "reddit", "x", "telegram", "extra"],
  categories: ["all"],
  credibilityTiers: [1, 2, 3],
  minVolume: 1,
  sort: "hot",
};
const viewport = { minLng: -10, maxLng: 10, minLat: -10, maxLat: 10 };
const event = (id: string): NewsItem => ({
  id,
  title: `Fixture event ${id}`,
  url: `https://example.test/${id}`,
  source: "Test",
  sourceType: "rss",
  publishedAt: "2000-01-01",
  latitude: 0,
  longitude: 0,
});
function response(
  ids: string[],
  meta: Partial<NonNullable<NewsResponse["meta"]>> = {},
  capturedAt = "2026-09-30T00:00:00Z",
) {
  return new Response(
    JSON.stringify({
      items: ids.map(event),
      lastUpdated: capturedAt,
      meta: {
        sort: "hot",
        scope: "viewport",
        view: "sidebar",
        clustered: false,
        isCapped: false,
        stale: false,
        appliedLimit: 50,
        ...meta,
      },
    }),
  );
}
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  localStorage.clear();
  fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => response(["a"]));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup(account = "a", tier: "free" | "pro" = "free") {
  const hook = renderHook(() => useRegionCheckpoints(account, tier));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.save("Fixture region", viewport, filters));
  const id = hook.result.current.regions[0].region.id;
  return { ...hook, id };
}

describe("checkpoint hook lifecycle", () => {
  it("persists first baseline, restores on reload, and reviews exactly the displayed snapshot", async () => {
    const hook = await setup();
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    expect(hook.result.current.displayed?.baselineCreated).toBe(true);
    hook.unmount();
    const reload = renderHook(() => useRegionCheckpoints("a", "free"));
    await waitFor(() => expect(reload.result.current.ready).toBe(true));
    fetcher.mockImplementation(async () => response(["a", "b"]));
    await act(async () => {
      await reload.result.current.check(hook.id);
    });
    expect(reload.result.current.changes.map((c) => c.event.id)).toEqual(["b"]);
    fetcher.mockImplementation(async () => response(["a", "b", "c"]));
    const calls = fetcher.mock.calls.length;
    act(() => reload.result.current.review());
    expect(fetcher.mock.calls.length).toBe(calls);
    expect(
      reload.result.current.regions[0].baseline!.events.map((e) => e.id),
    ).toEqual(["a", "b"]);
    await act(async () => {
      await reload.result.current.check(hook.id);
    });
    expect(reload.result.current.changes.map((c) => c.event.id)).toEqual(["c"]);
  });
  it("retains the baseline through stale and failed checks", async () => {
    const hook = await setup();
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    const raw = localStorage.getItem(checkpointStorageKey("a"));
    fetcher.mockImplementation(async () =>
      response(["a", "b"], { stale: true }),
    );
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    act(() => hook.result.current.review());
    expect(hook.result.current.error).toMatch(/Stale/);
    expect(localStorage.getItem(checkpointStorageKey("a"))).toBe(raw);
    fetcher.mockRejectedValue(new Error("Fixture offline"));
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    expect(hook.result.current.displayed).toBe(null);
    expect(localStorage.getItem(checkpointStorageKey("a"))).toBe(raw);
  });
  it("aborts on deletion and does not recreate deleted data when a fetch resolves late", async () => {
    const hook = await setup();
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let check!: Promise<void>;
    act(() => {
      check = hook.result.current.check(hook.id);
    });
    const signal = fetcher.mock.calls.at(-1)![1]!.signal!;
    act(() => hook.result.current.remove(hook.id));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(response(["a"]));
      await check;
    });
    expect(hook.result.current.regions).toEqual([]);
    expect(hook.result.current.displayed).toBe(null);
    expect(
      decodeCheckpoints(localStorage.getItem(checkpointStorageKey("a")), "a"),
    ).toEqual([]);
  });
  it("unmount on account switch clears UI and cancels private async work", async () => {
    const hook = await setup("account-a");
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let check!: Promise<void>;
    act(() => {
      check = hook.result.current.check(hook.id);
    });
    const signal = fetcher.mock.calls.at(-1)![1]!.signal!;
    hook.unmount();
    const other = renderHook(() => useRegionCheckpoints("account-b", "free"));
    expect(other.result.current.regions).toEqual([]);
    await waitFor(() => expect(other.result.current.ready).toBe(true));
    await act(async () => {
      finish(response(["a"]));
      await check;
    });
    expect(signal.aborted).toBe(true);
    expect(other.result.current.displayed).toBe(null);
    expect(localStorage.getItem(checkpointStorageKey("account-b"))).toBeNull();
    expect(
      decodeCheckpoints(
        localStorage.getItem(checkpointStorageKey("account-a")),
        "account-a",
      )[0].baseline,
    ).toBeNull();
  });
  it("gates private state synchronously even when the hook owner changes without a keyed remount", async () => {
    const hook = renderHook(
      ({ account }) => useRegionCheckpoints(account, "free"),
      { initialProps: { account: "a" } },
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() => hook.result.current.save("Private A", viewport, filters));
    const id = hook.result.current.regions[0].region.id;
    await act(async () => {
      await hook.result.current.check(id);
    });
    hook.rerender({ account: "b" });
    expect(hook.result.current.regions).toEqual([]);
    expect(hook.result.current.displayed).toBeNull();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(localStorage.getItem(checkpointStorageKey("b"))).toBeNull();
  });
  it("rebaselines explicitly on a plan change rather than comparing incompatible observations", async () => {
    const hook = await setup();
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    hook.unmount();
    const paid = renderHook(() => useRegionCheckpoints("a", "pro"));
    await waitFor(() => expect(paid.result.current.ready).toBe(true));
    fetcher.mockImplementation(async () =>
      response(["b"], { appliedLimit: 1000 }),
    );
    await act(async () => {
      await paid.result.current.check(hook.id);
    });
    expect(paid.result.current.displayed).toMatchObject({
      baselineCreated: false,
      resetForTier: true,
      rebaselineRequired: true,
    });
    expect(paid.result.current.changes).toEqual([]);
    expect(paid.result.current.regions[0].baseline?.tier).toBe("free");
    act(() => paid.result.current.review());
    expect(paid.result.current.regions[0].baseline?.tier).toBe("pro");
  });
  it("handles quota/write denial, corrupted schema and clear recovery honestly", async () => {
    const hook = await setup();
    const setter = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Fixture quota exceeded");
      });
    act(() => hook.result.current.rename(hook.id, "Rename that fails"));
    expect(hook.result.current.regions[0].region.name).toBe("Fixture region");
    expect(hook.result.current.error).toMatch(/quota/);
    setter.mockRestore();
    hook.unmount();
    localStorage.setItem(checkpointStorageKey("a"), "malformed");
    const corrupt = renderHook(() => useRegionCheckpoints("a", "free"));
    await waitFor(() =>
      expect(corrupt.result.current.error).toMatch(/could not be read/),
    );
    expect(corrupt.result.current.ready).toBe(false);
    act(() => corrupt.result.current.clear());
    expect(corrupt.result.current.ready).toBe(true);
    expect(localStorage.getItem(checkpointStorageKey("a"))).toBe(null);
  });
  it("persists coverage invalidation and requires an explicit compatible baseline after a server limit mismatch", async () => {
    fetcher.mockImplementation(async () =>
      response(["a"], { appliedLimit: 1000 }),
    );
    const hook = await setup("a", "pro");
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    const baseline = structuredClone(hook.result.current.regions[0].baseline);
    fetcher.mockImplementation(async () =>
      response(["a", "b"], { appliedLimit: 50 }),
    );
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    expect(hook.result.current.error).toMatch(/Server event coverage/);
    expect(hook.result.current.displayed).toBeNull();
    expect(hook.result.current.regions[0]).toMatchObject({
      baseline,
      rebaselineRequired: true,
    });
    hook.unmount();
    const reload = renderHook(() => useRegionCheckpoints("a", "pro"));
    await waitFor(() => expect(reload.result.current.ready).toBe(true));
    expect(reload.result.current.regions[0].rebaselineRequired).toBe(true);
    fetcher.mockImplementation(async () =>
      response(["a", "b"], { appliedLimit: 1000 }),
    );
    await act(async () => {
      await reload.result.current.check(hook.id);
    });
    expect(reload.result.current.displayed).toMatchObject({
      rebaselineRequired: true,
      baselineCreated: false,
    });
    expect(reload.result.current.changes).toEqual([]);
    expect(reload.result.current.regions[0].baseline).toEqual(baseline);
    act(() => reload.result.current.review());
    expect(reload.result.current.regions[0].rebaselineRequired).toBe(false);
    expect(
      reload.result.current.regions[0].baseline?.events.map((e) => e.id),
    ).toEqual(["a", "b"]);
  });
  it("refuses an older capture without changing the review boundary", async () => {
    fetcher.mockImplementation(async () =>
      response(["a"], {}, "2026-09-30T00:00:50Z"),
    );
    const hook = await setup();
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    const stored = localStorage.getItem(checkpointStorageKey("a"));
    fetcher.mockImplementation(async () =>
      response(["a", "b"], {}, "2026-09-30T00:00:10Z"),
    );
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    expect(hook.result.current.error).toMatch(/older/);
    expect(hook.result.current.displayed).toBeNull();
    act(() => hook.result.current.review());
    expect(localStorage.getItem(checkpointStorageKey("a"))).toBe(stored);
  });
  it("cancels in-flight detail work on account switch even if the service resolves late", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    let finish!: (value: Response) => void;
    fetcher.mockImplementation((url) =>
      String(url).startsWith("/api/news?")
        ? Promise.resolve(response([id]))
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const hook = await setup("account-a");
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.check(hook.id);
    });
    await waitFor(() => expect(fetcher.mock.calls.length).toBe(2));
    const signal = fetcher.mock.calls[1][1]!.signal!;
    hook.unmount();
    const other = renderHook(() => useRegionCheckpoints("account-b", "free"));
    await act(async () => {
      finish(new Response("{}"));
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(other.result.current.displayed).toBeNull();
    expect(
      decodeCheckpoints(
        localStorage.getItem(checkpointStorageKey("account-a")),
        "account-a",
      )[0].baseline,
    ).toBeNull();
  });
  it("deletion in another tab clears private results and cancels a read", async () => {
    const hook = await setup();
    await act(async () => {
      await hook.result.current.check(hook.id);
    });
    act(() => {
      localStorage.removeItem(checkpointStorageKey("a"));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: checkpointStorageKey("a"),
          newValue: null,
        }),
      );
    });
    expect(hook.result.current.regions).toEqual([]);
    expect(hook.result.current.displayed).toBe(null);
  });
});

describe("checkpoint panel", () => {
  it("labels incomplete source observations and exposes explicit compatible rebaseline", async () => {
    const ui = render(
      <RegionCheckpoints
        account="a"
        tier="pro"
        viewport={viewport}
        filters={filters}
        onRegionPreview={vi.fn()}
      />,
    );
    fetcher.mockImplementation(async () =>
      response(["a"], { appliedLimit: 1000 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Region checkpoints" }));
    fireEvent.change(screen.getByLabelText("Region name"), {
      target: { value: "Coverage watch" },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save viewport",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save viewport" }));
    fireEvent.click(screen.getByRole("button", { name: "Coverage watch" }));
    fireEvent.click(screen.getByRole("button", { name: "Check changes" }));
    await screen.findByText(/Baseline saved/);
    expect(screen.getByText(/Incomplete report coverage for 1/)).toBeTruthy();
    fetcher.mockImplementation(async () =>
      response(["a"], { appliedLimit: 50 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check changes" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    fetcher.mockImplementation(async () =>
      response(["b"], { appliedLimit: 1000 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check changes" }));
    await screen.findByText(/Establish a compatible baseline explicitly/);
    fireEvent.click(
      screen.getByRole("button", { name: "Establish compatible baseline" }),
    );
    await screen.findByText(/Baseline saved/);
    ui.unmount();
  });
  it("supports named capture, fixed saved filters, rename/delete, stale disclosure and keyboard close", async () => {
    const preview = vi.fn();
    const props = {
      account: "a",
      tier: "free" as const,
      viewport,
      filters,
      onRegionPreview: preview,
    };
    const ui = render(<RegionCheckpoints {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Region checkpoints" }));
    const save = screen.getByRole("button", {
      name: "Save viewport",
    }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Region name"), {
      target: { value: "Local watch" },
    });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "Local watch" }));
    ui.rerender(
      <RegionCheckpoints
        {...props}
        viewport={{ ...viewport, minLng: 30, maxLng: 40 }}
        filters={{ ...filters, categories: ["world"] }}
      />,
    );
    expect(screen.getByText(/categories all/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check changes" }));
    await screen.findByText(/Baseline saved/);
    fetcher.mockImplementation(async () =>
      response(["a", "b"], { stale: true, isCapped: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check changes" }));
    await screen.findByText(/Stale results/);
    expect(
      (
        screen.getByRole("button", {
          name: "Mark reviewed",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/Capped coverage/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rename region"), {
      target: { value: "Renamed watch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("button", { name: "Renamed watch" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete region" }));
    expect(screen.queryByRole("button", { name: "Renamed watch" })).toBeNull();
    fireEvent.keyDown(
      screen.getByRole("region", { name: "Region checkpoints" }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("region", { name: "Region checkpoints" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Region checkpoints" }),
    );
    expect(preview).toHaveBeenLastCalledWith(null);
  });
  it("keyed account changes synchronously remove private names and results", async () => {
    const props = {
      tier: "free" as const,
      viewport,
      filters,
      onRegionPreview: vi.fn(),
    };
    const ui = render(
      <RegionCheckpoints key="a:free" account="a" {...props} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Region checkpoints" }));
    fireEvent.change(screen.getByLabelText("Region name"), {
      target: { value: "Private region A" },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Save viewport",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save viewport" }));
    ui.rerender(<RegionCheckpoints key="b:free" account="b" {...props} />);
    expect(screen.queryByText("Private region A")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Region checkpoints" }));
    await waitFor(() =>
      expect(screen.queryByText("Private region A")).toBeNull(),
    );
  });
});

it("owns experiment map IDs, reinstalls on style changes and removes layers on cleanup", () => {
  const sources = new Set<string>(),
    layers = new Set<string>();
  let onStyle!: () => void;
  const map = {
    isStyleLoaded: () => true,
    getSource: (id: string) =>
      sources.has(id) ? { setData: vi.fn() } : undefined,
    addSource: vi.fn((id: string) => sources.add(id)),
    getLayer: (id: string) => layers.has(id),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    on: vi.fn((_event, fn) => {
      onStyle = fn;
    }),
    off: vi.fn(),
  };
  const region = regionFromViewport(viewport, "Test", "test", "2026-09-30");
  const ref = { current: map as unknown as Map };
  const hook = renderHook(() => useCheckpointMapLayer(ref, true, region));
  expect([...sources]).toEqual(["experiment-region-checkpoints-region"]);
  expect(layers.size).toBe(2);
  sources.clear();
  layers.clear();
  act(onStyle);
  expect(layers.size).toBe(2);
  hook.unmount();
  expect(layers.size).toBe(0);
  expect(sources.size).toBe(0);
  expect(map.off).toHaveBeenCalled();
});
