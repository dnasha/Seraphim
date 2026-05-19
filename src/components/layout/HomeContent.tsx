'use client';

/**
 * HomeContent is the primary layout component for the application.
 * It orchestrates state between the map, sidebar, and filters, while synchronizing with the URL.
 */

import React, { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import FilterBar from '@/components/ui/FilterBar';
import EventSidebar from '@/components/ui/EventSidebar';
import { useNewsData } from '@/hooks/useNewsData';
import { useNewsFilter } from '@/hooks/useNewsFilter';
import { useViewState } from '@/hooks/useViewState';
import { useAuth } from '@/hooks/useAuth';
import { BBox } from '@/lib/core/types';
import { SortMode } from '@/lib/utils/ranking';
import { useUserTier } from '@/hooks/useUserTier';
import AuthModal from '@/components/auth/AuthModal';
import UserButton from '@/components/auth/UserButton';
import PWAInstallPrompt from '@/components/ui/PWAInstallPrompt';
import styles from './Layout.module.css';

/** Dynamically import NewsMap to prevent SSR issues with MapLibre's WebGL requirements */
const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });

export function HomeContent() {
    const { resolvedTheme } = useTheme();
    const { user, isLoading: authLoading, isGuest, setShowAuthModal } = useAuth();
    const isGuestUser = isGuest || (!user && !authLoading);
    const { tier: userTier, isLoading: tierLoading } = useUserTier();
    /** Hydration guard to detect client-side mounting without triggering cascading renders */
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const { initialState, updateURL } = useViewState();
    const isFirstMount = React.useRef(true);
    const [filterVersion, setFilterVersion] = useState(0);
    
    /** Global filter and UI state initialized from URL params for persistence */
    const [unmappedOnly, setUnmappedOnly] = useState(false);
    const [animatedEffects, setAnimatedEffects] = useState(true);
    const [timeRange, setTimeRange] = useState(initialState.t || '1d');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    
    const [searchQuery, setSearchQuery] = useState(initialState.q || '');
    const [debouncedSearch, setDebouncedSearch] = useState(initialState.q || '');
    const [sortMode, setSortMode] = useState<SortMode>((initialState.s as SortMode) || 'hot');
    const [currentBBox, setCurrentBBox] = useState<BBox | null>(null);
    
    const initialCenter: [number, number] | undefined = (initialState.lat != null && initialState.lng != null)
        ? [initialState.lng, initialState.lat]
        : undefined;
    
    const validInitialZoom = initialState.zoom;

    /** Debounces search input to prevent excessive API requests during typing */
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    /** 
     * Handle browser back button (bfcache restore).
     * When returning from an external OAuth provider via the back button, 
     * Next.js Suspense and MapLibre WebGL contexts can be left in a broken/blank state.
     * Forcing a reload ensures a clean initialization.
     */
    useEffect(() => {
        const onPageShow = (e: PageTransitionEvent) => {
            if (e.persisted) {
                window.location.reload();
            }
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

    // Auto-show auth modal if returning from legal pages via auth referral query parameter
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('auth') === 'true') {
                setShowAuthModal(true);
                // Clean up query param from URL bar for aesthetic and UX reasons
                const cleanedSearch = window.location.search
                    .replace(/[?&]auth=true/, '')
                    .replace(/^&/, '?');
                const newUrl = window.location.pathname + (cleanedSearch === '?' ? '' : cleanedSearch);
                window.history.replaceState(null, '', newUrl);
            }
        }
    }, [setShowAuthModal]);

    const effectiveSortMode = isGuestUser ? 'hot' : sortMode;
    const isAuthResolving = authLoading || (!!user && tierLoading);

    const { news, appliedSortMode, isLoading: dataLoading, isCapped, appliedLimit, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
        searchQuery: debouncedSearch, 
        timeRange,
        customStartDate,
        customEndDate,
        sortMode: effectiveSortMode,
        unmappedOnly,
        limit: isGuestUser ? 10 : (userTier === 'free' ? 100 : undefined),
        enabled: !isAuthResolving
    });

    const isLoading = dataLoading || isAuthResolving;
    
    const sidebarRespectBBox = true;

    const {
        sources, setSources,
        categories, setCategories,
        minVolume, setMinVolume,
        credibilityTiers, setCredibilityTiers,
        filteredNews,
        mapNews,
    } = useNewsFilter(news, !unmappedOnly, timeRange, debouncedSearch, customStartDate, customEndDate, effectiveSortMode, currentBBox, sidebarRespectBBox, unmappedOnly, appliedSortMode);

    const [selectedItemId, setSelectedItemId] = useState<string | null>(initialState.eventId || null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const isDarkMode = resolvedTheme === 'dark';

    /** Syncs local UI state when the URL state changes (e.g., via browser navigation) */
    const [prevInitialState, setPrevInitialState] = useState(initialState);
    if (initialState !== prevInitialState) {
        setPrevInitialState(initialState);
        setSearchQuery(initialState.q || '');
        setDebouncedSearch(initialState.q || '');
        setTimeRange(initialState.t || '1d');
        setSortMode((initialState.s as SortMode) || 'hot');
        setSelectedItemId(initialState.eventId || null);
    }

    const handleSelectItem = useCallback((id: string | null) => {
        setSelectedItemId(id);
        setSelectionVersion(v => v + 1);
        updateURL({ eventId: id || undefined });
    }, [updateURL, setSelectedItemId, setSelectionVersion]);

    /** Resets scroll, expansion, and selection when filters change to ensure a clean state */
    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            return;
        }
        requestAnimationFrame(() => {
            setFilterVersion(v => v + 1);
            handleSelectItem(null);
        });
    }, [sources, categories, minVolume, credibilityTiers, timeRange, debouncedSearch, effectiveSortMode, unmappedOnly, handleSelectItem]);

    /**
     * Handles BBox changes by resetting sidebar scroll if the selected item is panned out.
     * This prevents the sidebar from jumping or showing stale data during map navigation.
     */
    useEffect(() => {
        if (isFirstMount.current) return;
        
        const isVisible = selectedItemId && filteredNews.some(i => i.id === selectedItemId || i.originalId === selectedItemId);
        
        if (!isVisible) {
            requestAnimationFrame(() => {
                setFilterVersion(v => v + 1);
            });
        }
    }, [currentBBox, filteredNews, selectedItemId]);

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

    /** Global keyboard shortcuts listener (1.2) */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeEl = document.activeElement;
            if (activeEl) {
                const tagName = activeEl.tagName.toLowerCase();
                if (
                    tagName === 'input' || 
                    tagName === 'textarea' || 
                    activeEl.hasAttribute('contenteditable') ||
                    (activeEl as HTMLElement).isContentEditable
                ) {
                    return;
                }
            }

            const key = e.key.toLowerCase();

            // Escape: Close active event selection / popup (allowed for everyone for accessibility)
            if (e.key === 'Escape') {
                if (selectedItemId) {
                    e.preventDefault();
                    handleSelectItem(null);
                }
                return;
            }

            // GUEST GUARD: Guests cannot access search, sidebar toggles, filtering, sorting, or query clearing via keyboard shortcuts.
            if (isGuestUser) {
                return;
            }

            // 'f' or '/': Focus the sidebar search box
            if (key === 'f' || key === '/') {
                const searchInput = document.getElementById('sidebar-search-input');
                if (searchInput) {
                    e.preventDefault();
                    (searchInput as HTMLInputElement).focus();
                    (searchInput as HTMLInputElement).select();
                }
                return;
            }

            // 'm': Toggle sidebar panel collapse/expand
            if (key === 'm') {
                e.preventDefault();
                setIsSidebarOpen(prev => !prev);
                return;
            }

            // 't': Toggle sort mode between 'new' and 'hot'
            if (key === 't') {
                e.preventDefault();
                handleSortModeChange(sortMode === 'hot' ? 'new' : 'hot');
                return;
            }

            // 'a': Toggle unmappedOnly filter (mapped only vs unmapped only)
            if (key === 'a') {
                e.preventDefault();
                setUnmappedOnly(prev => !prev);
                return;
            }

            // 'c': Clear the search query
            if (key === 'c') {
                e.preventDefault();
                handleSearchChange('');
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedItemId, sortMode, isGuestUser, handleSelectItem, handleSortModeChange, handleSearchChange]);

    /** Gate guests to a maximum of 10 events across all views */
    const items = useMemo(() => {
        if (isGuestUser) return filteredNews.slice(0, 10);
        if (userTier === 'free') return filteredNews.slice(0, 100);
        return filteredNews;
    }, [filteredNews, isGuestUser, userTier]);

    // Fetch full description when an item is selected if not already present
    useEffect(() => {
        if (selectedItemId) {
            const item = items.find(n => n.id === selectedItemId || n.originalId === selectedItemId);
            if (item && item.description === undefined && fetchEventDetails) {
                fetchEventDetails(selectedItemId);
            }
        }
    }, [selectedItemId, fetchEventDetails, items]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (categories && !categories.includes('all')) {
            count += categories.length;
        }
        if (sources) {
            count += (5 - sources.length);
        }
        if (timeRange && timeRange !== '1d') {
            count += 1;
        }
        if (minVolume && minVolume > 1) {
            count += 1;
        }
        if (credibilityTiers) {
            count += (3 - credibilityTiers.length);
        }
        return count;
    }, [categories, sources, timeRange, minVolume, credibilityTiers]);

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
            minVolume={minVolume}
            onMinVolumeChange={setMinVolume}
            credibilityTiers={credibilityTiers}
            onCredibilityTiersChange={setCredibilityTiers}
            disabled={isGuestUser}
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
                filterCount={activeFilterCount}
                mounted={mounted}
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                sortMode={effectiveSortMode}
                onSortModeChange={handleSortModeChange}
                filterVersion={filterVersion}
                animatedEffects={animatedEffects}
                isCapped={isCapped}
                appliedLimit={appliedLimit}
                disabled={isGuestUser}
                userTier={userTier}
                tierLoading={tierLoading}
            />

            <main className={`${styles.mainContent} ${!isSidebarOpen ? styles.mainContentCollapsed : ''}`}>
                <NewsMap
                    items={isGuestUser ? mapNews.slice(0, 10) : mapNews}
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
                    sortMode={appliedSortMode as SortMode}
                    disabled={isGuestUser}
                    isSidebarOpen={isSidebarOpen}
                    userTier={userTier}
                    tierLoading={tierLoading}
                />
            </main>

            {/* Floating user button on map when sidebar is collapsed */}
            {!isSidebarOpen && <UserButton variant="floating" />}

            {/* Auth modal (auto-shows on first visit) */}
            <AuthModal />

            {/* PWA Install Prompt (1.4) */}
            <PWAInstallPrompt />

            {error && (
                <div className={styles.errorOverlay}>
                    <div className={styles.errorOverlayContent}>
                        <svg className={styles.errorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <p>{error}</p>
                    </div>
                    <button onClick={() => fetchNews(true)}>Retry Connection</button>
                </div>
            )}
        </div>
    );
}
