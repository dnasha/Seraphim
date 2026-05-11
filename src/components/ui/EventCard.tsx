"use client";

import { NewsItem } from "@/lib/core/types";
import { formatTimeAgo } from "@/components/map/MapConstants";
import { getCredibilityStyle, CATEGORY_COLORS, getSourceStyle } from "@/lib/styles/colors";
import { canonicalEventCount } from "@/lib/utils/ranking";
import styles from "./EventSidebar.module.css";
import React from "react";
import Image from "next/image";

interface EventCardProps {
  item: NewsItem;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  isTop3: boolean;
  showingAllSources: boolean;
  onCardClick: (item: NewsItem) => void;
  onToggleSources: () => void;
}

export default function EventCard({
  item,
  index,
  isSelected,
  isExpanded,
  isTop3,
  showingAllSources,
  onCardClick,
  onToggleSources,
}: EventCardProps) {
  const hasGeo = item.latitude != null;
  const catColor = CATEGORY_COLORS[item.category || "general"] || CATEGORY_COLORS.general;
  const credStyle = getCredibilityStyle(item.credibilityTier);
  const sourceCount = canonicalEventCount(item);
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
      : item.latestActivityAt || item.publishedAt;

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
  const visibleSources =
    sortedSources.length > TIMELINE_DEFAULT_LIMIT && !showingAllSources
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
        onClick={() => onCardClick(item)}
        style={
          {
            borderColor: isSelected ? catColor : undefined,
            borderWidth: "1px",
            "--card-accent": catColor,
          } as React.CSSProperties
        }
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-pressed={isSelected}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onCardClick(item);
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
              <Image
                src={item.imageUrl}
                alt=""
                fill
                unoptimized
                sizes="88px"
                style={{ objectFit: 'cover' }}
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

              <span className={styles.eventCardTime}>{timeAgo}</span>
              {item.locationName && (
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
              )}
            </div>
            {!isExpanded && (
              <span className={styles.eventCardExpandHint}>
                Click to expand
              </span>
            )}
            {sourceCount > 1 && (
              <span
                className={`${styles.sourceCountBadge} ${styles.sourceCountBadgeCorner}`}
                title={`${sourceCount} sources reporting on this`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z" />
                </svg>
                {sourceCount}
              </span>
            )}
            {isTop3 && (
              <span
                className={styles.top3PulseDot}
                style={
                  {
                    "--pulse-color": catColor,
                    "--pulse-color-alpha": `${catColor}b3`, // ~70% opacity
                  } as React.CSSProperties
                }
              />
            )}
          </div>
        </div>

        {/* expanded detail panel */}
        {isExpanded && (
          <div className={styles.eventCardDetail}>
            {item.imageUrl && (
              <div className={styles.eventCardDetailImg}>
                <Image
                  src={item.imageUrl}
                  alt=""
                  fill
                  unoptimized
                  priority={isExpanded}
                  sizes="(max-width: 860px) 100vw, 400px"
                  style={{ objectFit: 'cover' }}
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
                    <path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z" />
                  </svg>
                  {sourceCount}
                </span>
              )}
            </div>
            <div className={styles.timelineList}>
              {item.sources == null ? (
                <div className={styles.descriptionSkeleton}>
                  <div className={styles.skeletonLine} />
                  <div
                    className={styles.skeletonLine}
                    style={{ width: "86%" }}
                  />
                </div>
              ) : (
                visibleSources.map((src, i) => {
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
                })
              )}
            </div>
            {hasHiddenSources && (
              <button
                className={styles.showAllToggle}
                aria-pressed={showingAllSources}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSources();
                }}
              >
                {showingAllSources
                  ? "Show fewer"
                  : `Show all ${sortedSources.length} sources`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
