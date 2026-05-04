"use client";

/** Sidebar component for displaying and managing news item selection and detail expansion. */

import { NewsItem } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
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
import styles from "./EventSidebar.module.css";

// Category accent colors for sidebar markers
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

// Brand colors for source attribution badges
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
  // mainstream media default
  return { bg: "#3b82f6", color: "#ffffff" };
}

interface EventSidebarProps {
  items: NewsItem[];
  selectedItemId: string | null;
  selectionVersion: number;
  onSelectItem: (id: string | null) => void;
  isLoading: boolean;
  /** Lazy-fetch description on expansion */
  onFetchDetails?: (id: string) => void;
  filterBar: ReactNode;
  isOpen: boolean;
  onToggleSidebar: () => void;
  mounted: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
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
}: EventSidebarProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Scroll to selected item
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

  // Swipe detection for mobile collapse
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

    // Threshold: 60px left swipe, and movement must be primarily horizontal
    if (deltaX > 60 && deltaY < 50 && isOpen) {
      onToggleSidebar();
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  const handleCardClick = useCallback(
    (item: NewsItem) => {
      const hasGeo = item.latitude != null;

      // Viewport check for mobile-specific interactions
      const isMobile = () => window.innerWidth < 860;

      if (hasGeo) {
        // Mapped item selection
        const isSelected = selectedItemId === item.id;
        onSelectItem(isSelected ? null : item.id);

        // if selecting a mapped item, collapse any unmapped expansion
        if (!isSelected) {
          setExpandedId(null);
          // on mobile, close the sidebar so the map is fully visible
          if (isMobile()) {
            onToggleSidebar();
          }
        }
      } else {
        // Unmapped item expansion
        const isCurrentlyExpanded = expandedId === item.id;
        const nextExpanded = isCurrentlyExpanded ? null : item.id;
        setExpandedId(nextExpanded);

        // Fetches description if not already cached (empty string indicates loaded but blank)
        if (nextExpanded && item.description === undefined) {
          onFetchDetails?.(item.id);
        }

        // if expanding an unmapped item, deselect any mapped item
        if (!isCurrentlyExpanded) {
          onSelectItem(null);
        }
      }
    },
    [selectedItemId, onSelectItem, expandedId, onToggleSidebar, onFetchDetails],
  );

  const renderItem = useCallback(
    (index: number, item: NewsItem) => {
      const isSelected = item.id === selectedItemId;
      const hasGeo = item.latitude != null;
      const isExpanded = expandedId === item.id || item.id === selectedItemId;
      const catColor =
        CATEGORY_COLORS[item.category || "general"] || CATEGORY_COLORS.general;
      let timeAgo = "";
      try {
        timeAgo = formatDistanceToNow(new Date(item.publishedAt), {
          addSuffix: true,
        });
      } catch {
        timeAgo = "";
      }

      return (
        // Wrapper for Virtuoso items with gutter padding
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
            // Selection and layout state classes
            className={[
              styles.eventCard,
              isSelected ? styles.eventCardActive : "",
              hasGeo ? styles.eventCardGeo : styles.eventCardUnmapped,
              isExpanded ? styles.eventCardExpanded : "",
            ]
              .join(" ")
              .trim()}
            onClick={() => handleCardClick(item)}
            style={{
              backgroundColor: isSelected ? `${catColor}15` : undefined,
              borderColor: isSelected ? catColor : undefined,
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleCardClick(item);
            }}
          >
            {/* category accent bar on left edge */}
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
                    // Avoid 403 errors from sources that block hotlinking
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
                  <span className={styles.eventCardTime}>{timeAgo}</span>
                  {item.locationName && (
                    <>
                      <span className={styles.eventCardMetaSep}>•</span>
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
                <a
                  className={styles.eventCardDetailLink}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source →
                </a>
              </div>
            )}
          </div>
        </div>
      );
      // Re-binds callback when selection or expansion state changes
    },
    [selectedItemId, expandedId, handleCardClick],
  );

  return (
    <aside
      className={[
        styles.eventSidebar,
        isOpen ? styles.eventSidebarMobileOpen : styles.eventSidebarCollapsed,
      ].join(" ")}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
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
          <svg className={styles.statsSearchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
