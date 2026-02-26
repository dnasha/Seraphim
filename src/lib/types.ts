export interface NewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  sourceType: 'gnews' | 'rss';
  category?: string;
  publishedAt: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
}

export interface NewsResponse {
  items: NewsItem[];
  lastUpdated: string;
  sources: {
    gnews: boolean;
    rss: boolean;
  };
}

export type NewsCategory =
  | 'general'
  | 'world'
  | 'nation'
  | 'crisis'
  | 'business'
  | 'technology'
  | 'science'
  | 'health';
