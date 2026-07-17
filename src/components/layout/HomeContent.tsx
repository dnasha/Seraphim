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
import { BBox, NewsItem } from '@/lib/core/types';
import { matchesNewsId, SortMode } from '@/lib/utils/ranking';
import { useUserTier } from '@/hooks/useUserTier';
import { useSyncedPreferences, sanitizeSyncedPreferences } from '@/hooks/useSyncedPreferences';
import { canUseTimeRange, hasFeature } from '@/lib/entitlements';
import UserButton from '@/components/auth/UserButton';
import PWAInstallPrompt from '@/components/ui/PWAInstallPrompt';
import StateNotice from '@/components/ui/StateNotice';
import { trackOptionalMetric } from '@/lib/privacyConsent';
import styles from './Layout.module.css';

/** Dynamically import NewsMap to prevent SSR issues with MapLibre's WebGL requirements */
const NewsMap = dynamic(() => import('@/components/map').then(mod => mod.NewsMap), { ssr: false });
const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false });

function limitWithPinned(items: NewsItem[], limit: number, pinnedItemId: string | null): NewsItem[] {
    if (items.length <= limit) return items;
    if (!pinnedItemId) return items.slice(0, limit);

    const pinnedIndex = items.findIndex((item) => matchesNewsId(item, pinnedItemId));
    if (pinnedIndex < 0 || pinnedIndex < limit) return items.slice(0, limit);
    if (limit <= 1) return [items[pinnedIndex]];

    return [...items.slice(0, limit - 1), items[pinnedIndex]];
}

export function HomeContent() {
    const { resolvedTheme, setTheme } = useTheme();
    const { user, supabase, isLoading: authLoading, isGuest, setShowAuthModal } = useAuth();
    const { preferences, isLoaded: preferencesLoaded, updatePreferences } = useSyncedPreferences(supabase, user);
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
    
    const [animatedEffects, setAnimatedEffects] = useState(true);
    const [timeRange, setTimeRange] = useState(initialState.t || '1d');
    const [customStartDate, setCustomStartDate] = useState(initialState.from || '');
    const [customEndDate, setCustomEndDate] = useState(initialState.to || '');
    const [debouncedCustomStartDate, setDebouncedCustomStartDate] = useState(initialState.from || '');
    const [debouncedCustomEndDate, setDebouncedCustomEndDate] = useState(initialState.to || '');
    
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

    /** Debounces valid custom date edits to avoid request spam while typing/picking. */
    useEffect(() => {
        if (timeRange !== 'custom') return;

        const startTime = customStartDate ? new Date(customStartDate).getTime() : NaN;
        const endTime = customEndDate ? new Date(customEndDate).getTime() : NaN;
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
            return;
        }

        const timer = setTimeout(() => {
            setDebouncedCustomStartDate(customStartDate);
            setDebouncedCustomEndDate(customEndDate);
        }, 400);

        return () => clearTimeout(timer);
    }, [timeRange, customStartDate, customEndDate]);

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
    const effectiveSearchQuery = isGuestUser ? '' : debouncedSearch;
    const hasCommittedCustomRange = Boolean(debouncedCustomStartDate && debouncedCustomEndDate);
    const effectiveTimeRange = isGuestUser ? '1d' : (timeRange === 'custom' && !hasCommittedCustomRange ? '1d' : timeRange);
    const effectiveCustomStartDate = isGuestUser ? '' : debouncedCustomStartDate;
    const effectiveCustomEndDate = isGuestUser ? '' : debouncedCustomEndDate;
    const effectiveUserTier = isGuestUser || userTier !== 'guest' ? userTier : 'free';
    const isAuthResolving = authLoading;
    const newsResetKey = isGuestUser ? 'guest' : user?.id ? `user:${user.id}` : 'anonymous';
    const [selectedItemId, setSelectedItemId] = useState<string | null>(initialState.eventId || null);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    useEffect(() => {
        if (isAuthResolving || !isGuestUser) return;
        if (!searchQuery && !debouncedSearch && timeRange === '1d' && sortMode === 'hot') return;

        const timer = setTimeout(() => {
            setSearchQuery('');
            setDebouncedSearch('');
            setTimeRange('1d');
            setSortMode('hot');
            updateURL({ q: undefined, t: undefined, s: undefined });
        }, 0);

        return () => clearTimeout(timer);
    }, [isAuthResolving, isGuestUser, searchQuery, debouncedSearch, timeRange, sortMode, updateURL]);

    const { news, appliedSortMode, isLoading: dataLoading, isCapped, appliedLimit, error, fetchNews, onBoundsChange, fetchEventDetails } = useNewsData({ 
        searchQuery: effectiveSearchQuery, 
        timeRange: effectiveTimeRange,
        customStartDate: effectiveCustomStartDate,
        customEndDate: effectiveCustomEndDate,
        sortMode: effectiveSortMode,
        limit: isGuestUser ? 10 : (userTier === 'free' ? 100 : undefined),
        enabled: !isAuthResolving,
        resetKey: newsResetKey,
        pinnedEventId: selectedItemId
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
    } = useNewsFilter(news, effectiveTimeRange, effectiveSearchQuery, effectiveCustomStartDate, effectiveCustomEndDate, effectiveSortMode, currentBBox, sidebarRespectBBox, appliedSortMode, selectedItemId);

    const hydratedPreferencesForRef = React.useRef<string | null>(null);
    const applyingPreferencesRef = React.useRef(false);
    useEffect(() => {
        if (!user || tierLoading || !preferencesLoaded || !preferences || hydratedPreferencesForRef.current === user.id) return;
        hydratedPreferencesForRef.current = user.id;
        applyingPreferencesRef.current = true;

        const urlPreferences = sanitizeSyncedPreferences({
            ...preferences,
            ...(initialState.src ? { sources: initialState.src.split(',') } : {}),
            ...(initialState.cat ? { categories: initialState.cat.split(',') } : {}),
        });
        setSources(urlPreferences.sources);
        setCategories(urlPreferences.categories);
        const hasSavedCustomRange = Boolean(preferences.customStartDate && preferences.customEndDate);
        const savedTimeRangeAllowed = canUseTimeRange(effectiveUserTier, preferences.timeRange)
            && (preferences.timeRange !== 'custom' || hasSavedCustomRange);
        setTimeRange(initialState.t || (savedTimeRangeAllowed ? preferences.timeRange : '1d'));
        const restoredStart = initialState.from || preferences.customStartDate;
        const restoredEnd = initialState.to || preferences.customEndDate;
        setCustomStartDate(restoredStart);
        setCustomEndDate(restoredEnd);
        setDebouncedCustomStartDate(restoredStart);
        setDebouncedCustomEndDate(restoredEnd);
        setSortMode((initialState.s as SortMode) || preferences.sortMode);
        setMinVolume(hasFeature(effectiveUserTier, 'advancedFilters') ? preferences.minVolume : 1);
        setCredibilityTiers(hasFeature(effectiveUserTier, 'advancedFilters') ? preferences.credibilityTiers : [1, 2, 3]);
        setAnimatedEffects(preferences.animatedEffects);
        setIsSidebarOpen(preferences.sidebarOpen);
        setTheme(preferences.theme);
        requestAnimationFrame(() => {
            applyingPreferencesRef.current = false;
        });
    }, [
        effectiveUserTier,
        initialState.cat,
        initialState.from,
        initialState.s,
        initialState.src,
        initialState.t,
        initialState.to,
        preferences,
        preferencesLoaded,
        setCategories,
        setCredibilityTiers,
        setMinVolume,
        setSources,
        setTheme,
        tierLoading,
        user,
    ]);

    useEffect(() => {
        if (!user || hydratedPreferencesForRef.current !== user.id || (resolvedTheme !== 'light' && resolvedTheme !== 'dark')) return;
        updatePreferences({ theme: resolvedTheme });
    }, [resolvedTheme, updatePreferences, user]);

    const isDarkMode = resolvedTheme === 'dark';

    /** Syncs local UI state when the URL state changes (e.g., via browser navigation) */
    const [prevInitialState, setPrevInitialState] = useState(initialState);
    if (initialState !== prevInitialState) {
        setPrevInitialState(initialState);
        setSearchQuery(initialState.q || '');
        setDebouncedSearch(initialState.q || '');
        setTimeRange(initialState.t || '1d');
        setSortMode((initialState.s as SortMode) || 'hot');
        setCustomStartDate(initialState.from || '');
        setCustomEndDate(initialState.to || '');
        setDebouncedCustomStartDate(initialState.from || '');
        setDebouncedCustomEndDate(initialState.to || '');
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
        if (applyingPreferencesRef.current) return;
        requestAnimationFrame(() => {
            setFilterVersion(v => v + 1);
            handleSelectItem(null);
        });
    }, [sources, categories, minVolume, credibilityTiers, timeRange, debouncedSearch, debouncedCustomStartDate, debouncedCustomEndDate, effectiveSortMode, handleSelectItem]);

    /**
     * Handles BBox changes by resetting sidebar scroll only when the selected item is
     * no longer present in the filtered result set for non-viewport reasons.
     */
    useEffect(() => {
        if (isFirstMount.current) return;
        
        const isVisible = selectedItemId && filteredNews.some(i => matchesNewsId(i, selectedItemId));
        
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
        if (range !== '1d') {
            void trackOptionalMetric('activation', {
                milestone: range === 'custom' ? 'custom_window' : 'historical_monitoring',
            });
        }
        setTimeRange(range);
        updateURL({ t: range });
        updatePreferences({ timeRange: range });
        if (range === 'custom' && (!customStartDate || !customEndDate)) {
            // Default custom range to the last 24 hours
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const toLocalISO = (d: Date) => {
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };

            const defaultStartDate = toLocalISO(yesterday);
            const defaultEndDate = toLocalISO(now);
            setCustomStartDate(defaultStartDate);
            setCustomEndDate(defaultEndDate);
            setDebouncedCustomStartDate(defaultStartDate);
            setDebouncedCustomEndDate(defaultEndDate);
            updateURL({ from: defaultStartDate, to: defaultEndDate });
            updatePreferences({ customStartDate: defaultStartDate, customEndDate: defaultEndDate });
        }
    }, [customStartDate, customEndDate, updatePreferences, updateURL]);

    // Sync search changes to URL
    const handleSearchChange = useCallback((q: string) => {
        setSearchQuery(q);
        updateURL({ q: q || undefined });
    }, [updateURL]);

    const handleSortModeChange = useCallback((mode: SortMode) => {
        setSortMode(mode);
        updateURL({ s: mode });
        updatePreferences({ sortMode: mode });
    }, [setSortMode, updatePreferences, updateURL]);

    const handleSourcesChange = useCallback((nextSources: string[]) => {
        setSources(nextSources);
        updateURL({ src: nextSources.join(',') });
        updatePreferences({ sources: nextSources });
    }, [setSources, updatePreferences, updateURL]);

    const handleCategoriesChange = useCallback((nextCategories: string[]) => {
        setCategories(nextCategories);
        updateURL({ cat: nextCategories.join(',') });
        updatePreferences({ categories: nextCategories });
    }, [setCategories, updatePreferences, updateURL]);

    const handleMinVolumeChange = useCallback((value: number) => {
        setMinVolume(value);
        updatePreferences({ minVolume: value });
    }, [setMinVolume, updatePreferences]);

    const handleCredibilityTiersChange = useCallback((tiers: number[]) => {
        setCredibilityTiers(tiers);
        updatePreferences({ credibilityTiers: tiers });
    }, [setCredibilityTiers, updatePreferences]);

    const handleAnimatedEffectsChange = useCallback((value: boolean) => {
        setAnimatedEffects(value);
        updatePreferences({ animatedEffects: value });
    }, [updatePreferences]);

    const handleCustomStartDateChange = useCallback((value: string) => {
        setCustomStartDate(value);
        updateURL({ from: value || undefined });
        updatePreferences({ customStartDate: value });
    }, [updatePreferences, updateURL]);

    const handleCustomEndDateChange = useCallback((value: string) => {
        setCustomEndDate(value);
        updateURL({ to: value || undefined });
        updatePreferences({ customEndDate: value });
    }, [updatePreferences, updateURL]);

    const handleSidebarOpenChange = useCallback((value: boolean) => {
        setIsSidebarOpen(value);
        updatePreferences({ sidebarOpen: value });
    }, [updatePreferences]);

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
                handleSidebarOpenChange(!isSidebarOpen);
                return;
            }

            // 't': Toggle sort mode between 'new' and 'hot'
            if (key === 't') {
                e.preventDefault();
                handleSortModeChange(sortMode === 'hot' ? 'new' : 'hot');
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
    }, [selectedItemId, sortMode, isGuestUser, isSidebarOpen, handleSelectItem, handleSortModeChange, handleSearchChange, handleSidebarOpenChange]);

    /** Gate guests and free users while preserving the active selection. */
    const visibleMapNews = useMemo(() => {
        if (isGuestUser) return limitWithPinned(mapNews, 10, selectedItemId);
        if (userTier === 'free') return limitWithPinned(mapNews, 100, selectedItemId);
        return mapNews;
    }, [mapNews, isGuestUser, selectedItemId, userTier]);

    const visibleSidebarNews = useMemo(() => {
        if (isGuestUser) return limitWithPinned(filteredNews, 10, selectedItemId);
        if (userTier === 'free') return limitWithPinned(filteredNews, 100, selectedItemId);
        return filteredNews;
    }, [filteredNews, isGuestUser, selectedItemId, userTier]);

    // Exact shared links may reference an event outside the current time range
    // or viewport, so fetch the event shell even when it was not in the feed.
    useEffect(() => {
        if (selectedItemId) {
            const item = news.find(n => matchesNewsId(n, selectedItemId));
            if ((!item || item.description === undefined) && fetchEventDetails) {
                fetchEventDetails(selectedItemId);
            }
        }
    }, [selectedItemId, fetchEventDetails, news]);

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
            onSourcesChange={handleSourcesChange}
            categories={categories}
            onCategoriesChange={handleCategoriesChange}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
            customStartDate={customStartDate}
            onCustomStartDateChange={handleCustomStartDateChange}
            customEndDate={customEndDate}
            onCustomEndDateChange={handleCustomEndDateChange}
            minVolume={minVolume}
            onMinVolumeChange={handleMinVolumeChange}
            credibilityTiers={credibilityTiers}
            onCredibilityTiersChange={handleCredibilityTiersChange}
            disabled={isGuestUser}
            userTier={effectiveUserTier}
        />
    );

    return (
        <div className={styles.appLayout}>
            {!isSidebarOpen && (
                <div className={styles.floatingActions}>
                    <button
                        className={styles.sidebarExpandBtn}
                        onClick={() => handleSidebarOpenChange(true)}
                        aria-label="Open sidebar"
                        title="Open the story sidebar"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
                        </svg>
                    </button>
                    <UserButton variant="floating" />
                </div>
            )}

            <EventSidebar
                items={visibleSidebarNews}
                selectedItemId={selectedItemId}
                selectionVersion={selectionVersion}
                onSelectItem={handleSelectItem}
                isLoading={isLoading}
                onFetchDetails={fetchEventDetails}
                isOpen={isSidebarOpen}
                onToggleSidebar={() => handleSidebarOpenChange(!isSidebarOpen)}
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
                userTier={effectiveUserTier}
                tierLoading={tierLoading}
            />

            <main className={`${styles.mainContent} ${!isSidebarOpen ? styles.mainContentCollapsed : ''}`}>
                <NewsMap
                    items={visibleMapNews}
                    selectedItemId={selectedItemId}
                    selectionVersion={selectionVersion}
                    onSelectItem={handleSelectItem}
                    isDarkMode={isDarkMode}
                    animatedEffects={animatedEffects}
                    onAnimatedEffectsChange={handleAnimatedEffectsChange}
                    onBoundsChange={handleBoundsChange}
                    initialCenter={initialCenter}
                    initialZoom={validInitialZoom}
                    sortMode={appliedSortMode as SortMode}
                    disabled={isGuestUser}
                    isSidebarOpen={isSidebarOpen}
                    userTier={effectiveUserTier}
                    tierLoading={tierLoading}
                    preferenceOwnerId={user?.id}
                    syncedPreferences={tierLoading ? null : preferences}
                    onSyncedPreferencesChange={updatePreferences}
                />
            </main>

            {/* Auth modal (auto-shows on first visit) */}
            <AuthModal />

            {/* PWA Install Prompt (1.4) */}
            <PWAInstallPrompt />

            {error && (
                <StateNotice
                    placement="floating"
                    variant="error"
                    title="Couldn’t refresh stories"
                    message={error}
                    actionLabel="Retry"
                    actionTitle="Retry loading the latest stories"
                    onAction={() => fetchNews(true)}
                />
            )}
        </div>
    );
}
