/*
Category and source-specific styling constants and utilities.
Provides color mapping for map pins and UI badges based on news categories and sources.
*/

export const CATEGORY_COLORS: Record<string, string> = {
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

/* Returns the color associated with a news category. Defaults to blue. */
export function getCategoryColor(category?: string): string {
    if (!category) return DEFAULT_PIN_COLOR;
    return CATEGORY_COLORS[category] || DEFAULT_PIN_COLOR;
}

/* 
Determines background and text color for source badges based on the source name.
Supports major social platforms and specific news outlets.
*/
export function getSourceStyle(sourceName: string): { bg: string; color: string } {
    const s = sourceName.toLowerCase();
    const color = '#ffffff';

    if (s.includes('(x)') || s.includes('twitter'))
        return { bg: '#0f1419', color };
    if (s.includes('reddit'))
        return { bg: '#ff4500', color };
    if (s.includes('telegram'))
        return { bg: '#0088cc', color };
    if (s.includes('bellingcat') || s.includes('isw') || s.includes('war on the rocks'))
        return { bg: '#c2410c', color };
    if (s.includes('ars technica') || s.includes('verge') || s.includes('bleeping') || s.includes('hacker news'))
        return { bg: '#0369a1', color };
    if (s.includes('nasa') || s.includes('nature'))
        return { bg: '#059669', color };
    if (s.includes('who '))
        return { bg: '#7c3aed', color };
    
    /* Default style for mainstream media and other sources. */
    return { bg: '#3b82f6', color };
}

/* Returns the background color for a source badge. */
export function getSourceBadgeColor(sourceName: string): string {
    return getSourceStyle(sourceName).bg;
}

/*
Credibility tier metadata for the Story model.
Tier 1: Diamond - Verified
Tier 2: Gold - Credible
Tier 3: Silver - Unverified
*/
export const CREDIBILITY_TIERS: Record<number, { label: string; color: string; bg: string }> = {
    1: { label: 'Verified', color: '#0369a1', bg: '#e0f2fe' }, // Diamond Blue
    2: { label: 'Credible', color: '#92400e', bg: '#fbbf24' },  // Gold
    3: { label: 'Unverified', color: '#475569', bg: '#cbd5e1' }, // Silver
};

/* Returns style metadata for a credibility tier badge. Defaults to Tier 3. */
export function getCredibilityStyle(tier?: number): { label: string; color: string; bg: string } {
    return CREDIBILITY_TIERS[tier ?? 3] ?? CREDIBILITY_TIERS[3];
}
