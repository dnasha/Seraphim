'use client';

import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import FilterBar from '@/components/FilterBar';
import EventSidebar from '@/components/EventSidebar';
import { useNewsData } from '@/hooks/useNewsData';
import { useNewsFilter } from '@/hooks/useNewsFilter';
import { useViewState } from '@/hooks/useViewState';
import { BBox } from '@/lib/geo';
import { SortMode } from '@/lib/filters';
import styles from '@/components/Layout.module.css';

// Dynamically import NewsMap to prevent SSR issues with MapLibre library
const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });

export function HomeContent({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
    const { resolvedTheme } = useTheme();
    // Official React 18+ way to detect hydration/client-side status without cascading renders
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const { updateURL } = useViewState();
    
    // Filtering and time range state (initialized from searchParams for SSR stability)
    const [unmappedOnly, setUnmappedOnly] = useState(false);
    const [timeRange, setTimeRange] = useState((searchParams.t as string) || '1d');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    
    // Search and debounce state (initialized from searchParams for SSR stability)
    const [searchQuery, setSearchQuery] = useState((searchParams.q as string) || '');
    const [debouncedSearch, setDebouncedSearch] = useState((searchParams.q as string) || '');
    const [sortMode, setSortMode] = useState<SortMode>((searchParams.s as SortMode) || 'new');
    const [currentBBox, setCurrentBBox] = useState<BBox | null>(null);
    
    // Map initial view state from searchParams
    const getParam = (key: string) => {
        const val = searchParams[key];
        return Array.isArray(val) ? val[0] : val;
    };

    const parseNum = (val: string | undefined) => {
        if (!val) return NaN;
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : NaN;
    };

    const initialLat = parseNum(getParam('lat'));
    const initialLng = parseNum(getParam('lng'));
    const initialZoom = parseNum(getParam('zoom'));

    const initialCenter: [number, number] | undefined = (!isNaN(initialLat) && !isNaN(initialLng))
        ? [initialLng, initialLat]
        : undefined;
    
    const validInitialZoom = !isNaN(initialZoom) ? initialZoom : undefined;

    // Effect to debounce search input to minimize API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Data fetching and filtering hooks
    const { news, isLoading, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
        searchQuery: debouncedSearch, 
        timeRange,
        customStartDate,
        customEndDate,
        sortMode,
        unmappedOnly
    });
    
    const sidebarRespectBBox = true;

    const {
        sources, setSources,
        categories, setCategories,
        filteredNews,
        mapNews,
    } = useNewsFilter(news, !unmappedOnly, timeRange, debouncedSearch, customStartDate, customEndDate, sortMode, currentBBox, sidebarRespectBBox, unmappedOnly);

    // UI and interaction state
    const [selectedItemId, setSelectedItemId] = useState<string | null>(getParam('eventId') || null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const isDarkMode = resolvedTheme === 'dark';

    // Callback to handle item selection from map or sidebar
    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
        updateURL({ eventId: id || undefined });
    }, [updateURL]);

    // Sync map center/zoom changes to URL
    const handleBoundsChange = useCallback((bbox: BBox) => {
        onBoundsChange(bbox);
        setCurrentBBox(bbox);
        if (bbox.zoom !== undefined && bbox.centerLat !== undefined && bbox.centerLng !== undefined) {
            updateURL({ lat: bbox.centerLat, lng: bbox.centerLng, zoom: bbox.zoom });
        }
    }, [onBoundsChange, updateURL]);

    // Handles changes to the time range filter, including custom date initialization
    const handleTimeRangeChange = useCallback((range: string) => {
        setTimeRange(range);
        updateURL({ t: range });
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
    }, [customStartDate, customEndDate, updateURL]);

    // Sync search changes to URL
    const handleSearchChange = useCallback((q: string) => {
        setSearchQuery(q);
        updateURL({ q: q || undefined });
    }, [updateURL]);

    const handleSortModeChange = useCallback((mode: SortMode) => {
        setSortMode(mode);
        updateURL({ s: mode });
    }, [setSortMode, updateURL]);

    const items = filteredNews;

    // Fetch full description when an item is selected if not already present
    useEffect(() => {
        if (selectedItemId) {
            const item = items.find(n => n.id === selectedItemId);
            if (item && item.description === undefined && fetchEventDetails) {
                fetchEventDetails(selectedItemId);
            }
        }
    }, [selectedItemId, fetchEventDetails, items]);

    const filterBarSlot = (
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
                onSearchChange={handleSearchChange}
                sortMode={sortMode}
                onSortModeChange={handleSortModeChange}
            />

            <main className={`${styles.mainContent} ${!isSidebarOpen ? styles.mainContentCollapsed : ''}`}>
                <NewsMap
                    items={mapNews}
                    selectedItemId={selectedItemId}
                    selectionVersion={selectionVersion}
                    onSelectItem={handleSelectItem}
                    isDarkMode={isDarkMode}
                    unmappedOnly={unmappedOnly}
                    onUnmappedOnlyChange={setUnmappedOnly}
                    onBoundsChange={handleBoundsChange}
                    initialCenter={initialCenter}
                    initialZoom={validInitialZoom}
                />
            </main>

            {error && (
                <div className={styles.errorOverlay}>
                    <svg className={styles.errorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p>{error}</p>
                    <button onClick={() => fetchNews(true)}>Retry Connection</button>
                </div>
            )}
        </div>
    );
}
