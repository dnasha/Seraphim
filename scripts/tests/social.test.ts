import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchXFeed, scrapeTelegramChannel } from "@/lib/api/social";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("social adapters", () => {
  it("extracts usable Telegram posts, strips Telegram action links, and preserves external links", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <div class="tgme_widget_message" data-post="example/42">
        <div class="tgme_widget_message_text">A meaningful field report <a href="https://example.com/source">source</a><a href="tg://user?id=1">ignored</a></div>
        <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.example.com/field-report.jpg')"></a>
        <time datetime="2026-01-01T00:00:00Z"></time>
      </div>`, { status: 200 })));

    const result = await scrapeTelegramChannel({ name: "Example Channel", url: "https://t.me/s/example", platform: "telegram", category: "world", credibility_tier: 2 });

    expect(result).toEqual([expect.objectContaining({
      id: "social-tg-example-channel-0-1767312000000",
      url: "https://t.me/example/42",
      sourceType: "social",
      tags: ["OSINT", "telegram"],
      description: expect.stringContaining("https://example.com/source"),
      imageUrl: "https://cdn.example.com/field-report.jpg",
      imageOrigin: "telegram",
    })]);
    expect(result[0].description).not.toContain("tg://");
  });

  it("removes Bellum Acta's embedded gambling promotion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <div class="tgme_widget_message" data-post="BellumActaNews/42">
        <div class="tgme_widget_message_text">A meaningful conflict report. ➖➖➖➖➖➖ 💧 Rainbet.com the #1 casino promotion</div>
        <time datetime="2026-01-01T00:00:00Z"></time>
      </div>`, { status: 200 })));

    const result = await scrapeTelegramChannel({ name: "Bellum Acta News (Telegram)", url: "https://t.me/s/BellumActaNews", platform: "telegram", category: "crisis", credibility_tier: 3 });

    expect(result[0].description).toBe("A meaningful conflict report.");
    expect(result[0].description).not.toMatch(/Rainbet/i);
  });

  it("returns no Telegram items for failed upstream responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    await expect(scrapeTelegramChannel({ name: "Example", url: "https://t.me/s/example", platform: "telegram", category: "world", credibility_tier: 2 })).resolves.toEqual([]);
  });

  it("uses a successful syndication response for X when alternate strategies fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const timeline = {
      props: { pageProps: { timeline: { entries: [{ type: "tweet", content: { tweet: {
        full_text: "Syndicated breaking report",
        permalink: "/example/status/1",
        created_at: "2026-01-01T00:00:00Z",
        mediaDetails: [{
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/report.jpg",
        }],
      } } }] } } },
    };
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("https://syndication.twitter.com/")) {
        return Promise.resolve(new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(timeline)}</script>`, { status: 200 }));
      }
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }));

    const result = await fetchXFeed({ name: "Example X", url: "example", platform: "x", category: "world", credibility_tier: 2 });

    expect(result).toEqual([expect.objectContaining({
      title: "Syndicated breaking report",
      url: "https://x.com/example/status/1",
      sourceType: "social",
      tags: ["OSINT", "x"],
      imageUrl: "https://pbs.twimg.com/media/report.jpg",
      imageOrigin: "x",
    })]);
  });

  it("rejects stale timelines instead of falling back to Google News", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));
    const staleTimeline = {
      props: { pageProps: { timeline: { entries: [{ type: "tweet", content: { tweet: {
        full_text: "A detailed but obsolete report that must not re-enter the database",
        permalink: "/example/status/1",
        created_at: "2025-01-01T00:00:00Z",
      } } }] } } },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("https://syndication.twitter.com/")) {
        return Promise.resolve(new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(staleTimeline)}</script>`, { status: 200 }));
      }
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchXFeed({ name: "Example X", url: "example", platform: "x", category: "world", credibility_tier: 2 })).resolves.toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("news.google.com"))).toBe(false);
  });

  it("rejects media-placeholder posts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const timeline = {
      props: { pageProps: { timeline: { entries: [
        { type: "tweet", content: { tweet: {
          full_text: "Gif",
          permalink: "/example/status/1",
          created_at: "2026-01-01T00:00:00Z",
        } } },
        { type: "tweet", content: { tweet: {
          full_text: "R to @GeoConfirmed: Related:",
          permalink: "/example/status/2",
          created_at: "2026-01-01T01:00:00Z",
        } } },
      ] } } },
    };
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("https://syndication.twitter.com/")) {
        return Promise.resolve(new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(timeline)}</script>`, { status: 200 }));
      }
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }));

    await expect(fetchXFeed({ name: "Example X", url: "example", platform: "x", category: "world", credibility_tier: 2 })).resolves.toEqual([]);
  });
});
