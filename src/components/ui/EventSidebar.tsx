"use client";

/**
 * EventSidebar component provides a scrollable, virtualized list of news events.
 * It manages selection states, expansion for detailed views, and responsive mobile layouts.
 */

import { NewsItem } from "@/lib/core/types";
import { SortMode } from "@/lib/utils/filters";
import type { UserTier } from "@/components/ui/TierBadge";

import {
  ReactNode,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import TierBadge from "@/components/ui/TierBadge";
import UserButton from "@/components/auth/UserButton";
import {
  canonicalEventCount,
  canonicalNewsId,
  latestReportTimestamp,
  matchesNewsId,
} from "@/lib/utils/ranking";
import EventCard from "./EventCard";
import { useResizable } from "@/hooks/useResizable";
import { useAuth } from "@/hooks/useAuth";
import styles from "./EventSidebar.module.css";
import type { UserTier as EntitlementTier } from '@/lib/entitlements';

interface EventSidebarProps {
  items: NewsItem[];
  selectedItemId: string | null;
  selectionVersion: number;
  onSelectItem: (id: string | null) => void;
  isLoading: boolean;
  /* Lazy-fetch description on expansion */
  onFetchDetails?: (id: string) => void;
  filterBar: ReactNode;
  filterCount?: number;
  isOpen: boolean;
  onToggleSidebar: () => void;
  mounted: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  filterVersion?: number;
  animatedEffects?: boolean;
  isCapped?: boolean;
  appliedLimit?: number;
  /** When true, disables interactive controls for guest users */
  disabled?: boolean;
  /** Current user subscription tier */
  userTier?: UserTier;
  /** True while the tier is still being resolved from DB */
  tierLoading?: boolean;
}

export default function EventSidebar({
  items,
  selectedItemId,
  selectionVersion,
  onSelectItem,
  isLoading,
  onFetchDetails,
  filterBar,
  filterCount = 0,
  isOpen,
  onToggleSidebar,
  mounted,
  searchQuery,
  onSearchChange,
  sortMode,
  onSortModeChange,
  filterVersion = 0,
  animatedEffects = false,
  isCapped = false,
  appliedLimit,
  disabled = false,
  userTier = "guest",
  tierLoading = false,
}: EventSidebarProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const hasInitialScrollRef = useRef(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const { setShowAuthModal } = useAuth();

  /* Resizable Sidebar Logic */
  const { sidebarWidth, isResizing, startResizing } = useResizable({
    sidebarRef,
  });

  const totalStoryCount = useMemo(() => {
    return items.reduce((acc, item) => acc + (item.storyCount || 1), 0);
  }, [items]);

  const newestEventTime = useMemo(() => {
    if (items.length === 0) return null;
    const times = items
      .map((i) => latestReportTimestamp(i))
      .filter((t) => !isNaN(t));
    return times.length > 0 ? Math.max(...times) : null;
  }, [items]);

  /* Identify the top 3 IDs for pulsing indicators (matches map logic) */
  const top3Ids = useMemo(() => {
    if (!animatedEffects) return new Set<string>();
    return new Set(items.slice(0, 3).map((item) => canonicalNewsId(item)));
  }, [items, animatedEffects]);

  const displayItems = useMemo(() => {
    if (!selectedItemId) return items;
    const selectedIndex = items.findIndex((item) =>
      matchesNewsId(item, selectedItemId),
    );
    if (selectedIndex <= 0) return items;

    const selectedItem = items[selectedIndex];
    return [
      selectedItem,
      ...items.slice(0, selectedIndex),
      ...items.slice(selectedIndex + 1),
    ];
  }, [items, selectedItemId]);

  /* Reset scroll and expansion when filters change explicitly */
  useEffect(() => {
    if (virtuosoRef.current) {
      if (disabled) {
        virtuosoRef.current.scrollTo({ top: 0 });
      } else {
        virtuosoRef.current.scrollToIndex({ index: 0 });
      }
    }
    // Use requestAnimationFrame to avoid synchronous cascading renders
    requestAnimationFrame(() => {
      setExpandedId(null);
    });
  }, [filterVersion, disabled]);

  /* Scroll to top once on initial load */
  useEffect(() => {
    if (!isLoading && items.length > 0 && !hasInitialScrollRef.current) {
      hasInitialScrollRef.current = true;
      if (virtuosoRef.current) {
        if (disabled) {
          virtuosoRef.current.scrollTo({ top: 0 });
        } else {
          virtuosoRef.current.scrollToIndex({ index: 0 });
        }
      }
    }
  }, [isLoading, items.length, disabled]);

  /* Scroll to selected item */
  useEffect(() => {
    if (!selectedItemId) return;
    const index = displayItems.findIndex((i) => matchesNewsId(i, selectedItemId));
    if (index >= 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: "start",
        behavior: "smooth",
      });
    }
  }, [selectedItemId, selectionVersion, displayItems]);

  const handleCardClick = useCallback(
    (item: NewsItem) => {
      /* Viewport check for mobile-specific interactions */
      const isMobile = () => window.innerWidth < 860;
      const targetId = canonicalNewsId(item);
      const isSelected = matchesNewsId(item, selectedItemId);

      if (!isSelected) {
        const itemSourceCount = canonicalEventCount(item);
        const needsTimelineDetails = itemSourceCount > 1 && !item.sources;
        if (item.description === undefined || needsTimelineDetails) {
          onFetchDetails?.(targetId);
        }
      }

      onSelectItem(isSelected ? null : targetId);
      if (!isSelected) {
        setExpandedId(null);
        if (isMobile()) {
          onToggleSidebar();
        }
      }
    },
    [selectedItemId, onSelectItem, onToggleSidebar, onFetchDetails],
  );

  const renderItem = useCallback(
    (index: number, item: NewsItem) => {
      const targetId = canonicalNewsId(item);
      const isSelected = matchesNewsId(item, selectedItemId);
      const isExpanded = expandedId === targetId || isSelected;
      const isTop3 = top3Ids.has(targetId);
      return (
        <EventCard
          key={item.id}
          item={item}
          index={index}
          isSelected={isSelected}
          isExpanded={isExpanded}
          isTop3={isTop3}
          onCardClick={handleCardClick}
          userTier={userTier as EntitlementTier}
        />
      );
    },
    [selectedItemId, expandedId, handleCardClick, top3Ids, userTier],
  );

  return (
    <aside
      ref={sidebarRef}
      className={[
        styles.eventSidebar,
        isOpen ? styles.eventSidebarMobileOpen : styles.eventSidebarCollapsed,
        isResizing ? styles.isResizing : "",
      ].join(" ")}
      style={
        sidebarWidth !== undefined
          ? ({ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Resize Handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={startResizing}
        title="Drag to resize"
      />

      <div className={styles.eventSidebarHeader}>
        <div className={styles.eventSidebarLogo}>
          <Link href="/" className={styles.logoLink} title="Return to the live intelligence map">
            <svg
              className={styles.sidebarLogoImg}
              width="200"
              height="200"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                className={styles.logoFill}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
              />
              <path
                className={styles.logoStroke}
                d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                strokeWidth="12"
              />
              <path
                className={styles.logoStroke}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
                strokeWidth="12"
              />
            </svg>
            <div className={styles.logoTextWrapper}>
              <h1>Seraphim</h1>
              {!tierLoading && <TierBadge tier={userTier} />}
            </div>
          </Link>
          <div className={styles.eventSidebarActions}>
            <UserButton variant="sidebar" />
            <ThemeToggle />
            <button
              className={`${styles.sidebarToggleBtn} ${styles.sidebarCollapseBtn}`}
              onClick={onToggleSidebar}
              aria-label="Collapse sidebar"
              title="Collapse the story sidebar"
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <button
              className={`${styles.sidebarToggleBtn} ${styles.mobileCloseBtn}`}
              onClick={onToggleSidebar}
              aria-label="Close sidebar"
              title="Close the story sidebar"
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.eventSidebarStats}>
        <div className={styles.statsSearch}>
          <svg
            className={styles.statsSearchIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            id="sidebar-search-input"
            type="text"
            placeholder={disabled
              ? "Sign in to search"
              : `Search ${isCapped && appliedLimit ? `${appliedLimit.toLocaleString()}+` : totalStoryCount.toLocaleString()} stories...`}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={styles.statsSearchInput}
            disabled={disabled}
            aria-label={disabled ? "Sign in to search" : "Search stories by keyword"}
            title={disabled ? "Sign in to search stories" : "Search stories by keyword"}
          />
        </div>
      </div>

      {/* Hot / New sort toggle */}
      <div className={styles.sortToggleRow}>
        <div className={styles.sortToggleGroup}>
          <button
            className={`${styles.sortToggleBtn} ${sortMode === "new" ? styles.sortToggleBtnActive : ""} ${disabled ? styles.sortToggleBtnDisabled : ""}`}
            onClick={() => !disabled && onSortModeChange("new")}
            aria-pressed={sortMode === "new"}
            aria-label="Sort by new"
            aria-disabled={disabled}
            title={disabled ? 'Story sorting requires a free account' : 'Sort stories by newest first'}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
            </svg>
            New
          </button>
          <button
            className={`${styles.sortToggleBtn} ${sortMode === "hot" ? styles.sortToggleBtnActive : ""} ${disabled ? styles.sortToggleBtnDisabled : ""}`}
            onClick={() => !disabled && onSortModeChange("hot")}
            aria-pressed={sortMode === "hot"}
            aria-label="Sort by hot"
            aria-disabled={disabled}
            title={disabled ? 'Story sorting requires a free account' : 'Sort stories by activity and impact'}
          >
            <svg
              viewBox="0 0 46.11 46.11"
              width="14"
              height="14"
              fill="currentColor"
            >
              <g>
                <g>
                  <path d="M23.054,0C10.342,0,0,10.342,0,23.055C0,35.768,10.342,46.11,23.055,46.11S46.11,35.768,46.11,23.055 C46.11,10.342,35.768,0,23.054,0z M23.054,39.11C14.201,39.11,7,31.908,7,23.055C7,14.202,14.201,7,23.054,7 c8.853,0,16.056,7.202,16.056,16.055C39.11,31.908,31.907,39.11,23.054,39.11z" />
                  <circle cx="23.054" cy="23.055" r="7.555" />
                </g>
              </g>
            </svg>
            Hot
          </button>
        </div>

        <button
          className={`${styles.filterToggleBtn} ${isFiltersExpanded ? styles.filterToggleBtnActive : ""} ${disabled ? styles.filterToggleBtnDisabled : ""}`}
          onClick={() => !disabled && setIsFiltersExpanded((prev) => !prev)}
          aria-pressed={isFiltersExpanded}
          aria-label="Toggle filters"
          aria-disabled={disabled}
          title={disabled
            ? 'Story filters require a free account'
            : isFiltersExpanded ? 'Hide story filters' : 'Show story filters'}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
          </svg>
          Filters
          {filterCount > 0 && (
            <span className={styles.filterBadgeCount}>{filterCount}</span>
          )}
        </button>

        {/* Prevents hydration mismatch for time strings */}
        {(newestEventTime || isLoading) && (
          <div className={styles.liveStatusWrapper}>
            <span className={styles.pulseDot} />
            <span className={styles.lastUpdated} suppressHydrationWarning>
              <span className={styles.updatedLabel}>UPDATED</span>
              <span>
                {newestEventTime && mounted
                  ? new Date(newestEventTime).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })
                  : "--:-- --"}
              </span>
            </span>
          </div>
        )}
      </div>

      <div
        className={`${styles.filterBarContainer} ${
          isFiltersExpanded ? styles.filterBarContainerExpanded : ""
        }`}
      >
        <div className={styles.filterBarWrapper}>{filterBar}</div>
      </div>

      <div
        className={styles.eventList}
        style={{ opacity: isLoading ? 0.7 : 1, transition: "opacity 0.2s" }}
      >
        {isLoading && (
          <div className={styles.topProgressBar}>
            <div className={styles.progressIndicator} />
          </div>
        )}
        {isLoading && items.length === 0 ? (
          <div className={styles.eventListLoading}>
            <div className={styles.loadingSpinner} />
            <p>Scanning sources...</p>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.eventListEmpty}>
            <h3>No events found</h3>
            <p>Try adjusting your filters or moving the map elsewhere</p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={displayItems}
            style={{ height: "100%", width: "100%" }}
            itemContent={(index, item) => renderItem(index, item)}
            overscan={200}
            components={{
              Header: () =>
                disabled ? (
                  <div className={styles.guestCtaCard}>
                    <div className={styles.guestCtaContent}>
                      <h2>
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="currentColor"
                          className={styles.guestCtaIcon}
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                        </svg>
                        GUEST MODE ACTIVE
                      </h2>
                      <p>
                        You are currently limited to the top 10 stories in view.
                        Create a <strong>free</strong> account to access up to 50 real-time stories per view,
                        live filters, customization, and annotation tools.
                      </p>
                    </div>
                    <button
                      className={styles.guestCtaButton}
                      onClick={() => setShowAuthModal(true)}
                      title="Sign in or create a free account to unlock filters and more events"
                    >
                      SIGN IN TO UNLOCK
                    </button>
                    <div className={styles.guestCtaFooter}>
                      By using Seraphim you agree to our{" "}
                      <Link
                        href="/terms?from=guest"
                        className={styles.guestLink}
                        prefetch={false}
                        title="Read the Terms of Service"
                      >
                        Terms of Service
                      </Link>{" "}
                      and{" "}
                      <Link
                        href="/privacy?from=guest"
                        className={styles.guestLink}
                        prefetch={false}
                        title="Read the Privacy Policy"
                      >
                        Privacy Policy
                      </Link>
                      .
                    </div>
                  </div>
                ) : null,
            }}
          />
        )}
      </div>
    </aside>
  );
}
