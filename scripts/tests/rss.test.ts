import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parseString: vi.fn() }));

vi.mock("rss-parser", () => ({
  default: class {
    parseString = mocks.parseString;
  },
}));

vi.mock("@/lib/security/feedFetch", () => ({
  fetchBoundedFeedText: async (url: string, options: { headers?: HeadersInit }) => {
    const response = await fetch(url, { headers: options.headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (!text.startsWith("<")) throw new Error("Invalid XML response");
    return text;
  },
}));

import { fetchAllRedditFeeds, fetchRedditFeed, fetchSingleFeed } from "@/lib/api/rss";
import { RSS_SOURCES } from '@/data/sources';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RSS adapters", () => {
  it('configures every publisher feed with HTTPS', () => {
    expect(RSS_SOURCES.every((source) => new URL(source.url).protocol === 'https:')).toBe(true);
  });

  it("normalizes standard feeds and prefers MediaRSS images", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<rss></rss>", { status: 200 })));
    mocks.parseString.mockResolvedValue({ items: [{
      title: "Headline",
      contentSnippet: "Summary",
      link: "https://example.com/post",
      pubDate: "2026-01-01T00:00:00Z",
      "media:content": { $: { url: "https://example.com/image.jpg" } },
    }] });

    const result = await fetchSingleFeed({ name: "Example Feed", url: "https://feed.example/rss", category: "world", credibility_tier: 1 });

    expect(result).toEqual([expect.objectContaining({
      id: "rss-example-feed-0-1767312000000",
      title: "Headline",
      sourceType: "rss",
      category: "world",
      imageUrl: "https://example.com/image.jpg",
    })]);
  });

  it("rejects non-XML and HTTP failures without passing unsafe input to the parser", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not xml", { status: 200 }))
      .mockResolvedValueOnce(new Response("failure", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSingleFeed({ name: "Example", url: "https://feed.example/rss", category: "world", credibility_tier: 1 })).resolves.toEqual([]);
    await expect(fetchSingleFeed({ name: "Example", url: "https://feed.example/rss", category: "world", credibility_tier: 1 })).resolves.toEqual([]);
    expect(mocks.parseString).not.toHaveBeenCalled();
  });

  it("normalizes Reddit feeds and supplies the subreddit URL when an item has no link", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<feed></feed>", { status: 200 })));
    mocks.parseString.mockResolvedValue({ items: [{ title: "Reddit report", content: "details", isoDate: "2026-01-01T00:00:00Z" }] });

    const result = await fetchRedditFeed({ name: "OSINT", subreddit: "osint", category: "technology", credibility_tier: 2, region: "global" });

    expect(result[0]).toMatchObject({
      sourceType: "social",
      url: "https://www.reddit.com/r/osint",
      category: "technology",
    });
  });

  it("bounds concurrent Reddit requests to avoid runner-wide rate-limit bursts", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return new Response("<feed></feed>", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.parseString.mockResolvedValue({ items: [] });

    await fetchAllRedditFeeds(0);

    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
