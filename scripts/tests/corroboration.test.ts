import { describe, expect, it } from "vitest";
import {
  calculateImpactScore,
  countIndependentSources,
  publisherKey,
} from "@/lib/utils/corroboration";

describe("independent corroboration", () => {
  it("collapses subdomains and repeated articles from one publisher", () => {
    const primary = {
      name: "The Rio Times",
      url: "https://www.riotimesonline.com/sao-paulo-nightlife-tonight-august-15-2026",
      source_type: "rss",
    };
    const reports = Array.from({ length: 29 }, (_, index) => ({
      name: "The Rio Times",
      url: `https://news.riotimesonline.com/daily-brief-${index}`,
      source_type: "rss",
    }));

    expect(countIndependentSources(primary, reports)).toBe(1);
    expect(calculateImpactScore(2, 1)).toBe(1.5);
  });

  it("counts separate publisher domains as independent corroboration", () => {
    expect(countIndependentSources(
      { name: "Reuters", url: "https://reuters.com/report", source_type: "rss" },
      [
        { name: "BBC", url: "https://bbc.co.uk/news/report", source_type: "rss" },
        { name: "AP", url: "https://apnews.com/article/report", source_type: "rss" },
      ],
    )).toBe(3);
    expect(calculateImpactScore(1, 3)).toBe(10.5);
  });

  it("collapses identical syndicated headlines across publisher domains", () => {
    expect(countIndependentSources(
      {
        name: "Wire Service",
        url: "https://wire.example/report",
        source_type: "rss",
        title: "Port authority closes terminal after overnight fire",
      },
      [{
        name: "Republisher",
        url: "https://republisher.example/wire-copy",
        source_type: "rss",
        title: "Port authority closes terminal after overnight fire",
      }, {
        name: "Independent Local",
        url: "https://local.example/original-report",
        source_type: "rss",
        title: "Local crews battle terminal blaze as shipping halts",
      }],
    )).toBe(2);
  });

  it("keeps different social accounts independent on a shared platform", () => {
    expect(publisherKey({
      name: "Reporter One (X)",
      url: "https://x.com/reporter_one/status/1",
      source_type: "social",
    })).not.toBe(publisherKey({
      name: "Reporter Two (X)",
      url: "https://x.com/reporter_two/status/2",
      source_type: "social",
    }));
  });
});
