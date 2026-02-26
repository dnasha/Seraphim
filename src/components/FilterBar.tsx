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
                                <span
                                    className="category-dot"
                                    style={{
                                        background: isActive ? '#fff' : color,
                                        opacity: isActive ? 1 : 0.5,
                                    }}
                                />
                                {cat.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
