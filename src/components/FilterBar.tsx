'use client';

/*
Dan Sharan
FilterBar component provides interface for filtering news by source, category, and time.
*/
import styles from './FilterBar.module.css';

// Category colors (pending extraction to shared lib/colors)
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

// svg path data matching the map pin icons exactly
const CATEGORY_ICONS: Record<string, string> = {
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
    mappedOnly: boolean;
    onMappedOnlyChange: (mappedOnly: boolean) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
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
    { value: 'news', label: 'News', bg: '#6b7280', color: '#ffffff' },
    { value: 'reddit', label: 'Reddit', bg: '#ff4500', color: '#ffffff' },
    { value: 'x', label: 'X', bg: '#000000', color: '#ffffff' },
    { value: 'telegram', label: 'Telegram', bg: '#006eff', color: '#ffffff' },
    { value: 'extra', label: 'Bonus', bg: '#c528bdff', color: '#ffffff' },
];

const timeOptions = [
    { value: '1d', label: '1D' },
    { value: '3d', label: '3D' },
    { value: '1w', label: '1W' },
    { value: '1m', label: '1M' },
    { value: 'all', label: 'All' },
];

export default function FilterBar({
    sources,
    onSourcesChange,
    categories,
    onCategoriesChange,
    timeRange,
    onTimeRangeChange,
    mappedOnly,
    onMappedOnlyChange,
    searchQuery,
    onSearchChange,
}: FilterBarProps) {
    const toggleSource = (source: string) => {
        // Ensure at least one source remains selected
        if (sources.includes(source)) {
            if (sources.length > 1) {
                onSourcesChange(sources.filter(s => s !== source));
            }
        } else {
            onSourcesChange([...sources, source]);
        }
    };

    const toggleCategory = (category: string) => {
        // 'all' resets selection, specific categories toggle individually
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

    return (
        <div className={styles.filterBar}>
            <div className={styles.filterSection}>
                <label className={styles.filterLabel}>Sources</label>
                <div className={styles.sourceRow}>
                    <div className={styles.sourceToggles}>
                        {sourceOptions.map((option) => {
                            const isActive = sources.includes(option.value);
                            return (
                                <button
                                    key={option.value}
                                    className={`${styles.sourceToggle} ${isActive ? styles.sourceToggleActive : ''}`}
                                    onClick={() => toggleSource(option.value)}
                                    style={{
                                        backgroundColor: isActive ? option.bg : undefined,
                                        borderColor: isActive ? option.bg : undefined,
                                        color: isActive ? option.color : undefined,
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className={styles.filterSection}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className={styles.filterLabel}>Time &amp; Location</label>
                </div>
                <div className={styles.sourceRow}>
                    <div className={styles.sourceToggles}>
                        {timeOptions.map((option) => (
                            <button
                                key={option.value}
                                className={`${styles.timeToggle} ${timeRange === option.value ? styles.timeToggleActive : ''}`}
                                onClick={() => onTimeRangeChange(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                        <div className={styles.filterDivider} />
                        <button
                            className={`${styles.timeToggle} ${mappedOnly ? styles.timeToggleActive : ''}`}
                            onClick={() => onMappedOnlyChange(!mappedOnly)}
                            style={{ backgroundColor: mappedOnly ? '#22c55e' : undefined, borderColor: mappedOnly ? '#22c55e' : undefined }}
                        >
                            Mapped Only
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filterSection}>
                <label className={styles.filterLabel}>Categories</label>
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
                                    borderColor: isActive ? color : undefined,
                                    background: isActive ? color : undefined,
                                }}
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

            <div className={styles.filterSection} style={{ marginTop: '4px' }}>
                <div className={styles.searchInputContainer}>
                    <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search news..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className={styles.searchInput}
                    />
                </div>
            </div>
        </div>
    );
}
