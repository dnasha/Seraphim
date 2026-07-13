import { describe, expect, it } from "vitest";
import {
  canonicalizeEventUrl,
  cleanAndCapDescription,
  lowSignalExpiry,
  normalizeTitleFingerprint,
  prepareIncomingItems,
  shouldExpireLowSignalEvent,
} from "@/scraper/utils/content";
import type { NewsItem } from "@/lib/core/types";

const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: "1",
  title: "Officials report disruption in Port City",
  description: "A concrete report with enough context.",
  url: "https://EXAMPLE.com/story/?utm_source=rss&article=7#section",
  source: "Example",
  sourceType: "rss",
  category: "world",
  publishedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("lean ingestion content normalization", () => {
  it("removes only recognized tracking parameters", () => {
    expect(canonicalizeEventUrl("https://EXAMPLE.com/a/?utm_source=x&ref=essential&fbclid=1"))
      .toBe("https://example.com/a?ref=essential");
  });

  it("caps descriptions and removes a trailing subscription block", () => {
    const text = `${"Useful reporting. ".repeat(150)}\nSubscribe now for more`;
    const cleaned = cleanAndCapDescription(text);
    expect(cleaned.length).toBeLessThanOrEqual(2_000);
    expect(cleaned).not.toContain("Subscribe now");
  });

  it("deduplicates same-source title variants while keeping the richer item", () => {
    const result = prepareIncomingItems([
      item({ id: "short", description: "Short." }),
      item({ id: "long", title: "Officials report disruption in Port City!", description: "A much richer and more useful report." }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("long");
    expect(result[0].url).toBe("https://example.com/story?article=7");
  });

  it("deduplicates a canonical URL across different sources and titles", () => {
    const result = prepareIncomingItems([
      item({ id: "first", source: "Feed A", title: "Initial report from Port City", description: "Short." }),
      item({ id: "richer", source: "Feed B", title: "Port City disruption affects shipping", description: "A richer report about the same article URL." }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("richer");
  });

  it("coerces malformed XML title, URL, and description fields without crashing", () => {
    const malformed = item({
      title: { _: "Flood warning issued for Port City" } as unknown as string,
      url: ["https://example.com/flood?utm_source=feed"] as unknown as string,
      description: { "#text": "Officials issued an evacuation warning." } as unknown as string,
    });

    expect(prepareIncomingItems([malformed])).toEqual([
      expect.objectContaining({
        title: "Flood warning issued for Port City",
        url: "https://example.com/flood",
        description: "Officials issued an evacuation warning.",
      }),
    ]);
  });

  it("drops entries whose malformed title cannot be converted to meaningful text", () => {
    expect(prepareIncomingItems([
      item({ title: { unexpected: true } as unknown as string }),
    ])).toEqual([]);
  });

  it("normalizes conservative exact-title fingerprints", () => {
    expect(normalizeTitleFingerprint("Café blast — officials respond"))
      .toBe("café blast officials respond");
  });

  it("expires only low-signal tier-three social commentary", () => {
    expect(shouldExpireLowSignalEvent({
      title: "Weekend analysis thread",
      sourceType: "social",
      credibilityTier: 3,
    })).toBe(true);
    expect(shouldExpireLowSignalEvent({
      title: "Analysis: missile attack reported near port",
      sourceType: "social",
      credibilityTier: 3,
    })).toBe(false);
    expect(lowSignalExpiry("2026-01-01T00:00:00Z")).toBe("2026-06-30T00:00:00.000Z");
  });
});
