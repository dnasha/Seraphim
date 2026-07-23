/**
 * Design system constants and style utilities for the Seraphim UI.
 * 
 * Defines the central color palette, category-specific themes, and logic for 
 * resolving styles for map pins, source badges, and credibility tiers.
 */

/** Brand colors used for interactive elements and primary accents. */
export const BRAND_COLORS = {
    indigo: '#5f62ec',
    indigoHover: '#818cf8',
    indigoActive: '#4f46e5',
};

/** Mapping of news categories to their respective theme colors. */
export const CATEGORY_COLORS: Record<string, string> = {
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

export const DEFAULT_PIN_COLOR = '#3b82f6';

/** Resolves the theme color for a specific news category. */
export function getCategoryColor(category?: string): string {
    if (!category) return DEFAULT_PIN_COLOR;
    return CATEGORY_COLORS[category] || DEFAULT_PIN_COLOR;
}

/** 
 * Determines background and text colors for source badges based on the source name.
 * 
 * This logic matches known social platforms, news agencies, and research units 
 * to provide visual cues for the origin of the information.
 */
export function getSourceStyle(sourceName: string): { bg: string; color: string } {
    const s = sourceName.toLowerCase();
    const color = '#ffffff';

    if (s.includes('(x)') || s.includes('twitter') || s === 'x')
        return { bg: '#000000', color };
    if (s.includes('reddit'))
        return { bg: '#ff4500', color };
    if (s.includes('telegram'))
        return { bg: '#0088cc', color };
    if (s.includes('gnews') || s === 'extra')
        return { bg: '#065f46', color };
    
    // All other news outlets and sources use the brand indigo
    return { bg: BRAND_COLORS.indigo, color };
}

/** Convenience helper for background color resolution. */
export function getSourceBadgeColor(sourceName: string): string {
    return getSourceStyle(sourceName).bg;
}

/** 
 * Credibility tier metadata for visual badges.
 * Tier 1: Verified (Diamond)
 * Tier 2: Credible (Gold)
 * Tier 3: Unverified (Silver)
 */
export const CREDIBILITY_TIERS: Record<number, { label: string; color: string }> = {
    1: { label: 'Verified', color: BRAND_COLORS.indigo },
    2: { label: 'Credible', color: '#93c5fd' }, // bright blue-indigo hybrid (blue-300)
    3: { label: 'Unverified', color: '#94a3b8' }, // slate-400
};

/** Resolves visual metadata for a credibility tier, defaulting to Tier 3. */
export function getCredibilityStyle(tier?: number): { label: string; color: string } {
    return CREDIBILITY_TIERS[tier ?? 3] ?? CREDIBILITY_TIERS[3];
}

/** SVG path data for news category icons used in the UI. */
export const CATEGORY_ICONS: Record<string, string> = {
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
