'use client';

/** Application entry point coordinating layout, data filtering, and theme management. */

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import FilterBar from '@/components/FilterBar';
import EventSidebar from '@/components/EventSidebar';
import { useNewsData } from '@/hooks/useNewsData';
import { useNewsFilter } from '@/hooks/useNewsFilter';
import styles from '@/components/Layout.module.css';

// Dynamically import NewsMap to prevent SSR issues with MapLibre
const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });

export default function Home() {
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    
    const [mappedOnly, setMappedOnly] = useState(true);
    // timeRange shared between server-side and client-side filtering
    const [timeRange, setTimeRange] = useState('1d');
    
    // Search state for global data fetching
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Data and Filter State
    const { news, isLoading, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
        includeUnmapped: !mappedOnly,
        timeRange,
        searchQuery: debouncedSearch,
    });
    
    const {
        sources, setSources,
        categories, setCategories,
        filteredNews
    } = useNewsFilter(news, mappedOnly, timeRange, debouncedSearch);

    // UI State
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const isDarkMode = resolvedTheme === 'dark';

    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
    }, []);

    // Lazy load description whenever an item is selected (from sidebar or map)
    useEffect(() => {
        if (selectedItemId) {
            const item = news.find(i => i.id === selectedItemId);
            if (item && item.description === undefined) {
                fetchEventDetails(selectedItemId);
            }
        }
    }, [selectedItemId, news, fetchEventDetails]);

    // Reusable UI Slots
    const filterBarSlot = (
        <>
            <FilterBar
                sources={sources}
                onSourcesChange={setSources}
                categories={categories}
                onCategoriesChange={setCategories}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
            />
            {error && (
                <div className="error-banner">
                    <span className="error-icon">!!!</span>
                    {error}
                    <button onClick={() => fetchNews(true)}>Retry</button>
                </div>
            )}
        </>
    );

    return (
        <div className={styles.appLayout}>
            {!isSidebarOpen && (
                <button
                    className={styles.sidebarExpandBtn}
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
                onFetchDetails={fetchEventDetails}
                isOpen={isSidebarOpen}
                onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                filterBar={filterBarSlot}
                mounted={mounted}
            />

            <main className={`${styles.mainContent} ${!isSidebarOpen ? styles.mainContentCollapsed : ''}`}>
                <NewsMap
                    items={filteredNews}
                    selectedItemId={selectedItemId}
                    selectionVersion={selectionVersion}
                    onSelectItem={handleSelectItem}
                    isDarkMode={isDarkMode}
                    mappedOnly={mappedOnly}
                    onMappedOnlyChange={setMappedOnly}
                    onBoundsChange={onBoundsChange}
                />
            </main>
        </div>
    );
}
