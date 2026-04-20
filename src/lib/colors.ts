/**
 * Category and source-specific styling constants and utilities.
 */
export const CATEGORY_COLORS: Record<string, string> = {
    general: '#166534',
    world: '#dc2626',
    crisis: '#b91c1c',
    nation: '#2563eb',
    business: '#d97706',
    technology: '#0891b2',
    science: '#059669',
    health: '#7c3aed',
};

export const DEFAULT_PIN_COLOR = '#166534';

export function getCategoryColor(category?: string): string {
    if (!category) return DEFAULT_PIN_COLOR;
    return CATEGORY_COLORS[category] || DEFAULT_PIN_COLOR;
}

export function getSourceStyle(sourceName: string): { bg: string; color: string } {
    const s = sourceName.toLowerCase();
    const color = '#ffffff';

    if (s.includes('(x)') || s.includes('twitter'))
        return { bg: '#000000', color };
    if (s.includes('reddit'))
        return { bg: '#ff4500', color };
    if (s.includes('telegram'))
        return { bg: '#006effff', color };
    if (s.includes('bellingcat') || s.includes('isw') || s.includes('war on the rocks'))
        return { bg: '#6d3100ff', color };
    if (s.includes('ars technica') || s.includes('verge') || s.includes('bleeping') || s.includes('hacker news'))
        return { bg: '#008fb3ff', color };
    if (s.includes('nasa') || s.includes('nature'))
        return { bg: '#059669', color };
    if (s.includes('who '))
        return { bg: '#7c3aed', color };
    
    // mainstream media default
    return { bg: '#818181ff', color };
}

export function getSourceBadgeColor(sourceName: string): string {
    return getSourceStyle(sourceName).bg;
}
