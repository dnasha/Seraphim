'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import FilterBar from '@/components/FilterBar';
import EventSidebar from '@/components/EventSidebar';
import { NewsItem, NewsResponse } from '@/lib/types';

const NewsMap = dynamic(() => import('@/components/NewsMap'), { ssr: false });

export default function Home() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  // Filters
  const [sources, setSources] = useState<string[]>(['rss']);
  const [categories, setCategories] = useState<string[]>(['general']);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark');
    } else {
      setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);

  const fetchNews = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        sources: sources.join(','),
        categories: categories.join(','),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(forceRefresh && { refresh: 'true' }),
      });

      const response = await fetch(`/api/news?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch news');
      }

      const data: NewsResponse = await response.json();
      setNews(data.items);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [sources, categories, debouncedSearch]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchNews(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  const handleSelectItem = (id: string) => {
    setSelectedItemId(id);
    setSelectionVersion(v => v + 1);
  };

  const filterBarSlot = (
    <>
      <FilterBar
        sources={sources}
        onSourcesChange={setSources}
        categories={categories}
        onCategoriesChange={setCategories}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={() => fetchNews(true)}
        isLoading={isLoading}
      />
      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          {error}
          <button onClick={() => fetchNews()}>Retry</button>
        </div>
      )}
    </>
  );

  return (
    <div className="app-layout">
      <EventSidebar
        items={news}
        selectedItemId={selectedItemId}
        selectionVersion={selectionVersion}
        onSelectItem={handleSelectItem}
        isLoading={isLoading}
        filterBar={filterBarSlot}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        lastUpdated={lastUpdated}
      />

      <NewsMap
        items={news}
        selectedItemId={selectedItemId}
        selectionVersion={selectionVersion}
        onSelectItem={handleSelectItem}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}
