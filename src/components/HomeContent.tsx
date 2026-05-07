'use client';

import React, { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
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

export function HomeContent() {
    const { resolvedTheme } = useTheme();
    // Official React 18+ way to detect hydration/client-side status without cascading renders
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const { initialState, updateURL } = useViewState();
    const isFirstMount = React.useRef(true);
    const [filterVersion, setFilterVersion] = useState(0);
    
    // Filtering and time range state (initialized from initialState/URL for persistence)
    const [unmappedOnly, setUnmappedOnly] = useState(false);
    const [animatedEffects, setAnimatedEffects] = useState(true);
    const [timeRange, setTimeRange] = useState(initialState.t || '1d');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    
    // Search and debounce state (initialized from initialState/URL for persistence)
    const [searchQuery, setSearchQuery] = useState(initialState.q || '');
    const [debouncedSearch, setDebouncedSearch] = useState(initialState.q || '');
    const [sortMode, setSortMode] = useState<SortMode>((initialState.s as SortMode) || 'new');
    const [currentBBox, setCurrentBBox] = useState<BBox | null>(null);
    
    // Map initial view state from initialState/URL
    const initialCenter: [number, number] | undefined = (initialState.lat != null && initialState.lng != null)
        ? [initialState.lng, initialState.lat]
        : undefined;
    
    const validInitialZoom = initialState.zoom;

    // Effect to debounce search input to minimize API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Data fetching and filtering hooks
    const { news, appliedSortMode, isLoading, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
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
    } = useNewsFilter(news, !unmappedOnly, timeRange, debouncedSearch, customStartDate, customEndDate, sortMode, currentBBox, sidebarRespectBBox, unmappedOnly, appliedSortMode);

    // UI and interaction state
    const [selectedItemId, setSelectedItemId] = useState<string | null>(initialState.eventId || null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const isDarkMode = resolvedTheme === 'dark';

    // Sync UI state from URL when it changes externally (e.g. logo click, back/forward navigation)
    const [prevInitialState, setPrevInitialState] = useState(initialState);
    if (initialState !== prevInitialState) {
        setPrevInitialState(initialState);
        setSearchQuery(initialState.q || '');
        setDebouncedSearch(initialState.q || '');
        setTimeRange(initialState.t || '1d');
        setSortMode((initialState.s as SortMode) || 'new');
        setSelectedItemId(initialState.eventId || null);
    }

    // Callback to handle item selection from map or sidebar
    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
        updateURL({ eventId: id || undefined });
    }, [updateURL, setSelectedItemId, setSelectionVersion]);

    // Deselect current item and close popups when filters or sort mode change
    useEffect(() => {
        // skip initial mount to respect URL parameters
        if (isFirstMount.current) {
            isFirstMount.current = false;
            return;
        }
        setFilterVersion(v => v + 1);
        handleSelectItem(null);
    }, [sources, categories, timeRange, debouncedSearch, sortMode, unmappedOnly, handleSelectItem]);

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
            const item = items.find(n => n.id === selectedItemId || n.originalId === selectedItemId);
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
                filterVersion={filterVersion}
                animatedEffects={animatedEffects}
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
                    animatedEffects={animatedEffects}
                    onAnimatedEffectsChange={setAnimatedEffects}
                    onBoundsChange={handleBoundsChange}
                    initialCenter={initialCenter}
                    initialZoom={validInitialZoom}
                    sortMode={sortMode}
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
