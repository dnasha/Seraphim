import { describe, expect, it } from "vitest";
import {
  canOptimizeNewsImage,
  getNewsImagePresentation,
  selectNewsImageWidth,
} from "@/lib/utils/newsImages";

const UUID = "4dd43334-01da-4d2f-a56b-48ec061b2b80";

describe("news image optimization allowlist", () => {
  it("optimizes known high-volume HTTPS image hosts", () => {
    expect(canOptimizeNewsImage("https://images.indianexpress.com/story.jpg")).toBe(true);
    expect(canOptimizeNewsImage("https://img.lemde.fr/story.jpg")).toBe(true);
  });

  it("leaves unknown, insecure, and malformed image URLs off the Next proxy", () => {
    expect(canOptimizeNewsImage("https://untrusted.example/story.jpg")).toBe(false);
    expect(canOptimizeNewsImage("http://images.indianexpress.com/story.jpg")).toBe(false);
    expect(canOptimizeNewsImage("not-a-url")).toBe(false);
  });
});

describe("news image presentation", () => {
  it("keeps allowlisted sources on the Next image optimizer", () => {
    expect(getNewsImagePresentation({
      id: UUID,
      imageUrl: "https://ichef.bbci.co.uk/news/1024/story.jpg",
    }, 176)).toEqual({
      src: "https://ichef.bbci.co.uk/news/1024/story.jpg",
      unoptimized: false,
      proxied: false,
    });
  });

  it("routes arbitrary ingested hosts through an event-bound thumbnail", () => {
    const result = getNewsImagePresentation({
      id: UUID,
      imageUrl: "https://www.aljazeera.com/wp-content/uploads/story.jpg",
    }, 90);

    expect(result).toMatchObject({
      unoptimized: true,
      proxied: true,
    });
    expect(result?.src).toMatch(
      new RegExp(`^/api/news-image/${UUID}\\?w=176&v=[a-z0-9]+$`),
    );
  });

  it("uses a cluster's backing event ID and deterministic cache version", () => {
    const item = {
      id: "cluster-z2-1.0000-2.0000-4",
      originalId: UUID,
      imageUrl: "https://publisher.example/story.jpg",
    };
    const first = getNewsImagePresentation(item, 500);
    const second = getNewsImagePresentation(item, 500);

    expect(first).toEqual(second);
    expect(first?.src).toContain(`/api/news-image/${UUID}?w=640&v=`);
  });

  it("falls back to the original URL without a database-backed UUID", () => {
    expect(getNewsImagePresentation({
      id: "external-event",
      imageUrl: "https://publisher.example/story.jpg",
    }, 176)).toEqual({
      src: "https://publisher.example/story.jpg",
      unoptimized: true,
      proxied: false,
    });
  });

  it("bounds thumbnail variants", () => {
    expect(selectNewsImageWidth(-1)).toBe(176);
    expect(selectNewsImageWidth(177)).toBe(640);
    expect(selectNewsImageWidth(900)).toBe(960);
    expect(selectNewsImageWidth(10_000)).toBe(960);
  });
});
