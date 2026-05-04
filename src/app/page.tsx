/*
  Main application entry point.
  Coordinates the layout, data fetching, filtering logic, and state management
  between the map, sidebar, and filter components.
*/

'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import FilterBar from '@/components/FilterBar';
import EventSidebar from '@/components/EventSidebar';
import { useNewsData } from '@/hooks/useNewsData';
import { useNewsFilter } from '@/hooks/useNewsFilter';
import styles from '@/components/Layout.module.css';

// Dynamically import NewsMap to prevent SSR issues with MapLibre library
const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });

export default function Home() {
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    
    // Filtering and time range state
    const [mappedOnly, setMappedOnly] = useState(true);
    const [timeRange, setTimeRange] = useState('1d');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    
    // Search and debounce state
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    // Effect to debounce search input to minimize API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Data fetching and filtering hooks
    const { news, isLoading, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
        includeUnmapped: !mappedOnly,
        timeRange,
        searchQuery: debouncedSearch,
        customStartDate,
        customEndDate,
    });
    
    const {
        sources, setSources,
        categories, setCategories,
        filteredNews
    } = useNewsFilter(news, mappedOnly, timeRange, debouncedSearch, customStartDate, customEndDate);

    // UI and interaction state
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const isDarkMode = resolvedTheme === 'dark';

    // Callback to handle item selection from map or sidebar
    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
    }, []);

    // Handles changes to the time range filter, including custom date initialization
    const handleTimeRangeChange = useCallback((range: string) => {
        setTimeRange(range);
        if (range === 'custom' && (!customStartDate || !customEndDate)) {
            // Default custom range to the last 24 hours
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const toLocalISO = (d: Date) => {
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            setCustomStartDate(toLocalISO(yesterday));
            setCustomEndDate(toLocalISO(now));
        }
    }, [customStartDate, customEndDate]);

    // Fetch full description when an item is selected if not already present
    useEffect(() => {
        if (selectedItemId) {
            const item = news.find(i => i.id === selectedItemId);
            if (item && item.description === undefined) {
                fetchEventDetails(selectedItemId);
            }
        }
    }, [selectedItemId, news, fetchEventDetails]);

    // Component slot for the filter bar and error notifications
    const filterBarSlot = (
        <>
            <FilterBar
                sources={sources}
                onSourcesChange={setSources}
                categories={categories}
                onCategoriesChange={setCategories}
                timeRange={timeRange}
                onTimeRangeChange={handleTimeRangeChange}
                customStartDate={customStartDate}
                onCustomStartDateChange={setCustomStartDate}
                customEndDate={customEndDate}
                onCustomEndDateChange={setCustomEndDate}
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
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
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

