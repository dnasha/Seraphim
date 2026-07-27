/**
 * MapPopup Component
 * 
 * Renders the interactive content for map markers. This component replaces legacy 
 * string-based popups with a reactive React-based UI, providing better security 
 * and support for complex data structures like multi-source timelines.
 */

'use client';

import { useState } from 'react';
import Image from "next/image";
import { canOptimizeNewsImage } from "@/lib/utils/newsImages";
import { NewsItem } from '@/lib/core/types';
import { 
    getSourceBadgeColor, 
    getCredibilityStyle,
    formatTimeAgo 
} from './MapConstants';
import { canonicalEventCount, canonicalNewsId } from '@/lib/utils/ranking';
import { LuShare2 } from 'react-icons/lu';
import { hasFeature, type UserTier } from '@/lib/entitlements';
import TimelineGateCta from '@/components/ui/TimelineGateCta';

interface MapPopupProps {
    item: NewsItem;
    userTier?: UserTier;
}

export default function MapPopup({ item, userTier = 'guest' }: MapPopupProps) {
    const credStyle = getCredibilityStyle(item.credibilityTier);
    const sourceCount = canonicalEventCount(item);
    const timelineLocked = sourceCount > 1 && !hasFeature(userTier, 'fullTimeline');
    const visibleSources = item.sources
        ? [...item.sources].sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
        : [];
    const hiddenSourceCount = item.timelineRestricted
        ? Math.max(0, (item.totalSources ?? sourceCount) - visibleSources.length)
        : 0;
    const showTimelineGap = hiddenSourceCount > 0 && visibleSources.length > 1;

    /**
     * Source sorting:
     * Identifies the most recent update within a clustered event by sorting 
     * its contributing sources by their discovery timestamp.
     */
    const latestSource = item.sources?.length
        ? [...item.sources].sort(
            (a, b) =>
                new Date(b.discoveredAt).getTime() -
                new Date(a.discoveredAt).getTime(),
        )[0]
        : null;
    
    /**
     * Date selection logic:
     * Prioritizes the latest source's discovery date, falling back to 
     * general activity or publication dates if source-specific data is missing.
     */
    const displayDate = latestSource
        ? latestSource.discoveredAt
        : (item.latestActivityAt || item.publishedAt);

    const [copied, setCopied] = useState(false);

    const handleShare = async () => {
        try {
            const shareUrl = `${window.location.origin}/?eventId=${canonicalNewsId(item)}`;
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy link:', err);
        }
    };

    return (
        <div className="news-popup">
            <div className="news-popup-header">
                <h3 className="news-popup-title">{item.title}</h3>
                <div className="news-popup-meta">
                    <span className="news-popup-source" style={{ background: getSourceBadgeColor(item.source), color: '#fff' }}>
                        {item.source}
                    </span>
                    <span 
                        className="news-popup-credibility" 
                        style={{ color: credStyle.color }} 
                        title={`${credStyle.label} source`}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path fillRule="evenodd" clipRule="evenodd" d="M21.007 8.27C22.194 9.125 23 10.45 23 12c0 1.55-.806 2.876-1.993 3.73.24 1.442-.134 2.958-1.227 4.05-1.095 1.095-2.61 1.459-4.046 1.225C14.883 22.196 13.546 23 12 23c-1.55 0-2.878-.807-3.731-1.996-1.438.235-2.954-.128-4.05-1.224-1.095-1.095-1.459-2.611-1.217-4.05C1.816 14.877 1 13.551 1 12s.816-2.878 2.002-3.73c-.242-1.439.122-2.955 1.218-4.05 1.093-1.094 2.61-1.467 4.057-1.227C9.125 1.804 10.453 1 12 1c1.545 0 2.88.803 3.732 1.993 1.442-.24 2.956.135 4.048 1.227 1.093 1.092 1.468 2.608 1.227 4.05Zm-4.426-.084a1 1 0 0 1 .233 1.395l-5 7a1 1 0 0 1-1.521.126l-3-3a1 1 0 0 1 1.414-1.414l2.165 2.165 4.314-6.04a1 1 0 0 1 1.395-.232Z"/>
                        </svg>
                    </span>


                    <span className="news-popup-time">{formatTimeAgo(displayDate)}</span>
                    {item.locationName && (
                        <>
                            <span className="news-popup-location">
                                <svg className="location-icon-svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                                </svg>
                                {item.locationName}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <div className="news-popup-scroll-body">
                <div className="news-popup-content">
                    {item.imageUrl && (
                        <div className="news-popup-img-container">
                            <Image
                                className="news-popup-img"
                                src={item.imageUrl}
                                alt=""
                                fill
                                unoptimized={!canOptimizeNewsImage(item.imageUrl)}
                                priority
                                sizes="(max-width: 860px) 100vw, 500px"
                                style={{ objectFit: 'cover' }}
                                referrerPolicy="no-referrer"
                                onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                        </div>
                    )}
                    {item.description !== undefined ? (
                        item.description ? (
                            <p className="news-popup-summary">{item.description}</p>
                        ) : null
                    ) : (
                        <div className="news-popup-summary news-popup-summary--loading">
                            <div className="popup-skeleton-line" />
                            <div className="popup-skeleton-line" style={{ width: '90%' }} />
                            <div className="popup-skeleton-line" style={{ width: '75%' }} />
                        </div>
                    )}
                    <div className="news-popup-actions">
                        {sourceCount <= 1 && (
                            <a className="news-popup-link" href={item.url} target="_blank" rel="noopener noreferrer" title="Open the original source in a new tab">
                                View source →
                            </a>
                        )}
                    </div>
                </div>
                {sourceCount > 1 && item.sources && (
                    <div className="news-popup-sources-section">
                        <div className="news-popup-sources-header">
                            <span>Story Timeline</span>
                            <div className="news-popup-sources-actions">
                                {timelineLocked && (
                                    <TimelineGateCta
                                        userTier={userTier}
                                        className="timeline-popup-upgrade-btn"
                                        guestClassName="timeline-popup-guest-btn"
                                    />
                                )}
                                <span className="news-popup-source-count" title={`${sourceCount} sources reporting on this`}>
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z" />
                                    </svg>
                                    {sourceCount}
                                </span>
                            </div>
                        </div>
                        <div className="news-popup-sources-list">
                            {visibleSources.map((src, i) => {
                                    const srcColor = getSourceBadgeColor(src.name);
                                    const srcTime = formatTimeAgo(src.discoveredAt);
                                    return (
                                        <div key={`${src.url}-${i}`}>
                                            <div className="news-popup-source-entry">
                                                {srcTime && <span className="news-popup-source-time">{srcTime}</span>}
                                                <span className="news-popup-source-name" style={{ background: srcColor, color: '#fff' }}>
                                                    {src.name}
                                                </span>
                                                <a className="news-popup-source-link" href={src.url} target="_blank" rel="noopener noreferrer" title={`Open ${src.name} in a new tab`}>
                                                    {new URL(src.url).hostname}
                                                </a>
                                            </div>
                                            {showTimelineGap && i === 0 && (
                                                <div
                                                    className="news-popup-timeline-gap"
                                                    role="note"
                                                    aria-label={`Showing the latest and first sources, with ${hiddenSourceCount} ${hiddenSourceCount === 1 ? 'source' : 'sources'} hidden between them.`}
                                                >
                                                    <span className="news-popup-timeline-gap-line" />
                                                    <span className="news-popup-timeline-gap-copy">
                                                        <strong>{hiddenSourceCount} {hiddenSourceCount === 1 ? 'source' : 'sources'} hidden</strong>
                                                        <small>Latest above · first source below</small>
                                                    </span>
                                                    <span className="news-popup-timeline-gap-line" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            {timelineLocked && item.sources?.length === 0 && (
                                <p className="news-popup-timeline-preview">A source timeline preview is available with Pro.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
            <div className="news-popup-footer">
                <button
                    className="news-popup-share-btn-absolute"
                    onClick={handleShare}
                    title={copied ? 'Shareable link copied' : 'Copy a shareable link to this event'}
                >
                    <LuShare2 size={13} />
                    {copied ? 'Link Copied!' : 'Share Event'}
                </button>
            </div>
        </div>
    );
}
