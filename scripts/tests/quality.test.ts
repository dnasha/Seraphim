import { describe, expect, it } from "vitest";
import { filterItemsByQuality, getQualityRejectionReason } from "@/scraper/utils/quality";
import type { NewsItem } from "@/lib/core/types";

const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  id: "1",
  title: "A useful mapped report",
  description: "This is a substantive description with enough context to explain what happened, where it happened, and why the event matters.",
  url: "https://example.com/world/report",
  source: "BBC World",
  sourceType: "rss",
  category: "world",
  publishedAt: "2026-07-12T00:00:00Z",
  ...overrides,
});

describe("source quality gate", () => {
  it("does not reject concise items from sources that are not degraded", () => {
    expect(getQualityRejectionReason(item({ description: "Brief alert." }))).toBeNull();
  });

  it.each(["Indian Express", "Nikkei Asia", "Romania Insider", "Nature"])(
    "requires a substantive description from %s",
    (source) => {
      expect(getQualityRejectionReason(item({ source, description: "" })))
        .toBe("insubstantial_description");
    },
  );

  it("rejects irrelevant Indian Express sections even with a long description", () => {
    expect(getQualityRejectionReason(item({
      source: "Indian Express",
      url: "https://indianexpress.com/article/sports/cricket/example",
    }))).toBe("irrelevant_section");
  });

  it("reports rejection counts while retaining accepted items", () => {
    const result = filterItemsByQuality([
      item(),
      item({ source: "Nature", description: "" }),
      item({ source: "Indian Express", url: "https://indianexpress.com/article/lifestyle/example" }),
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejectedByReason).toEqual({
      irrelevant_section: 1,
      insubstantial_description: 1,
      clearly_non_event: 0,
    });
  });

  it("rejects only unmistakable non-events and preserves significant exceptions", () => {
    expect(getQualityRejectionReason(item({ title: "Daily horoscope for every star sign" })))
      .toBe("clearly_non_event");
    expect(getQualityRejectionReason(item({
      title: "Stadium evacuation after explosion interrupts match",
      description: "Authorities evacuated spectators after an explosion near the venue.",
    }))).toBeNull();
  });

  it.each([
    "N.J. football’s 2026 statewide, conference-by-conference returning defensive stat leaders",
    "São Paulo Nightlife Tonight — August 15, 2026",
    "Rio de Janeiro Nightlife Tonight — August 15, 2026",
    "Rio de Janeiro Daily Brief for Thursday, August 13, 2026",
    "Today in Korean history",
    "10 most expensive homes sold in North Bergen area, Aug. 3-9",
  ])("rejects recurring editorial template: %s", (title) => {
    expect(getQualityRejectionReason(item({ title }))).toBe("clearly_non_event");
  });
});
