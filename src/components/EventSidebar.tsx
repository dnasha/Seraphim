'use client';

import { NewsItem } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { ReactNode } from 'react';

interface EventSidebarProps {
    items: NewsItem[];
    selectedItemId: string | null;
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
    onSelectItem,
    isLoading,
    filterBar,
    isDarkMode,
    onToggleTheme,
    lastUpdated,
}: EventSidebarProps) {
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
                        let timeAgo = '';
                        try {
                            timeAgo = formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true });
                        } catch {
                            timeAgo = '';
                        }

                        return (
                            <button
                                key={item.id}
                                className={`event-card ${isSelected ? 'event-card-active' : ''} ${hasGeo ? 'event-card-geo' : ''}`}
                                onClick={() => onSelectItem(item.id)}
                                type="button"
                            >
                                {item.imageUrl && (
                                    <div className="event-card-thumb">
                                        <img
                                            src={item.imageUrl}
                                            alt=""
                                            loading="lazy"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    </div>
                                )}
                                <div className="event-card-body">
                                    <h3 className="event-card-title">{item.title}</h3>
                                    <div className="event-card-meta">
                                        <span
                                            className="event-card-source"
                                            data-type={item.sourceType}
                                        >
                                            {item.source}
                                        </span>
                                        <span className="event-card-time">{timeAgo}</span>
                                    </div>
                                    {item.locationName && (
                                        <span className="event-card-location">{item.locationName}</span>
                                    )}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
