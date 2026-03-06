'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Filters
  const [sources, setSources] = useState<string[]>(['news', 'reddit', 'x', 'telegram']);
  const [categories, setCategories] = useState<string[]>(['general']);
  const [timeRange, setTimeRange] = useState<string>('1d');
  const [mappedOnly, setMappedOnly] = useState<boolean>(true);
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
        timeRange,
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
  }, [sources, categories, timeRange, debouncedSearch]);

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

  const handleSelectItem = useCallback((id: string | null) => {
    setSelectedItemId(id);
    setSelectionVersion(v => v + 1);
  }, []);

  const displayedNews = useMemo(() => {
    return mappedOnly ? news.filter(n => n.latitude !== undefined) : news;
  }, [news, mappedOnly]);

  const filterBarSlot = (
    <>
      <FilterBar
        sources={sources}
        onSourcesChange={setSources}
        categories={categories}
        onCategoriesChange={setCategories}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        mappedOnly={mappedOnly}
        onMappedOnlyChange={setMappedOnly}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
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
      {!isSidebarOpen && (
        <button
          className="sidebar-expand-btn"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
      )}

      <EventSidebar
        items={displayedNews}
        selectedItemId={selectedItemId}
        selectionVersion={selectionVersion}
        onSelectItem={handleSelectItem}
        isLoading={isLoading}
        filterBar={filterBarSlot}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        lastUpdated={lastUpdated}
        isOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onRefresh={() => fetchNews(true)}
      />

      <NewsMap
        items={displayedNews}
        selectedItemId={selectedItemId}
        selectionVersion={selectionVersion}
        onSelectItem={handleSelectItem}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}
