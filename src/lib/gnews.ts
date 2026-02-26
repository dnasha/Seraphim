import { NewsItem } from './types';

const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
const GNEWS_BASE_URL = 'https://gnews.io/api/v4';

interface GNewsArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    image: string;
    publishedAt: string;
    source: { name: string; url: string };
}

interface GNewsResponse {
    totalArticles: number;
    articles: GNewsArticle[];
}

export async function fetchGNews(
    category: string = 'general',
    maxResults: number = 10
): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not set, skipping gnews');
        return [];
    }

    try {
        const params = new URLSearchParams({
            category,
            lang: 'en',
            max: String(maxResults),
            apikey: GNEWS_API_KEY,
        });

        const res = await fetch(`${GNEWS_BASE_URL}/top-headlines?${params}`);
        if (!res.ok) throw new Error(`gnews responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        return data.articles.map((article, i) => ({
            id: `gnews-${category}-${i}-${Date.now()}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            sourceType: 'gnews' as const,
            category,
            publishedAt: article.publishedAt,
            imageUrl: article.image,
        }));
    } catch (error) {
        console.error('gnews fetch error:', error);
        return [];
    }
}

export async function searchGNews(query: string, maxResults: number = 10): Promise<NewsItem[]> {
    if (!GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not set, skipping gnews search');
        return [];
    }

    try {
        const params = new URLSearchParams({
            q: query,
            lang: 'en',
            max: String(maxResults),
            apikey: GNEWS_API_KEY,
        });

        const res = await fetch(`${GNEWS_BASE_URL}/search?${params}`);
        if (!res.ok) throw new Error(`gnews search responded ${res.status}`);

        const data: GNewsResponse = await res.json();

        return data.articles.map((article, i) => ({
            id: `gnews-search-${i}-${Date.now()}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            sourceType: 'gnews' as const,
            publishedAt: article.publishedAt,
            imageUrl: article.image,
        }));
    } catch (error) {
        console.error('gnews search error:', error);
        return [];
    }
}
