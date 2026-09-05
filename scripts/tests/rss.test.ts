import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parseString: vi.fn() }));

vi.mock("rss-parser", () => ({
  default: class {
    parseString = mocks.parseString;
  },
}));

vi.mock("@/lib/security/feedFetch", () => ({
  fetchBoundedFeed: async (url: string, options: { headers?: HeadersInit }) => {
    const response = await fetch(url, { headers: options.headers });
    if (response.status === 304) return { notModified: true, text: null };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (!text.startsWith("<")) throw new Error("Invalid XML response");
    return {
      notModified: false,
      text,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  },
  fetchBoundedFeedText: async (url: string, options: { headers?: HeadersInit }) => {
    const response = await fetch(url, { headers: options.headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (!text.startsWith("<")) throw new Error("Invalid XML response");
    return text;
  },
}));

import { fetchAllRedditFeeds, fetchRedditFeed, fetchSingleFeed } from "@/lib/api/rss";
import { REDDIT_SOURCES, RSS_SOURCES } from '@/data/sources';
import { selectDueSources } from '@/lib/api/sourcePolling';
import { sourceCircuitKey } from '@/lib/api/sourceCircuit';
import { beginSourceHealthCollection, completeSourceHealthCollection } from '@/lib/api/sourceHealth';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RSS adapters", () => {
  it('preserves content age across unchanged feeds and distinguishes stale from unknown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 304 }))));
    const source = { name: 'Example', url: 'https://feed.example/rss', category: 'world', credibility_tier: 1 as const };
    for (const [latestItemAt, expected] of [
      ['2026-09-04T23:00:00Z', 'healthy'], ['2026-09-01T00:00:00Z', 'stale'], [null, 'empty'],
    ] as const) {
      beginSourceHealthCollection();
      await expect(fetchSingleFeed(source, 1000, { validators: new Map([[source.url, { etag: 'v1', latestItemAt }]]) })).resolves.toEqual([]);
      expect(completeSourceHealthCollection()).toEqual([expect.objectContaining({ outcome: expected, latest_usable_item_at: latestItemAt })]);
    }
    expect(mocks.parseString).not.toHaveBeenCalled();
  });

  it('configures every publisher feed with HTTPS', () => {
    expect(RSS_SOURCES.every((source) => new URL(source.url).protocol === 'https:')).toBe(true);
  });

  it("normalizes standard feeds and prefers MediaRSS images", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(new Response("<rss></rss>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
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
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('user-agent')).toMatch(/^server:seraphim:/);
  });

  it('recovers a blocked primary publisher through its configured fallback feed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(new Response('<rss></rss>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.parseString.mockResolvedValue({ items: [{
      title: 'Fallback headline',
      link: 'https://publisher.example/story',
      pubDate: new Date().toISOString(),
    }] });

    const result = await fetchSingleFeed({
      name: 'Blocked Publisher',
      url: 'https://publisher.example/feed',
      fallbackUrls: ['https://news.google.com/rss/search?q=site%3Apublisher.example'],
      category: 'world',
      credibility_tier: 2,
    });
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://news.google.com/rss/search?q=site%3Apublisher.example',
      expect.any(Object),
    );
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

    expect(fetchMock).toHaveBeenCalledTimes(selectDueSources(REDDIT_SOURCES, () => 'normal', 0).length);
    expect(maxActive).toBe(1);
  });

  it('suppresses Reddit requests while source circuits are cooling down', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const openCircuits = new Set(REDDIT_SOURCES.map((source) =>
      sourceCircuitKey('reddit', source.name)
    ));
    await expect(fetchAllRedditFeeds(0, false, openCircuits)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
