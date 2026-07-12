import { describe, expect, it } from "vitest";
import { calculateMergedStory, evaluateContentUpdate } from "@/lib/utils/merging";
import type { DbEvent, DbEventSource } from "@/types";

const at = (hours: number) => new Date(Date.UTC(2026, 0, 1, hours)).toISOString();

const source = (overrides: Partial<DbEventSource> = {}): DbEventSource => ({
  name: "Current source",
  url: "https://example.com/current",
  source_type: "rss",
  discovered_at: at(0),
  ...overrides,
});

const incoming = (overrides: Partial<DbEvent> = {}): DbEvent => ({
  title: "Incoming update",
  description: "A fuller incoming description.",
  url: "https://example.com/incoming",
  source: "Incoming source",
  source_type: "rss",
  published_at: at(1),
  credibility_tier: 2,
  ...overrides,
});

describe("evaluateContentUpdate", () => {
  const current = {
    title: "Current title",
    description: "Current description has enough detail.",
    tier: 2,
    contentPublishedAt: Date.parse(at(0)),
    latestClusterTime: Date.parse(at(0)),
  };

  it("lets higher-credibility content replace both title and description", () => {
    expect(evaluateContentUpdate(current, {
      title: "Verified update",
      description: "Short but verified.",
      tier: 1,
      publishedAt: Date.parse(at(0)),
    })).toEqual({ updateTitle: true, updateDescription: true, shouldUpdateMaster: true });
  });

  it("updates a same-tier title for fresher reporting without discarding a deeper description", () => {
    expect(evaluateContentUpdate(current, {
      title: "Fresh headline",
      description: "short",
      tier: 2,
      publishedAt: Date.parse(at(1)),
    })).toEqual({ updateTitle: true, updateDescription: false, shouldUpdateMaster: true });
  });

  it("allows a one-tier-lower source to replace stale, comparably detailed content", () => {
    const result = evaluateContentUpdate(current, {
      title: "Breaking later report",
      description: "This replacement is detailed enough to retain useful context.",
      tier: 3,
      publishedAt: Date.parse(at(7)),
    });

    expect(result).toEqual({ updateTitle: true, updateDescription: true, shouldUpdateMaster: true });
  });

  it("does not promote older lower-credibility content", () => {
    expect(evaluateContentUpdate(current, {
      title: "Old unverified report",
      description: "Very long but stale unverified content that must not replace the master.",
      tier: 3,
      publishedAt: Date.parse(at(-1)),
    })).toEqual({ updateTitle: false, updateDescription: false, shouldUpdateMaster: false });
  });
});

describe("calculateMergedStory", () => {
  it("adds the corroborating source, advances the cluster, and promotes better content", () => {
    const existing = {
      id: "event-1",
      title: "Initial report",
      description: "Initial details.",
      source: "Current source",
      source_type: "rss" as const,
      url: "https://example.com/current",
      credibility_tier: 3,
      published_at: at(0),
      sources: [source()],
    };

    const result = calculateMergedStory(existing, incoming({ credibility_tier: 1, published_at: at(2) }));

    expect(result).toMatchObject({
      id: "event-1",
      title: "Incoming update",
      description: "A fuller incoming description.",
      source: "Incoming source",
      url: "https://example.com/incoming",
      credibility_tier: 1,
      source_type: "rss",
      published_at: at(2),
      event_count: 2,
      impact_score: 8,
    });
    expect(result.sources).toEqual([source()]);
  });

  it("keeps the current master timestamp when an older source is merely corroborating", () => {
    const existing = {
      id: "event-1",
      title: "Current report",
      description: "Current details that remain better.",
      source: "Current source",
      source_type: "rss" as const,
      url: "https://example.com/current",
      credibility_tier: 1,
      published_at: at(4),
      sources: [source({ discovered_at: at(4) })],
    };

    const result = calculateMergedStory(existing, incoming({
      title: "Older corroboration",
      description: "Brief older report.",
      credibility_tier: 3,
      published_at: at(2),
    }));

    expect(result).toMatchObject({ published_at: at(4), event_count: 2, impact_score: 8 });
    expect(result).not.toHaveProperty("title");
    expect(result).not.toHaveProperty("description");
  });

  it("removes the primary from corroborators and deduplicates legacy entries", () => {
    const existing = {
      id: "event-1",
      title: "Current report",
      description: "Current details.",
      source: "Current source",
      source_type: "rss" as const,
      url: "https://example.com/current",
      credibility_tier: 1,
      published_at: at(4),
      sources: [source(), source(), source({
        name: "Prior corroborator",
        url: "https://example.com/prior",
      })],
    };

    const result = calculateMergedStory(existing, incoming({
      source: "Incoming social",
      source_type: "social",
      credibility_tier: 1,
      published_at: at(5),
    }));

    expect(result.source_type).toBe("social");
    expect(result.sources.map((entry) => entry.url)).toEqual([
      "https://example.com/current",
      "https://example.com/prior",
    ]);
    expect(result.sources).not.toContainEqual(expect.objectContaining({
      url: "https://example.com/incoming",
    }));
    expect(result.event_count).toBe(3);
  });
});
