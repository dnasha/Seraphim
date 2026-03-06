'use client';

import { NewsItem } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { ReactNode, useEffect, useRef, useState } from 'react';

// Category colors (same as FilterBar / NewsMap)
const CATEGORY_COLORS: Record<string, string> = {
    general: '#6b7280',
    world: '#dc2626',
    crisis: '#b91c1c',
    nation: '#2563eb',
    business: '#d97706',
    technology: '#0891b2',
    science: '#059669',
    health: '#7c3aed',
};

/*
function getSourceBadgeColor(sourceName: string): string {
    const s = sourceName.toLowerCase();
    if (s.includes('(x)') || s.includes('twitter')) return '#000000';
    if (s.includes('reddit')) return '#ff4500';
    if (s.includes('telegram')) return '#006effff';
    if (s.includes('bellingcat') || s.includes('isw') || s.includes('war on the rocks')) return '#6d3100ff';
    if (s.includes('ars technica') || s.includes('verge') || s.includes('bleeping') || s.includes('hacker news')) return '#008fb3ff';
    if (s.includes('nasa') || s.includes('nature')) return '#059669';
    if (s.includes('who ')) return '#7c3aed';
    return '#818181ff';
}
*/

// Source platform colors for badge styling
function getSourceStyle(sourceName: string): { bg: string; color: string } {
    const s = sourceName.toLowerCase();
    if (s.includes('(x)') || s.includes('twitter'))
        return { bg: '#000000', color: '#ffffff' };
    if (s.includes('reddit'))
        return { bg: '#ff4500', color: '#ffffff' };
    if (s.includes('telegram'))
        return { bg: '#006effff', color: '#ffffff' };
    if (s.includes('bellingcat') || s.includes('isw') || s.includes('war on the rocks'))
        return { bg: '#6d3100ff', color: '#ffffff' };
    if (s.includes('ars technica') || s.includes('verge') || s.includes('bleeping') || s.includes('hacker news'))
        return { bg: '#008fb3ff', color: '#ffffff' };
    if (s.includes('nasa') || s.includes('nature'))
        return { bg: '#059669', color: '#ffffff' };
    if (s.includes('who '))
        return { bg: '#7c3aed', color: '#ffffff' };
    // mainstream media default
    return { bg: '#818181ff', color: '#ffffff' };
}

interface EventSidebarProps {
    items: NewsItem[];
    selectedItemId: string | null;
    selectionVersion: number;
    onSelectItem: (id: string) => void;
    isLoading: boolean;
    filterBar: ReactNode;
    isDarkMode: boolean;
    onToggleTheme: () => void;
    lastUpdated: string | null;
}

export default function EventSidebar({
    items,
    selectedItemId,
    selectionVersion,
    onSelectItem,
    isLoading,
    filterBar,
    isDarkMode,
    onToggleTheme,
    lastUpdated,
}: EventSidebarProps) {
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    // Track which card is expanded (for unmapped articles)
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Auto-scroll the selected card into view when selection changes
    useEffect(() => {
        if (!selectedItemId) return;
        const el = cardRefs.current.get(selectedItemId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [selectedItemId, selectionVersion]);

    const handleCardClick = (item: NewsItem) => {
        const hasGeo = item.latitude !== undefined;

        if (hasGeo) {
            // Mapped article → select it (flies map to pin)
            onSelectItem(item.id);
            setExpandedId(null);
        } else {
            // Unmapped article → toggle expanded detail inline
            setExpandedId(prev => prev === item.id ? null : item.id);
        }
    };

    return (
        <aside className="event-sidebar">
            <div className="event-sidebar-header">
                <div className="event-sidebar-logo">
                    <h1>Seraphim</h1>
                    <div className="event-sidebar-actions">
                        {lastUpdated && (
                            <span className="last-updated">
                                Updated: {new Date(lastUpdated).toLocaleTimeString()}
                            </span>
                        )}
                        <button
                            className="theme-toggle"
                            onClick={onToggleTheme}
                            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            {isDarkMode ? '☀️' : '🌙'}
                        </button>
                    </div>
                </div>
            </div>

            {filterBar}

            <div className="event-sidebar-stats">
                <span className="stat-pill">
                    {items.length} articles
                </span>
                <span className="stat-pill stat-pill-geo">
                    {items.filter(i => i.latitude !== undefined).length} mapped
                </span>
            </div>

            <div className="event-list">
                {isLoading && items.length === 0 ? (
                    <div className="event-list-loading">
                        <div className="loading-spinner" />
                        <p>Scanning sources…</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="event-list-empty">
                        <h3>No events found</h3>
                        <p>Try adjusting your filters</p>
                    </div>
                ) : (
                    items.map(item => {
                        const isSelected = item.id === selectedItemId;
                        const hasGeo = item.latitude !== undefined;
                        const isExpanded = expandedId === item.id;
                        const catColor = CATEGORY_COLORS[item.category || 'general'] || CATEGORY_COLORS.general;
                        let timeAgo = '';
                        try {
                            timeAgo = formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true });
                        } catch {
                            timeAgo = '';
                        }

                        return (
                            <div
                                key={item.id}
                                ref={(el) => {
                                    if (el) {
                                        cardRefs.current.set(item.id, el);
                                    } else {
                                        cardRefs.current.delete(item.id);
                                    }
                                }}
                                className={`event-card${isSelected ? ' event-card-active' : ''}${hasGeo ? ' event-card-geo' : ' event-card-unmapped'}${isExpanded ? ' event-card-expanded' : ''}`}
                                onClick={() => handleCardClick(item)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(item); }}
                            >
                                {/* Category accent bar on left edge */}
                                <div className="event-card-accent" style={{ backgroundColor: catColor }} />

                                {/* Main row: thumbnail + text */}
                                <div className="event-card-row">
                                    {item.imageUrl && (
                                        <div className="event-card-thumb">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={item.imageUrl}
                                                alt=""
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                onError={(e) => {
                                                    const img = e.target as HTMLImageElement;
                                                    if (img.parentElement) img.parentElement.style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div className="event-card-body">
                                        <h3 className="event-card-title">{item.title}</h3>
                                        <div className="event-card-meta">
                                            <span
                                                className="event-card-source"
                                                style={{
                                                    background: getSourceStyle(item.source).bg,
                                                    color: getSourceStyle(item.source).color,
                                                }}
                                            >
                                                {item.source}
                                            </span>
                                            <span className="event-card-time">{timeAgo}</span>
                                        </div>
                                        {item.locationName && (
                                            <span className="event-card-location">{item.locationName}</span>
                                        )}
                                        {!hasGeo && !isExpanded && (
                                            <span className="event-card-expand-hint">Click to expand</span>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded detail panel for unmapped articles */}
                                {isExpanded && (
                                    <div className="event-card-detail" onClick={(e) => e.stopPropagation()}>
                                        {item.imageUrl && (
                                            <div className="event-card-detail-img">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={item.imageUrl}
                                                    alt=""
                                                    referrerPolicy="no-referrer"
                                                    onError={(e) => {
                                                        const img = e.target as HTMLImageElement;
                                                        if (img.parentElement) img.parentElement.style.display = 'none';
                                                    }}
                                                />
                                            </div>
                                        )}
                                        {item.description && (
                                            <p className="event-card-detail-desc">
                                                {item.description.length > 300
                                                    ? item.description.slice(0, 300) + '…'
                                                    : item.description}
                                            </p>
                                        )}
                                        <a
                                            className="event-card-detail-link"
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Read full article →
                                        </a>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
