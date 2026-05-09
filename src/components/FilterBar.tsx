'use client';

/*
Dan Sharan
FilterBar component provides interface for filtering news by source, category, and time.
*/
import { useState } from 'react';
import styles from './FilterBar.module.css';

import { BRAND_COLORS } from '@/lib/colors';

// Category colors (pending extraction to shared lib/colors)
const CATEGORY_COLORS: Record<string, string> = {
    all: BRAND_COLORS.indigo,
    general: '#3b82f6',
    world: '#dc2626',
    crisis: '#b91c1c',
    nation: '#2563eb',
    business: '#d97706',
    technology: '#0891b2',
    science: '#059669',
    health: '#7c3aed',
};

// svg path data matching the map pin icons exactly
const CATEGORY_ICONS: Record<string, string> = {
    all: 'M22,9.81a1,1,0,0,0-.83-.69l-5.7-.78L12.88,3.53a1,1,0,0,0-1.76,0L8.57,8.34l-5.7.78a1,1,0,0,0-.82.69,1,1,0,0,0,.28,1l4.09,3.73-1,5.24A1,1,0,0,0,6.88,20.9L12,18.38l5.12,2.52a1,1,0,0,0,.44.1,1,1,0,0,0,1-1.18l-1-5.24,4.09-3.73A1,1,0,0,0,22,9.81Z',
    general: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    world: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    crisis: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    nation: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
    business: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
    technology: 'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z',
    science: 'M13 11.33L18 18H6l5-6.67V6h2v5.33zM15.96 4H8.04C7.62 4 7.39 4.48 7.65 4.81L9 6.5v4.17L3.2 18.4C2.71 19.06 3.18 20 4 20h16c.82 0 1.29-.94.8-1.6L15 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81z',
    health: 'M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z',
};

interface FilterBarProps {
    sources: string[];
    onSourcesChange: (sources: string[]) => void;
    categories: string[];
    onCategoriesChange: (categories: string[]) => void;
    timeRange: string;
    onTimeRangeChange: (time: string) => void;
    customStartDate?: string;
    onCustomStartDateChange?: (date: string) => void;
    customEndDate?: string;
    onCustomEndDateChange?: (date: string) => void;
}

const categoryOptions = [
    { value: 'all', label: 'All' },
    { value: 'world', label: 'World' },
    { value: 'crisis', label: 'Crisis' },
    { value: 'nation', label: 'Nation' },
    { value: 'business', label: 'Business' },
    { value: 'technology', label: 'Tech' },
    { value: 'science', label: 'Science' },
    { value: 'health', label: 'Health' },
];

const sourceOptions = [
    { value: 'news', label: 'News', bg: BRAND_COLORS.indigo, color: '#ffffff' },
    { value: 'reddit', label: 'Reddit', bg: '#ff4500', color: '#ffffff' },
    { value: 'x', label: 'X', bg: '#0f1419', color: '#ffffff' },
    { value: 'telegram', label: 'Telegram', bg: '#0088cc', color: '#ffffff' },
    { value: 'extra', label: 'Gnews', bg: '#065f46', color: '#ffffff' },
];

const timeOptions = [
    { value: '1d', label: '24 Hrs' },
    { value: '3d', label: '3 Days' },
    { value: '1w', label: '1 Week' },
    { value: '1m', label: '1 Month' },
    { value: 'custom', label: 'Custom' },
];

const renderSourceIcon = (sourceValue: string) => {
  const name = sourceValue.toLowerCase();

  if (name === "news") {
    return (
      <svg className={styles.sourceIcon} viewBox="0 0 52 46" fill="currentColor">
        <path d="M50.5,6h-41C8.7,6,8,6.7,8,7.5V38c0,1.2-1.1,2.2-2.3,2c-1-0.2-1.7-1.1-1.7-2.1V16c0-0.6-0.4-1-1-1H1.5
	C0.7,15,0,15.7,0,16.5V42c0,2.2,1.8,4,4,4h4h40c2.2,0,4-1.8,4-4V7.5C52,6.7,51.3,6,50.5,6z M28,35c0,0.6-0.4,1-1,1H15
	c-0.6,0-1-0.4-1-1v-2c0-0.6,0.4-1,1-1h12c0.6,0,1,0.4,1,1V35z M28,27c0,0.6-0.4,1-1,1H15c-0.6,0-1-0.4-1-1v-2c0-0.6,0.4-1,1-1h12
	c0.6,0,1,0.4,1,1V27z M46,35c0,0.6-0.4,1-1,1H33c-0.6,0-1-0.4-1-1v-2c0-0.6,0.4-1,1-1h12c0.6,0,1,0.4,1,1V35z M46,27
	c0,0.6-0.4,1-1,1H33c-0.6,0-1-0.4-1-1v-2c0-0.6,0.4-1,1-1h12c0.6,0,1,0.4,1,1V27z M46,19c0,0.6-0.4,1-1,1H15c-0.6,0-1-0.4-1-1v-6
	c0-0.6,0.4-1,1-1h30c0.6,0,1,0.4,1,1V19z"/>
      </svg>
    );
  }

  if (name === "reddit") {
    return (
      <svg className={styles.sourceIcon} viewBox="0 0 100 100" fill="currentColor">
        <path d="M94.762,48.994c0-5.688-4.63-10.314-10.315-10.314c-2.463,0-4.767,0.901-6.626,2.477c-0.06,0.037-0.122,0.072-0.181,0.11
		c-6.707-4.291-15.601-7.031-25.439-7.403l5.872-16.698l14.656,3.504c0.012,4.633,3.781,8.4,8.42,8.4
		c4.642,0,8.422-3.777,8.422-8.421c0-4.646-3.78-8.423-8.422-8.423c-3.529,0-6.544,2.182-7.794,5.26l-17.364-4.15l-7.211,20.49
		c-10.259,0.193-19.556,2.969-26.513,7.404c-1.873-1.625-4.21-2.551-6.718-2.551c-5.687,0-10.31,4.627-10.31,10.314
		c0,3.518,1.815,6.768,4.756,8.66c-0.179,1.025-0.293,2.064-0.293,3.123c0,14.886,18.043,26.997,40.219,26.997
		c22.18,0,40.224-12.111,40.224-26.997c0-1.027-0.103-2.037-0.272-3.035C92.893,55.863,94.762,52.566,94.762,48.994z M63.598,62.347
		c-3.5,0-6.334-2.834-6.334-6.338c0-3.498,2.834-6.334,6.334-6.334c3.5,0,6.339,2.836,6.339,6.334
		C69.937,59.513,67.097,62.347,63.598,62.347z M64.859,73.153c-0.19,0.194-4.733,4.821-15.009,4.821
		c-10.333,0-14.463-4.689-14.636-4.891c-0.579-0.677-0.5-1.703,0.178-2.283c0.677-0.575,1.692-0.501,2.278,0.166
		c0.092,0.104,3.54,3.771,12.18,3.771c8.784,0,12.639-3.798,12.68-3.835c0.62-0.636,1.646-0.648,2.284-0.027
		C65.451,71.494,65.474,72.506,64.859,73.153z M30.809,56.009c0-3.498,2.833-6.334,6.339-6.334c3.494,0,6.334,2.836,6.334,6.334
		c0,3.504-2.84,6.338-6.334,6.338C33.643,62.347,30.809,59.513,30.809,56.009z"/>
      </svg>
    );
  }

  if (name === "telegram") {
    return (
      <svg className={styles.sourceIcon} viewBox="0 0 48 48" fill="currentColor">
        <path d="M41.4193 7.30899C41.4193 7.30899 45.3046 5.79399 44.9808 9.47328C44.8729 10.9883 43.9016 16.2908 43.1461 22.0262L40.5559 39.0159C40.5559 39.0159 40.3401 41.5048 38.3974 41.9377C36.4547 42.3705 33.5408 40.4227 33.0011 39.9898C32.5694 39.6652 24.9068 34.7955 22.2086 32.4148C21.4531 31.7655 20.5897 30.4669 22.3165 28.9519L33.6487 18.1305C34.9438 16.8319 36.2389 13.8019 30.8426 17.4812L15.7331 27.7616C15.7331 27.7616 14.0063 28.8437 10.7686 27.8698L3.75342 25.7055C3.75342 25.7055 1.16321 24.0823 5.58815 22.459C16.3807 17.3729 29.6555 12.1786 41.4193 7.30899Z" />
      </svg>
    );
  }

  if (name === "x") {
    return <span className={styles.sourceIconX}>𝕏</span>;
  }

  // Default (Bonus star)
  return (
    <svg className={styles.sourceIcon} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22,9.81a1,1,0,0,0-.83-.69l-5.7-.78L12.88,3.53a1,1,0,0,0-1.76,0L8.57,8.34l-5.7.78a1,1,0,0,0-.82.69,1,1,0,0,0,.28,1l4.09,3.73-1,5.24A1,1,0,0,0,6.88,20.9L12,18.38l5.12,2.52a1,1,0,0,0,.44.1,1,1,0,0,0,1-1.18l-1-5.24,4.09-3.73A1,1,0,0,0,22,9.81Z" />
    </svg>
  );
};

export default function FilterBar({
    sources,
    onSourcesChange,
    categories,
    onCategoriesChange,
    timeRange,
    onTimeRangeChange,
    customStartDate,
    onCustomStartDateChange,
    customEndDate,
    onCustomEndDateChange,
}: FilterBarProps) {
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    const toLocalISO = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    /* Resets custom date range to the last 24 hours */
    const resetTo24h = () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        onCustomStartDateChange?.(toLocalISO(yesterday));
        onCustomEndDateChange?.(toLocalISO(now));
    };

    const handleTimeToggleClick = (value: string) => {
        if (value === 'custom') {
            if (timeRange === 'custom') {
                setIsPickerOpen(!isPickerOpen);
            } else {
                onTimeRangeChange(value);
                setIsPickerOpen(true);
            }
        } else {
            onTimeRangeChange(value);
            setIsPickerOpen(false);
        }
    };

    const toggleSource = (source: string) => {
        /* Ensure at least one source remains selected */
        if (sources.includes(source)) {
            if (sources.length > 1) {
                onSourcesChange(sources.filter(s => s !== source));
            }
        } else {
            onSourcesChange([...sources, source]);
        }
    };

    const toggleCategory = (category: string) => {
        /*
          The 'all' category resets selection. 
          Specific categories toggle individually.
          If all categories are deselected, it defaults back to 'all'.
        */
        if (category === 'all') {
            onCategoriesChange(['all']);
            return;
        }

        const withoutAll = categories.filter(c => c !== 'all');

        if (withoutAll.includes(category)) {
            const updated = withoutAll.filter(c => c !== category);
            onCategoriesChange(updated.length > 0 ? updated : ['all']);
        } else {
            onCategoriesChange([...withoutAll, category]);
        }
    };

    /**
     * Converts vertical scroll wheel movement into horizontal scrolling for the filter containers.
     * This improves UX for desktop users without horizontal-swipe capabilities.
     */
    const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
        if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
        }
    };

    return (
        <div className={styles.filterBar}>
            <div className={styles.scrollableFilters}>
                <div className={styles.filterSection}>
                    <div className={styles.scrollWrapper} onWheel={handleWheelScroll}>
                        <div className={styles.categoryToggles}>
                            {categoryOptions.map((cat) => {
                                const isActive = categories.includes(cat.value);
                                const color = CATEGORY_COLORS[cat.value] || '#6b7280';
                                const iconPath = CATEGORY_ICONS[cat.value] || CATEGORY_ICONS.general;
                                return (
                                    <button
                                        key={cat.value}
                                        className={`${styles.categoryToggle} ${isActive ? styles.categoryToggleActive : ''}`}
                                        onClick={() => toggleCategory(cat.value)}
                                        style={{
                                            '--btn-color': color,
                                            borderColor: isActive ? color : undefined,
                                            background: isActive ? color : undefined,
                                        } as React.CSSProperties}
                                    >
                                        <svg
                                            className={styles.categoryIconSvg}
                                            viewBox="0 0 24 24"
                                            width="15"
                                            height="15"
                                            fill={isActive ? '#fff' : color}
                                            style={{ opacity: isActive ? 1 : 0.65, flexShrink: 0 }}
                                        >
                                            <path d={iconPath} />
                                        </svg>
                                        {cat.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className={styles.filterSection}>
                    <div className={styles.timeFilterContainer}>
                        <div className={styles.scrollWrapper} onWheel={handleWheelScroll}>
                            <div className={styles.sourceToggles}>
                                {timeOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        className={`${styles.timeToggle} ${timeRange === option.value ? styles.timeToggleActive : ''}`}
                                        onClick={() => handleTimeToggleClick(option.value)}
                                        style={{ '--btn-color': 'var(--accent)' } as React.CSSProperties}
                                    >
                                        {option.value === 'custom' && (
                                            <svg 
                                                viewBox="0 0 1024 1024" 
                                                width="14" 
                                                height="14" 
                                                fill="currentColor"
                                                style={{ flexShrink: 0 }}
                                            >
                                                <path d="M790.811 120.124h-56.047V64.133h-55.99v55.99H342.837v-55.99h-55.989v55.99h-56.047c-61.556 0-111.921 50.366-111.921 111.92v616.004c0 61.555 50.364 111.919 111.92 111.919h560.011c61.556 0 111.921-50.364 111.921-111.92V232.044c0-61.554-50.365-111.92-111.921-111.92z m-560.01 55.99h56.047v55.987h55.99v-55.987h335.936v55.987h55.99v-55.987h56.047c30.841 0 55.932 25.09 55.932 55.93V344.08H174.869V232.043c0-30.84 25.09-55.929 55.932-55.929z m560.01 727.862h-560.01c-30.842 0-55.932-25.09-55.932-55.93V400.07h671.873v447.978c0 30.839-25.09 55.928-55.931 55.928z" />
                                                <path d="M286.848 512.048h447.916v55.99H286.848v-55.99zM286.848 681.766h447.916v55.99H286.848v-55.99z" />
                                            </svg>
                                        )}
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {isPickerOpen && timeRange === 'custom' && (
                            <div className={styles.customDateContainer}>
                                <button 
                                    className={styles.closePickerBtn} 
                                    onClick={() => setIsPickerOpen(false)}
                                    aria-label="Close picker"
                                >
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                    </svg>
                                </button>
                                <div className={styles.customDateRow}>
                                    {(() => {
                                        const nowStr = toLocalISO(new Date());
                                        return (
                                            <>
                                                <div className={styles.dateInputGroup}>
                                                    <label>Start</label>
                                                    <input
                                                        type="datetime-local"
                                                        className={styles.dateInput}
                                                        value={customStartDate || ''}
                                                        min="2026-04-11T00:00"
                                                        max={customEndDate || nowStr}
                                                        onChange={(e) => onCustomStartDateChange?.(e.target.value)}
                                                    />
                                                </div>
                                                <div className={styles.dateInputGroup}>
                                                    <label>End</label>
                                                    <input
                                                        type="datetime-local"
                                                        className={styles.dateInput}
                                                        value={customEndDate || ''}
                                                        min={customStartDate || "2026-04-11T00:00"}
                                                        max={nowStr}
                                                        onChange={(e) => onCustomEndDateChange?.(e.target.value)}
                                                    />
                                                </div>
                                                <div className={styles.pickerFooter}>
                                                    <button 
                                                        className={styles.resetBtn} 
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            resetTo24h();
                                                        }}
                                                    >
                                                        Reset
                                                    </button>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className={styles.filterSection}>
                    <div className={styles.scrollWrapper} onWheel={handleWheelScroll}>
                        <div className={styles.sourceToggles}>
                            {sourceOptions.map((option) => {
                                const isActive = sources.includes(option.value);
                                return (
                                    <button
                                        key={option.value}
                                        className={`${styles.sourceToggle} ${isActive ? styles.sourceToggleActive : ''}`}
                                        onClick={() => toggleSource(option.value)}
                                        style={{
                                            '--btn-color': option.bg,
                                            backgroundColor: isActive ? option.bg : undefined,
                                            borderColor: isActive ? option.bg : undefined,
                                            color: isActive ? option.color : undefined,
                                        } as React.CSSProperties}
                                    >
                                        {renderSourceIcon(option.value)}
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
