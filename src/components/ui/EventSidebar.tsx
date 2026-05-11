"use client";

/**
 * EventSidebar component provides a scrollable, virtualized list of news events.
 * It manages selection states, expansion for detailed views, and responsive mobile layouts.
 */

import { NewsItem } from "@/lib/core/types";
import { SortMode } from "@/lib/utils/filters";

import {
  ReactNode,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import ThemeToggle from "./ThemeToggle";
import { canonicalEventCount, latestReportTimestamp } from "@/lib/utils/ranking";
import EventCard from "./EventCard";
import { useResizable } from "@/hooks/useResizable";
import styles from "./EventSidebar.module.css";



interface EventSidebarProps {
  items: NewsItem[];
  selectedItemId: string | null;
  selectionVersion: number;
  onSelectItem: (id: string | null) => void;
  isLoading: boolean;
  /* Lazy-fetch description on expansion */
  onFetchDetails?: (id: string) => void;
  filterBar: ReactNode;
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
}

export default function EventSidebar({
  items,
  selectedItemId,
  selectionVersion,
  onSelectItem,
  isLoading,
  onFetchDetails,
  filterBar,
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
}: EventSidebarProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /* Tracks which cards have their full source timeline expanded */
  const [showAllSourcesIds, setShowAllSourcesIds] = useState<Set<string>>(
    new Set(),
  );

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
    return new Set(items.slice(0, 3).map((item) => item.originalId || item.id));
  }, [items, animatedEffects]);

  /* Reset scroll and expansion when filters change explicitly */
  useEffect(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 0 });
    }
    // Use requestAnimationFrame to avoid synchronous cascading renders
    requestAnimationFrame(() => {
      setExpandedId(null);
      setShowAllSourcesIds(new Set());
    });
  }, [filterVersion]);

  /* Scroll to selected item */
  useEffect(() => {
    if (!selectedItemId) return;
    const index = items.findIndex((i) => i.id === selectedItemId);
    if (index >= 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: "start",
        behavior: "smooth",
      });
    }
  }, [selectedItemId, selectionVersion, items]);

  /* Swipe detection for mobile collapse */
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartX.current || !touchStartY.current) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const deltaX = touchStartX.current - touchEndX;
    const deltaY = Math.abs(touchStartY.current - touchEndY);

    /* Threshold: 60px left swipe; movement must be primarily horizontal */
    if (deltaX > 60 && deltaY < 50 && isOpen) {
      onToggleSidebar();
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  const handleCardClick = useCallback(
    (item: NewsItem) => {
      const hasGeo = item.latitude != null;

      /* Viewport check for mobile-specific interactions */
      const isMobile = () => window.innerWidth < 860;

      if (hasGeo) {
        /* Mapped item selection */
        const targetId = item.originalId || item.id;
        const isSelected = selectedItemId === targetId;
        onSelectItem(isSelected ? null : targetId);

        if (!isSelected) {
          const itemSourceCount = canonicalEventCount(item);
          const needsTimelineDetails = itemSourceCount > 1 && !item.sources;
          if (item.description === undefined || needsTimelineDetails) {
            onFetchDetails?.(targetId);
          }
        }

        /* If selecting a mapped item, collapse any unmapped expansion */
        if (!isSelected) {
          setExpandedId(null);
          /* On mobile, close the sidebar so the map is fully visible */
          if (isMobile()) {
            onToggleSidebar();
          }
        }
      } else {
        /* Unmapped item expansion */
        const targetId = item.originalId || item.id;
        const isCurrentlyExpanded = expandedId === targetId;
        const nextExpanded = isCurrentlyExpanded ? null : targetId;
        setExpandedId(nextExpanded);

        const itemSourceCount = canonicalEventCount(item);
        const needsTimelineDetails = itemSourceCount > 1 && !item.sources;
        /* Fetches details lazily for description and timeline sources. */
        if (
          nextExpanded &&
          (item.description === undefined || needsTimelineDetails)
        ) {
          onFetchDetails?.(targetId);
        }

        /* If expanding an unmapped item, deselect any mapped item */
        if (!isCurrentlyExpanded) {
          onSelectItem(null);
        }
      }
    },
    [selectedItemId, onSelectItem, expandedId, onToggleSidebar, onFetchDetails],
  );

  const renderItem = useCallback(
    (index: number, item: NewsItem) => {
      const targetId = item.originalId || item.id;
      const isSelected = targetId === selectedItemId;
      const isExpanded = expandedId === targetId || isSelected;
      const isTop3 = top3Ids.has(targetId);
      const showingAll = showAllSourcesIds.has(targetId);

      return (
        <EventCard
          key={item.id}
          item={item}
          index={index}
          isSelected={isSelected}
          isExpanded={isExpanded}
          isTop3={isTop3}
          showingAllSources={showingAll}
          onCardClick={handleCardClick}
          onToggleSources={() => {
            setShowAllSourcesIds((prev) => {
              const next = new Set(prev);
              if (next.has(targetId)) {
                next.delete(targetId);
              } else {
                next.add(targetId);
              }
              return next;
            });
          }}
        />
      );
    },
    [selectedItemId, expandedId, handleCardClick, showAllSourcesIds, top3Ids],
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
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as React.CSSProperties
      }
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Resize Handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={startResizing}
        title="Drag to resize"
      />

      <div className={styles.eventSidebarHeader}>
        <div className={styles.eventSidebarLogo}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={styles.logoLink}>
            <svg
              className={styles.sidebarLogoImg}
              width="200"
              height="200"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ height: "3.4rem", width: "auto" }}
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
            <h1>Seraphim</h1>
          </a>
          <div className={styles.eventSidebarActions}>
            <ThemeToggle />
            <button
              className={`${styles.sidebarToggleBtn} ${styles.sidebarCollapseBtn}`}
              onClick={onToggleSidebar}
              aria-label="Collapse sidebar"
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
            type="text"
            placeholder={`Search ${isCapped && appliedLimit ? `${appliedLimit.toLocaleString()}+` : totalStoryCount.toLocaleString()} stories...`}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={styles.statsSearchInput}
          />
        </div>
      </div>

      {filterBar}

      {/* Hot / New sort toggle */}
      <div className={styles.sortToggleRow}>
        {/* Prevents hydration mismatch for time strings */}
        {(newestEventTime || isLoading) && (
          <div className={styles.liveStatusWrapper}>
            <span className={styles.pulseDot} />
            <span className={styles.lastUpdated} suppressHydrationWarning>
              UPDATED{" "}
              {newestEventTime && mounted
                ? new Date(newestEventTime).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })
                : "--:-- --"}
            </span>
          </div>
        )}

        <div className={styles.sortToggleGroup}>
          <button
            className={`${styles.sortToggleBtn} ${sortMode === "new" ? styles.sortToggleBtnActive : ""}`}
            onClick={() => onSortModeChange("new")}
            aria-pressed={sortMode === "new"}
            aria-label="Sort by new"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
            </svg>
            New
          </button>
          <button
            className={`${styles.sortToggleBtn} ${sortMode === "hot" ? styles.sortToggleBtnActive : ""}`}
            onClick={() => onSortModeChange("hot")}
            aria-pressed={sortMode === "hot"}
            aria-label="Sort by hot"
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
            data={items}
            style={{ height: "100%", width: "100%" }}
            itemContent={(index, item) => renderItem(index, item)}
            overscan={200}
          />
        )}
      </div>
    </aside>
  );
}
