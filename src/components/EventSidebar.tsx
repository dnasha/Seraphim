"use client";

/*
EventSidebar component displays a scrollable list of news events.
Supports item selection, expansion for details, and mobile-responsive layouts.
Includes Story UI: credibility badges, source count pills, and Sources & Timeline.
*/

import { NewsItem } from "@/lib/types";
import { SortMode } from "@/lib/filters";

import { formatTimeAgo } from "./map/MapConstants";
import Image from "next/image";
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
import { getCredibilityStyle } from "@/lib/colors";
import styles from "./EventSidebar.module.css";

/* Category accent colors for sidebar markers */
const CATEGORY_COLORS: Record<string, string> = {
  general: "#3b82f6",
  world: "#dc2626",
  crisis: "#b91c1c",
  nation: "#2563eb",
  business: "#d97706",
  technology: "#0891b2",
  science: "#059669",
  health: "#7c3aed",
};

/* Brand colors for source attribution badges */
function getSourceStyle(sourceName: string): { bg: string; color: string } {
  const s = sourceName.toLowerCase();
  if (s.includes("(x)") || s.includes("twitter"))
    return { bg: "#000000", color: "#ffffff" };
  if (s.includes("reddit")) return { bg: "#ff4500", color: "#ffffff" };
  if (s.includes("telegram")) return { bg: "#0088cc", color: "#ffffff" };
  if (
    s.includes("bellingcat") ||
    s.includes("isw") ||
    s.includes("war on the rocks")
  )
    return { bg: "#9a3412", color: "#ffffff" };
  if (
    s.includes("ars technica") ||
    s.includes("verge") ||
    s.includes("bleeping") ||
    s.includes("hacker news")
  )
    return { bg: "#0284c7", color: "#ffffff" };
  if (s.includes("nasa") || s.includes("nature"))
    return { bg: "#059669", color: "#ffffff" };
  if (s.includes("who ")) return { bg: "#7c3aed", color: "#ffffff" };
  /* Fallback for general media sources */
  return { bg: "#3b82f6", color: "#ffffff" };
}

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
}: EventSidebarProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /* Tracks which cards have their full source timeline expanded */
  const [showAllSourcesIds, setShowAllSourcesIds] = useState<Set<string>>(
    new Set(),
  );

  /* Resizable Sidebar Logic */
  const DEFAULT_WIDTH = 400;
  const MIN_WIDTH = 380;
  const MAX_WIDTH = 800;
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  /* Load persisted width on mount */
  useEffect(() => {
    const saved = localStorage.getItem("seraphim-sidebar-width");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        // Use requestAnimationFrame to avoid synchronous cascading renders
        // and ensure the update happens after the initial paint.
        const rafId = requestAnimationFrame(() => {
          setSidebarWidth(parsed);
        });
        return () => cancelAnimationFrame(rafId);
      }
    }
  }, []);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem("seraphim-sidebar-width", sidebarWidth.toString());
  }, [sidebarWidth]);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      /* Clamp width between MIN and MAX */
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    },
    [isResizing],
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const totalEventCount = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.eventCount ?? 1), 0);
  }, [items]);

  const newestEventTime = useMemo(() => {
    if (items.length === 0) return null;
    const times = items
      .map((i) => new Date(i.publishedAt).getTime())
      .filter((t) => !isNaN(t));
    return times.length > 0 ? Math.max(...times) : null;
  }, [items]);

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

        /* Fetches description if not already cached; empty string indicates loaded but blank */
        if (nextExpanded && item.description === undefined) {
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
      const hasGeo = item.latitude != null;
      const isExpanded = expandedId === targetId || isSelected;
      const catColor =
        CATEGORY_COLORS[item.category || "general"] || CATEGORY_COLORS.general;
      const credStyle = getCredibilityStyle(item.credibilityTier);
      const sourceCount = item.sources?.length ?? 0;
      const isTier1 = item.credibilityTier === 1;

      let timeAgo = "";
      try {
        const latestSource = item.sources?.length
          ? [...item.sources].sort(
              (a, b) =>
                new Date(b.discoveredAt).getTime() -
                new Date(a.discoveredAt).getTime(),
            )[0]
          : null;
        const displayDate = latestSource
          ? latestSource.discoveredAt
          : item.publishedAt;

        timeAgo = formatTimeAgo(displayDate);
      } catch {
        timeAgo = "";
      }

      /* Sources & Timeline: sort chronologically (newest first), apply show-all toggle */
      const sortedSources = (item.sources ?? [])
        .slice()
        .sort(
          (a, b) =>
            new Date(b.discoveredAt).getTime() -
            new Date(a.discoveredAt).getTime(),
        );
      const TIMELINE_DEFAULT_LIMIT = 5;
      const showingAll = showAllSourcesIds.has(targetId);
      const visibleSources =
        sortedSources.length > TIMELINE_DEFAULT_LIMIT && !showingAll
          ? sortedSources.slice(-TIMELINE_DEFAULT_LIMIT)
          : sortedSources;
      const hasHiddenSources = sortedSources.length > TIMELINE_DEFAULT_LIMIT;

      return (
        /* Wrapper for Virtuoso items with gutter padding */
        <div
          style={{
            paddingBottom: "6px",
            paddingLeft: "10px",
            paddingRight: "10px",
            paddingTop: index === 0 ? "10px" : "0",
          }}
        >
          <div
            key={item.id}
            /* Selection and layout state classes */
            className={[
              styles.eventCard,
              isSelected ? styles.eventCardActive : "",
              hasGeo ? styles.eventCardGeo : styles.eventCardUnmapped,
              isExpanded ? styles.eventCardExpanded : "",
              isTier1 ? styles.eventCardTier1 : "",
            ]
              .join(" ")
              .trim()}
            onClick={() => handleCardClick(item)}
            style={
              {
                borderColor: isSelected ? catColor : undefined,
                borderWidth: "1px",
                "--card-accent": catColor,
              } as React.CSSProperties
            }
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleCardClick(item);
            }}
          >
            {/* category accent bar on left edge (overridden to gold for Tier 1) */}
            <div
              className={styles.eventCardAccent}
              style={{ backgroundColor: catColor }}
            />

            {/* main row: thumbnail + text */}
            <div className={styles.eventCardRow}>
              {item.imageUrl && (
                <div className={styles.eventCardThumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    /* Avoid 403 errors from sources that block hotlinking */
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      if (img.parentElement)
                        img.parentElement.style.display = "none";
                    }}
                  />
                </div>
              )}
              <div className={styles.eventCardBody}>
                <h3 className={styles.eventCardTitle}>{item.title}</h3>
                <div className={styles.eventCardMeta}>
                  <span
                    className={styles.eventCardSource}
                    style={{
                      background: getSourceStyle(item.source).bg,
                      color: getSourceStyle(item.source).color,
                    }}
                  >
                    {item.source}
                  </span>

                  {/* Credibility tier badge */}
                  <span
                    className={styles.credibilityBadge}
                    style={{ background: credStyle.bg, color: credStyle.color }}
                    title={`${credStyle.label} source`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
                    </svg>
                  </span>

                  {/* Source count pill */}
                  {sourceCount > 1 && (
                    <span
                      className={styles.sourceCountBadge}
                      title={`${sourceCount} sources reporting on this`}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                      </svg>
                      {sourceCount}
                    </span>
                  )}

                  <span className={styles.eventCardTime}>{timeAgo}</span>
                  {item.locationName && (
                    <>
                      <span className={styles.eventCardLocation}>
                        <svg
                          className={styles.locationIconSvg}
                          viewBox="0 0 24 24"
                          width="12"
                          height="12"
                          fill="currentColor"
                          style={{
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginRight: "2px",
                            marginTop: "-2px",
                          }}
                        >
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                        </svg>
                        {item.locationName}
                      </span>
                    </>
                  )}
                </div>
                {!isExpanded && (
                  <span className={styles.eventCardExpandHint}>
                    Click to expand
                  </span>
                )}
              </div>
            </div>

            {/* expanded detail panel */}
            {isExpanded && (
              <div className={styles.eventCardDetail}>
                {item.imageUrl && (
                  <div className={styles.eventCardDetailImg}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        if (img.parentElement)
                          img.parentElement.style.display = "none";
                      }}
                    />
                  </div>
                )}
                {/* Renders skeleton during load or description text if cached */}
                {item.description != null ? (
                  item.description ? (
                    <p className={styles.eventCardDetailDesc}>
                      {item.description}
                    </p>
                  ) : null
                ) : (
                  <div className={styles.descriptionSkeleton}>
                    <div className={styles.skeletonLine} />
                    <div
                      className={styles.skeletonLine}
                      style={{ width: "90%" }}
                    />
                    <div
                      className={styles.skeletonLine}
                      style={{ width: "75%" }}
                    />
                  </div>
                )}

                {/* Single-source fallback link */}
                {sourceCount <= 1 && (
                  <a
                    className={styles.eventCardDetailLink}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View source →
                  </a>
                )}
              </div>
            )}

            {/* Sources & Timeline (only in expanded state with multiple sources) */}
            {isExpanded && sourceCount > 1 && (
              <div
                className={styles.storyTimeline}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.storyTimelineHeader}>
                  <span className={styles.storyTimelineTitle}>
                    Sources & Timeline
                  </span>
                  {sourceCount > 1 && (
                    <span
                      className={styles.sourceCountBadge}
                      title={`${sourceCount} sources reporting on this`}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                      </svg>
                      {sourceCount}
                    </span>
                  )}
                </div>
                <div className={styles.timelineList}>
                  {visibleSources.map((src, i) => {
                    const srcStyle = getSourceStyle(src.name);
                    let srcTimeAgo = "";
                    try {
                      srcTimeAgo = formatTimeAgo(src.discoveredAt);
                    } catch {
                      /* ignore */
                    }
                    return (
                      <div
                        key={`${src.url}-${i}`}
                        className={styles.timelineEntry}
                      >
                        <div className={styles.timelineEntryBody}>
                          <span
                            className={styles.timelineEntrySource}
                            style={{
                              background: srcStyle.bg,
                              color: srcStyle.color,
                            }}
                          >
                            {src.name}
                          </span>
                          <a
                            className={styles.timelineEntryLink}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {src.url}
                          </a>
                          {srcTimeAgo && (
                            <span className={styles.timelineEntryTime}>
                              {srcTimeAgo}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasHiddenSources && (
                  <button
                    className={styles.showAllToggle}
                    onClick={(e) => {
                      e.stopPropagation();
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
                  >
                    {showingAll
                      ? "Show fewer"
                      : `Show all ${sortedSources.length} sources`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
      /* Re-binds callback when selection or expansion state changes */
    },
    [selectedItemId, expandedId, handleCardClick, showAllSourcesIds],
  );

  return (
    <aside
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
          <Image
            src="/logo.webp"
            alt="Seraphim Logo"
            width={54}
            height={54}
            priority
            className={styles.sidebarLogoImg}
            style={{ height: "3.4rem", width: "auto", borderRadius: "4px" }}
          />
          <h1>Seraphim</h1>
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
        <div className={styles.statsInfo}>
          {/* Prevents hydration mismatch for time strings */}
          {(newestEventTime || isLoading) && (
            <div className={styles.liveStatusWrapper}>
              <span className={styles.pulseDot} />
              <span className={styles.lastUpdated} suppressHydrationWarning>
                LAST UPDATED AT:{" "}
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
          <span className={styles.statPill}>
            {totalEventCount.toLocaleString()} events
          </span>
        </div>

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
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={styles.statsSearchInput}
          />
        </div>
      </div>

      {filterBar}

      {/* Hot / New sort toggle */}
      <div className={styles.sortToggleRow}>
        <button
          className={`${styles.sortToggleBtn} ${sortMode === "new" ? styles.sortToggleBtnActive : ""}`}
          onClick={() => onSortModeChange("new")}
          aria-pressed={sortMode === "new"}
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
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" />
          </svg>
          Hot
        </button>
      </div>

      <div className={styles.eventList}>
        {isLoading && items.length === 0 ? (
          <div className={styles.eventListLoading}>
            <div className={styles.loadingSpinner} />
            <p>Scanning sources...</p>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.eventListEmpty}>
            <h3>No events found</h3>
            <p>Try adjusting your filters</p>
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
