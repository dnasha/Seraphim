import { describe, expect, it } from "vitest";
import {
  canonicalizeEventUrl,
  cleanAndCapTitle,
  cleanAndCapDescription,
  lowSignalExpiry,
  isRecurringTemplatePair,
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

  it("fails closed for malformed and unsupported event URLs", () => {
    expect(canonicalizeEventUrl("https://%" )).toBe("");
    expect(canonicalizeEventUrl("javascript:alert(1)")).toBe("");
    expect(prepareIncomingItems([item({ url: "https://%" })])).toEqual([]);
  });

  it("caps titles before downstream processing without splitting Unicode", () => {
    const cleaned = cleanAndCapTitle(`${"A".repeat(499)}😀${"B".repeat(10_000)}`);
    expect([...cleaned]).toHaveLength(500);
    expect(cleaned.endsWith("😀")).toBe(true);
    expect(prepareIncomingItems([item({ title: `${"C".repeat(10_000)} Port City` })])[0].title)
      .toHaveLength(500);
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

  it('preserves identical generic headlines with different incident descriptions and URLs', () => {
    expect(prepareIncomingItems([
      item({ title: 'Three people killed in motorway crash', description: 'A crash on the M1 near Leeds.', url: 'https://example.com/leeds' }),
      item({ title: 'Three people killed in motorway crash', description: 'A crash on the M6 near Birmingham.', url: 'https://example.com/birmingham' }),
    ])).toHaveLength(2);
  });

  it('deduplicates known X mirror status identities while retaining the richer original URL', () => {
    const url = 'https://xcancel.com/account/status/123456789';
    const result = prepareIncomingItems([
      item({ url: 'https://nitter.poast.org/account/status/123456789', description: 'Short.' }),
      item({ url, description: 'A longer report on the same status.' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(url);
  });

  it.each([
    ['Russian Offensive Campaign Assessment, September 18, 2026', 'Russian Offensive Campaign Assessment, September 19, 2026'],
    ['Campaign assessment - 2026-09-18', 'Campaign assessment - 2026-09-19'],
    ['Campaign assessment, 18 September 2026', 'Campaign assessment, 19 September 2026'],
    ['São Paulo Nightlife Tonight — August 14, 2026', 'São Paulo Nightlife Tonight — August 15, 2026'],
  ])('recognizes calendar editions: %s / %s', (a, b) => {
    expect(isRecurringTemplatePair(a, b)).toBe(true);
  });

  it.each([
    ['Factory explosion kills 12 workers', 'Factory explosion kills 13 workers'],
    ['Factory explosion kills 100 workers', 'Factory explosion kills 101 workers'],
    ['Monday factory explosion kills 12 workers', 'Monday factory explosion kills 13 workers'],
    ['Korea wins volleyball final 3-1', 'Korea wins volleyball final 3-2'],
  ])('keeps incident quantities in the identity: %s / %s', (a, b) => {
    expect(isRecurringTemplatePair(a, b)).toBe(false);
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
