'use client';

import Image from "next/image";
import { NewsItem } from '@/lib/core/types';
import { 
    getCategoryColor, 
    getSourceBadgeColor, 
    getCredibilityStyle,
    formatTimeAgo 
} from './MapConstants';
import { canonicalEventCount } from '@/lib/utils/ranking';

interface MapPopupProps {
    item: NewsItem;
}

/**
 * Modern React-based popup content for MapLibre markers.
 * Replaces legacy string concatenation to prevent XSS and enable reactive updates.
 */
export default function MapPopup({ item }: MapPopupProps) {
    const pinColor = getCategoryColor(item.category);
    const credStyle = getCredibilityStyle(item.credibilityTier);
    const sourceCount = canonicalEventCount(item);

    const latestSource = item.sources?.length
        ? [...item.sources].sort(
            (a, b) =>
                new Date(b.discoveredAt).getTime() -
                new Date(a.discoveredAt).getTime(),
        )[0]
        : null;
    
    const displayDate = latestSource
        ? latestSource.discoveredAt
        : (item.latestActivityAt || item.publishedAt);

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
                        style={{ background: credStyle.bg, color: credStyle.color }} 
                        title={`${credStyle.label} source`}
                    >
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-6.45 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
                        </svg>
                    </span>
                    {item.category && (
                        <span className="news-popup-category" style={{ background: pinColor }}>
                            {item.category}
                        </span>
                    )}
                    {sourceCount > 1 && (
                        <span className="news-popup-source-count" title={`${sourceCount} sources reporting on this`}>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                                <path d="M12.43,4.1a1,1,0,0,0-1,.12L6.65,8H3A1,1,0,0,0,2,9v6a1,1,0,0,0,1,1H6.65l4.73,3.78A1,1,0,0,0,12,20a.91.91,0,0,0,.43-.1A1,1,0,0,0,13,19V5A1,1,0,0,0,12.43,4.1ZM11,16.92l-3.38-2.7A1,1,0,0,0,7,14H4V10H7a1,1,0,0,0,.62-.22L11,7.08ZM19.66,6.34a1,1,0,0,0-1.42,1.42,6,6,0,0,1-.38,8.84,1,1,0,0,0,.64,1.76,1,1,0,0,0,.64-.23,8,8,0,0,0,.52-11.79ZM16.83,9.17a1,1,0,1,0-1.42,1.42A2,2,0,0,1,16,12a2,2,0,0,1-.71,1.53,1,1,0,0,0-.13,1.41,1,1,0,0,0,1.41.12A4,4,0,0,0,18,12,4.06,4.06,0,0,0,16.83,9.17Z"/>
                            </svg>
                            {sourceCount}
                        </span>
                    )}
                    <span className="news-popup-time">{formatTimeAgo(displayDate)}</span>
                    {item.locationName && (
                        <>
                            <span className="news-popup-meta-sep">•</span>
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
            <div className="news-popup-content">
                {item.imageUrl && (
                    <div className="news-popup-img-container">
                        <Image 
                            className="news-popup-img" 
                            src={item.imageUrl} 
                            alt="" 
                            fill
                            unoptimized
                            priority
                            sizes="(max-width: 860px) 100vw, 400px"
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
                {sourceCount <= 1 && (
                    <a className="news-popup-link" href={item.url} target="_blank" rel="noopener noreferrer">
                        View source →
                    </a>
                )}
            </div>
            {sourceCount > 1 && item.sources && (
                <div className="news-popup-sources-section">
                    <div className="news-popup-sources-header">Sources & Timeline</div>
                    <div className="news-popup-sources-list">
                        {[...item.sources]
                            .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
                            .map((src, i) => {
                                const srcColor = getSourceBadgeColor(src.name);
                                const srcTime = formatTimeAgo(src.discoveredAt);
                                return (
                                    <div key={i} className="news-popup-source-entry">
                                        <span className="news-popup-source-name" style={{ background: srcColor, color: '#fff' }}>
                                            {src.name}
                                        </span>
                                        <a className="news-popup-source-link" href={src.url} target="_blank" rel="noopener noreferrer">
                                            {new URL(src.url).hostname}
                                        </a>
                                        {srcTime && <span className="news-popup-source-time">{srcTime}</span>}
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
}
