import { describe, expect, it, vi } from "vitest";
import { applyMapProjection } from "@/components/map/mapProjection";

function createMap() {
  return {
    setProjection: vi.fn(),
    setFog: vi.fn(),
    jumpTo: vi.fn(),
    resize: vi.fn(),
  };
}

describe("applyMapProjection", () => {
  it("applies globe mode immediately while unrelated style sources are updating", () => {
    const map = createMap();

    expect(applyMapProjection(map, true, "dark")).toBe(true);
    expect(map.setProjection).toHaveBeenCalledWith({ type: "globe" });
    expect(map.setFog).toHaveBeenCalledWith({
      range: [-1, 2],
      color: "#000b1e",
      "horizon-blend": 0.1,
    });
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.resize).toHaveBeenCalledOnce();
  });

  it("restores a north-up mercator view when leaving globe mode", () => {
    const map = createMap();

    expect(applyMapProjection(map, false, "standard")).toBe(true);
    expect(map.setProjection).toHaveBeenCalledWith({ type: "mercator" });
    expect(map.setFog).toHaveBeenCalledWith(null);
    expect(map.jumpTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0 });
    expect(map.resize).toHaveBeenCalledOnce();
  });

  it("reports a temporarily unavailable base style so the caller can retry", () => {
    const map = createMap();
    map.setProjection.mockImplementation(() => {
      throw new Error("Style is not done loading");
    });

    expect(applyMapProjection(map, true, "standard")).toBe(false);
    expect(map.setFog).not.toHaveBeenCalled();
    expect(map.resize).not.toHaveBeenCalled();
  });
});
