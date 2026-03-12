'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import FilterBar from '@/components/FilterBar';
import EventSidebar from '@/components/EventSidebar';
import { useNewsData } from '@/hooks/useNewsData';
import { useNewsFilter } from '@/hooks/useNewsFilter';

const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });

export default function Home() {
    const { news, isLoading, error, lastUpdated, fetchNews } = useNewsData();
    const {
        sources, setSources,
        categories, setCategories,
        timeRange, setTimeRange,
        mappedOnly, setMappedOnly,
        searchQuery, setSearchQuery,
        filteredNews
    } = useNewsFilter(news);

    const [isDarkMode, setIsDarkMode] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    
    // Initial mount and theme sync
    useEffect(() => {
        setMounted(true);
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            setIsDarkMode(false);
        }
    }, []);

    // Sync theme to CSS
    useEffect(() => {
        if (!mounted) return;
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    }, [isDarkMode, mounted]);


    const toggleTheme = () => {
        const newTheme = !isDarkMode;
        setIsDarkMode(newTheme);
        localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    };

    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
    }, []);

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
                    <button onClick={() => fetchNews(true)}>Retry</button>
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
                        <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
                    </svg>
                </button>
            )}

            <EventSidebar
                items={filteredNews}
                selectedItemId={selectedItemId}
                selectionVersion={selectionVersion}
                onSelectItem={handleSelectItem}
                isLoading={isLoading}
                lastUpdated={lastUpdated}
                onRefresh={() => fetchNews(true)}
                isOpen={isSidebarOpen}
                onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                filterBar={filterBarSlot}
                isDarkMode={isDarkMode}
                onToggleTheme={toggleTheme}
                mounted={mounted}
            />

            <main className={`main-content ${!isSidebarOpen ? 'sidebar-collapsed' : ''}`}>
                <NewsMap
                    items={filteredNews}
                    selectedItemId={selectedItemId}
                    selectionVersion={selectionVersion}
                    onSelectItem={handleSelectItem}
                    isDarkMode={isDarkMode}
                />
            </main>
        </div>
    );
}
