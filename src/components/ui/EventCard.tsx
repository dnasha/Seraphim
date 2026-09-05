"use client";

/**
 * EventCard component renders a summary or detailed view of a single news event.
 * Handles credibility badges, source counts, and chronological timelines.
 */

import { NewsItem } from "@/lib/core/types";
import { formatTimeAgo } from "@/components/map/MapConstants";
import { getCredibilityStyle, CATEGORY_COLORS, getSourceStyle } from "@/lib/styles/colors";
import { canonicalEventCount } from "@/lib/utils/ranking";
import styles from "./EventSidebar.module.css";
import React from "react";
import Image from "next/image";
import { getNewsImagePresentation } from "@/lib/utils/newsImages";
import { hasFeature, type UserTier } from '@/lib/entitlements';
import TimelineGateCta from './TimelineGateCta';
import { safeExternalHttpUrl } from '@/lib/security/externalUrl';

interface EventCardProps {
  item: NewsItem;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  isTop3: boolean;
  onCardClick: (item: NewsItem) => void;
  userTier: UserTier;
}

export default function EventCard({
  item,
  index,
  isSelected,
  isExpanded,
  isTop3,
  onCardClick,
  userTier,
}: EventCardProps) {
  const catColor = CATEGORY_COLORS[item.category || "general"] || CATEGORY_COLORS.general;
  const credStyle = getCredibilityStyle(item.credibilityTier);
  const sourceCount = canonicalEventCount(item);
  const isTier1 = item.credibilityTier === 1;
  const thumbnailImage = getNewsImagePresentation(item, 176);
  const detailImage = getNewsImagePresentation(item, 640);
  const descriptionSourceUrl = safeExternalHttpUrl(item.descriptionProvenance?.url);

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>, proxied: boolean) => {
    const image = event.currentTarget;
    if (proxied && item.imageUrl && image.dataset.originalFallback !== "true") {
      image.dataset.originalFallback = "true";
      image.removeAttribute("srcset");
      image.src = item.imageUrl;
      return;
    }
    if (image.parentElement) image.parentElement.style.display = "none";
  };

  let timeAgo = "";
  try {
    /**
     * Determines the most relevant timestamp for display.
     * Prefers the most recent source's discovery time to reflect activity.
     */
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

  /**
   * Sorts sources chronologically by discovery time.
   * Limits visible items unless the user explicitly expands the timeline.
   */
  const sortedSources = (item.sources ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.discoveredAt).getTime() -
        new Date(a.discoveredAt).getTime(),
    );
  const visibleSources = sortedSources;
  const timelineLocked = sourceCount > 1 && !hasFeature(userTier, 'fullTimeline');
  const hiddenSourceCount = item.timelineRestricted
    ? Math.max(0, (item.totalSources ?? sourceCount) - visibleSources.length)
    : 0;
  const showTimelineGap = hiddenSourceCount > 0 && visibleSources.length > 1;

  return (
    /** Gutter padding for Virtuoso virtualization items */
    <div
      style={{
        paddingBottom: "6px",
        paddingLeft: "4px",
        paddingRight: "10px",
        paddingTop: index === 0 ? "5px" : "0",
      }}
    >
      <div
        key={item.id}
        /** Selection and layout state classes */
        className={[
          styles.eventCard,
          isSelected ? styles.eventCardActive : "",
          styles.eventCardGeo,
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
        title={isExpanded ? 'Collapse story details' : 'Expand story details'}
        aria-expanded={isExpanded}
        aria-pressed={isSelected}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onCardClick(item);
          }
        }}
      >
        {/** Category accent bar on the left edge */}
        <div
          className={styles.eventCardAccent}
          style={{ backgroundColor: catColor }}
        />

        {/** Main layout: thumbnail and textual content */}
        <div className={styles.eventCardRow}>
          {thumbnailImage && (
            <div className={styles.eventCardThumb}>
              <Image
                src={thumbnailImage.src}
                alt=""
                fill
                unoptimized={thumbnailImage.unoptimized}
                sizes="88px"
                style={{ objectFit: 'cover' }}
                /** Prevents 403 Forbidden errors from sources that block external hotlinking */
                referrerPolicy="no-referrer"
                onError={(event) => handleImageError(event, thumbnailImage.proxied)}
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

              {/** Credibility tier badge icon with descriptive tooltip */}
              <span
                className={styles.credibilityBadge}
                style={{ color: credStyle.color }}
                title={`${credStyle.label} source`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M21.007 8.27C22.194 9.125 23 10.45 23 12c0 1.55-.806 2.876-1.993 3.73.24 1.442-.134 2.958-1.227 4.05-1.095 1.095-2.61 1.459-4.046 1.225C14.883 22.196 13.546 23 12 23c-1.55 0-2.878-.807-3.731-1.996-1.438.235-2.954-.128-4.05-1.224-1.095-1.095-1.459-2.611-1.217-4.05C1.816 14.877 1 13.551 1 12s.816-2.878 2.002-3.73c-.242-1.439.122-2.955 1.218-4.05 1.093-1.094 2.61-1.467 4.057-1.227C9.125 1.804 10.453 1 12 1c1.545 0 2.88.803 3.732 1.993 1.442-.24 2.956.135 4.048 1.227 1.093 1.092 1.468 2.608 1.227 4.05Zm-4.426-.084a1 1 0 0 1 .233 1.395l-5 7a1 1 0 0 1-1.521.126l-3-3a1 1 0 0 1 1.414-1.414l2.165 2.165 4.314-6.04a1 1 0 0 1 1.395-.232Z" />
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
                title={`${sourceCount} reports on this story`}
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

        {/** Expanded detail panel with high-resolution image and description */}
        {isExpanded && (
          <div className={styles.eventCardDetail}>
            {detailImage && (
              <div className={styles.eventCardDetailImg}>
                <Image
                  src={detailImage.src}
                  alt=""
                  fill
                  unoptimized={detailImage.unoptimized}
                  priority={isExpanded}
                  sizes="(max-width: 860px) 100vw, 400px"
                  style={{ objectFit: 'contain' }}
                  referrerPolicy="no-referrer"
                  onError={(event) => handleImageError(event, detailImage.proxied)}
                />
              </div>
            )}
            {/** Renders skeleton placeholders during lazy-fetch or the description text if available */}
            {item.headlinePublishedAt && (
              <p className={styles.timelinePreview}>
                Headline: {item.source} · <time dateTime={item.headlinePublishedAt} title={item.headlinePublishedAt}>{formatTimeAgo(item.headlinePublishedAt)}</time>
              </p>
            )}
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

            {item.description && (
              <p className={styles.timelinePreview}>
                {item.descriptionProvenance ? <>
                  Description: {descriptionSourceUrl
                    ? <a href={descriptionSourceUrl.href} target="_blank" rel="noopener noreferrer" title={`Open description source: ${item.descriptionProvenance.name}`}>{item.descriptionProvenance.name}</a>
                    : item.descriptionProvenance.name}
                  {' · '}<time dateTime={item.descriptionProvenance.published_at} title={item.descriptionProvenance.published_at}>{formatTimeAgo(item.descriptionProvenance.published_at)}</time>
                </> : 'Description attribution unavailable for this older story.'}
              </p>
            )}
            {item.independentPublisherCount != null && (
              <p className={styles.timelinePreview}>{item.independentPublisherCount} independent reporting {item.independentPublisherCount === 1 ? 'source' : 'sources'}</p>
            )}

            {/** Fallback link for single-source events */}
            {sourceCount <= 1 && (
              <a
                className={styles.eventCardDetailLink}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the original source in a new tab"
              >
                View source →
              </a>
            )}
          </div>
        )}

        {/** Timeline of contributing sources, visible only when expanded and multiple sources exist */}
        {isExpanded && sourceCount > 1 && (
          <div
            className={styles.storyTimeline}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.storyTimelineHeader}>
              <span className={styles.storyTimelineTitle}>
                Story Timeline
              </span>
              <div className={styles.storyTimelineActions}>
                {timelineLocked && (
                  <TimelineGateCta
                    userTier={userTier}
                    className={styles.timelineUpgradeBtn}
                    guestClassName={styles.timelineGuestCta}
                  />
                )}
                <span
                  className={styles.sourceCountBadge}
                  title={`${sourceCount} reports on this story`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z" />
                  </svg>
                  {sourceCount}
                </span>
              </div>
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
                  const sourceUrl = safeExternalHttpUrl(src.url);
                  let srcTimeAgo = "";
                  try {
                    srcTimeAgo = formatTimeAgo(src.discoveredAt);
                  } catch {
                    /* ignore */
                  }
                  return (
                    <React.Fragment key={`${src.url}-${i}`}>
                      <div className={styles.timelineEntry}>
                        {srcTimeAgo && (
                          <span className={styles.timelineEntryTime}>
                            {srcTimeAgo}
                          </span>
                        )}
                        <span
                          className={styles.timelineEntrySource}
                          style={{
                            background: srcStyle.bg,
                            color: srcStyle.color,
                          }}
                        >
                          {src.name}
                        </span>
                        {sourceUrl ? (
                          <a
                            className={styles.timelineEntryLink}
                            href={sourceUrl.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${src.name} in a new tab`}
                          >
                            {sourceUrl.hostname}
                          </a>
                        ) : (
                          <span className={styles.timelineEntryLink}>{src.name}</span>
                        )}
                      </div>
                      {showTimelineGap && i === 0 && (
                        <div
                          className={styles.timelineGap}
                          role="note"
                          aria-label={`Showing the latest and first sources, with ${hiddenSourceCount} ${hiddenSourceCount === 1 ? 'source' : 'sources'} hidden between them.`}
                        >
                          <span className={styles.timelineGapLine} />
                          <span className={styles.timelineGapCopy}>
                            <strong>{hiddenSourceCount} {hiddenSourceCount === 1 ? 'source' : 'sources'} hidden</strong>
                            <small>Latest above · first source below</small>
                          </span>
                          <span className={styles.timelineGapLine} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })
              )}
              {timelineLocked && item.sources?.length === 0 && (
                <p className={styles.timelinePreview}>A source timeline preview is available with Pro.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
