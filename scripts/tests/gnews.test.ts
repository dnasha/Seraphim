import { afterEach, describe, expect, it, vi } from "vitest";

const article = {
  title: "Satellite imagery confirms strike",
  description: "A confirmed strike was reported.",
  content: "",
  url: "https://example.com/story",
  image: "https://example.com/story.png",
  publishedAt: "2026-01-01T00:00:00.000Z",
  source: { name: "Example News", url: "https://example.com" },
};

async function loadGNews(apiKey = "test-key") {
  vi.resetModules();
  vi.stubEnv("GNEWS_API_KEY", apiKey);
  return import("@/lib/api/gnews");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GNews adapter", () => {
  it("does not make requests without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGNews } = await loadGNews("");

    await expect(fetchGNews()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes top headlines and builds the expected request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T04:05:06.000Z"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ totalArticles: 1, articles: [article] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGNews } = await loadGNews();

    await expect(fetchGNews("world", 7, 1234)).resolves.toEqual([expect.objectContaining({
      id: "gnews-world-0-1770091506000",
      sourceType: "gnews",
      category: "world",
      imageUrl: article.image,
    })]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/top-headlines?");
    expect(url).toContain("category=world");
    expect(url).toContain("max=7");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns an empty list for quota failures and malformed upstream responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(new Response("upstream", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGNews, searchGNews } = await loadGNews();

    await expect(fetchGNews()).resolves.toEqual([]);
    await expect(searchGNews("test")).resolves.toEqual([]);
  });

  it("marks OSINT results as crisis content with matching tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ totalArticles: 1, articles: [article] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchOSINTGNews } = await loadGNews();

    const [result] = await fetchOSINTGNews();
    expect(result).toMatchObject({ category: "crisis" });
    expect(result.tags).toEqual(expect.arrayContaining(["OSINT", "imagery", "strike"]));
  });

  it("uses targeted outbreak discovery for the health category", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ totalArticles: 1, articles: [article] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchHealthEventGNews } = await loadGNews();

    const [result] = await fetchHealthEventGNews(12);
    expect(result).toMatchObject({ category: "health", tags: ["health-event"] });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("%22disease+outbreak%22");
    expect(url).toContain("max=12");
  });
});
