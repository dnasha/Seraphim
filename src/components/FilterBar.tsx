'use client';

// category colors shared with NewsMap for pin colors
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

// SVG path data matching the map pin icons exactly
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
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onRefresh: () => void;
    isLoading: boolean;
}

const categoryOptions = [
    { value: 'general', label: 'All' },
    { value: 'world', label: 'World' },
    { value: 'crisis', label: 'Crisis' },
    { value: 'nation', label: 'Nation' },
    { value: 'business', label: 'Business' },
    { value: 'technology', label: 'Tech' },
    { value: 'science', label: 'Science' },
    { value: 'health', label: 'Health' },
];

const sourceOptions = [
    { value: 'gnews', label: 'GNews' },
    { value: 'rss', label: 'RSS Feeds' },
    { value: 'social', label: 'Social' },
];

export default function FilterBar({
    sources,
    onSourcesChange,
    categories,
    onCategoriesChange,
    searchQuery,
    onSearchChange,
    onRefresh,
    isLoading,
}: FilterBarProps) {
    const toggleSource = (source: string) => {
        if (sources.includes(source)) {
            if (sources.length > 1) {
                onSourcesChange(sources.filter(s => s !== source));
            }
        } else {
            onSourcesChange([...sources, source]);
        }
    };

    const toggleCategory = (category: string) => {
        if (category === 'general') {
            onCategoriesChange(['general']);
            return;
        }

        const withoutGeneral = categories.filter(c => c !== 'general');

        if (withoutGeneral.includes(category)) {
            const updated = withoutGeneral.filter(c => c !== category);
            onCategoriesChange(updated.length > 0 ? updated : ['general']);
        } else {
            onCategoriesChange([...withoutGeneral, category]);
        }
    };

    return (
        <div className="filter-bar">
            <div className="filter-section">
                <label className="filter-label">Search</label>
                <div className="search-input-container">
                    <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search news..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="search-input"
                    />
                </div>
            </div>

            <div className="filter-section">
                <label className="filter-label">Sources</label>
                <div className="source-row">
                    <div className="source-toggles">
                        {sourceOptions.map((option) => (
                            <button
                                key={option.value}
                                className={`source-toggle ${sources.includes(option.value) ? 'active' : ''}`}
                                onClick={() => toggleSource(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <button
                        className={`refresh-button ${isLoading ? 'loading' : ''}`}
                        onClick={onRefresh}
                        disabled={isLoading}
                    >
                        <svg className="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 12a9 9 0 1 1-9-9c4.52 0 8.21 3.33 8.88 7.67" />
                            <path d="M21 3v6h-6" />
                        </svg>
                        {isLoading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="filter-section">
                <label className="filter-label">Categories</label>
                <div className="category-toggles">
                    {categoryOptions.map((cat) => {
                        const isActive = categories.includes(cat.value);
                        const color = CATEGORY_COLORS[cat.value] || '#6b7280';
                        const iconPath = CATEGORY_ICONS[cat.value] || CATEGORY_ICONS.general;
                        return (
                            <button
                                key={cat.value}
                                className={`category-toggle ${isActive ? 'active' : ''}`}
                                onClick={() => toggleCategory(cat.value)}
                                style={{
                                    borderColor: isActive ? color : undefined,
                                    background: isActive ? color : undefined,
                                }}
                            >
                                <svg
                                    className="category-icon-svg"
                                    viewBox="0 0 24 24"
                                    width="12"
                                    height="12"
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
    );
}
