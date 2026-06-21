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
        <time datetime="2026-01-01T00:00:00Z"></time>
      </div>`, { status: 200 })));

    const result = await scrapeTelegramChannel({ name: "Example Channel", url: "https://t.me/s/example", platform: "telegram", category: "world", credibility_tier: 2 });

    expect(result).toEqual([expect.objectContaining({
      id: "social-tg-example-channel-0-1767312000000",
      url: "https://t.me/example/42",
      sourceType: "social",
      tags: ["OSINT", "telegram"],
      description: expect.stringContaining("https://example.com/source"),
    })]);
    expect(result[0].description).not.toContain("tg://");
  });

  it("returns no Telegram items for failed upstream responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    await expect(scrapeTelegramChannel({ name: "Example", url: "https://t.me/s/example", platform: "telegram", category: "world", credibility_tier: 2 })).resolves.toEqual([]);
  });

  it("uses a successful syndication response for X when alternate strategies fail", async () => {
    const timeline = {
      props: { pageProps: { timeline: { entries: [{ type: "tweet", content: { tweet: {
        full_text: "Syndicated report",
        permalink: "/example/status/1",
        created_at: "2026-01-01T00:00:00Z",
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
      title: "Syndicated report",
      url: "https://x.com/example/status/1",
      sourceType: "social",
      tags: ["OSINT", "x"],
    })]);
  });
});
