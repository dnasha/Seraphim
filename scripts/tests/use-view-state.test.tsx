// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  params: "lat=37.7749&lng=-122.4194&zoom=5.5&q=Kyiv&t=1w&src=news%2Creddit&cat=world&s=new&eventId=event-1",
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.params),
  usePathname: () => navigation.pathname,
}));

import { useViewState } from "@/hooks/useViewState";

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("useViewState", () => {
  it("reads the initial URL state", () => {
    const { result } = renderHook(() => useViewState());

    expect(result.current.initialState).toEqual({
      lat: 37.7749,
      lng: -122.4194,
      zoom: 5.5,
      q: "Kyiv",
      t: "1w",
      src: "news,reddit",
      cat: "world",
      s: "new",
      eventId: "event-1",
    });
  });

  it("debounces and serializes state using the compact URL contract", () => {
    vi.useFakeTimers();
    navigation.params = "";
    navigation.pathname = "/dashboard";
    const { result } = renderHook(() => useViewState());

    act(() => {
      result.current.updateURL({
        lat: 1.23456,
        lng: -2.34567,
        zoom: 4.56,
        q: "  incident  ",
        t: "1d",
        src: "extra,telegram,x,reddit,news",
        cat: "all",
        s: "hot",
        eventId: "selected-event",
      });
      vi.advanceTimersByTime(299);
    });
    expect(window.location.pathname).toBe("/");

    act(() => vi.advanceTimersByTime(1));

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("?lat=1.2346&lng=-2.3457&zoom=4.6&q=++incident++&eventId=selected-event");
  });

  it("retains non-default filters and coalesces rapid updates into one write", () => {
    vi.useFakeTimers();
    navigation.params = "";
    navigation.pathname = "/";
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useViewState());

    act(() => {
      result.current.updateURL({ q: "first", src: "news,reddit", cat: "world", s: "new" });
      result.current.updateURL({ q: "final" });
      vi.advanceTimersByTime(300);
    });

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?q=final&src=news%2Creddit&cat=world&s=new");
    replaceState.mockRestore();
  });
});
