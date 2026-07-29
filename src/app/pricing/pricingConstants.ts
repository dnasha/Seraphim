export interface TierConfig {
    key: string;
    name: string;
    tagline: string;
    monthlyPrice: number;
    yearlyPrice: number;
    isLifetime: boolean;
    lifetimePrice: number;
    badge: string | null;
    popular: boolean;
    trialDays: number;
    features: string[];
    cta: string;
    priceKeyMonthly: string;
    priceKeyYearly: string;
}

export const TIERS: TierConfig[] = [
    {
        key: 'free',
        name: 'Free',
        tagline: 'Follow the signal every day',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: false,
        lifetimePrice: 0,
        badge: null,
        popular: false,
        trialDays: 0,
        features: [
            'Live global map with up to 50 stories per view',
            'Search the current 24-hour signal by source and category',
            'Standard and Dark maps with earthquake monitoring',
            'Draw, measure, and add local map notes',
        ],
        cta: 'Included',
        priceKeyMonthly: '',
        priceKeyYearly: '',
    },
    {
        key: 'pro',
        name: 'Pro',
        tagline: 'Monitor deeply as stories develop',
        monthlyPrice: 9.99,
        yearlyPrice: 99.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Most Popular',
        popular: true,
        trialDays: 14,
        features: [
            'Monitor up to 1,000 events across one month',
            'Reconstruct stories with complete source timelines',
            'Filter by coverage volume and source credibility',
            'Use every map style, 3D globe, weather, fire, and NASA overlays',
            'Includes every Free capability',
        ],
        cta: 'Start 14-Day Trial',
        priceKeyMonthly: 'pro_monthly',
        priceKeyYearly: 'pro_yearly',
    },
    {
        key: 'analyst',
        name: 'Analyst',
        tagline: 'Investigate, compare, and export',
        monthlyPrice: 29.99,
        yearlyPrice: 299.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Power User',
        popular: false,
        trialDays: 14,
        features: [
            'Search all retained history with custom time windows',
            'Import and export GeoJSON investigation data',
            'Track flights, ISS, air quality, and radiation',
            'Use Analyst inspection modes and individual pins',
            'Includes every Pro capability',
        ],
        cta: 'Start 14-Day Trial',
        priceKeyMonthly: 'analyst_monthly',
        priceKeyYearly: 'analyst_yearly',
    },
    {
        key: 'angel',
        name: 'Angel',
        tagline: 'Founder lifetime access',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: true,
        lifetimePrice: 399,
        badge: 'Limited 100',
        popular: false,
        trialDays: 0,
        features: [
            'Every current Analyst capability',
            'Lifetime access with one payment',
            'Angel Founder badge and manual Discord role',
            'Limited to 100 total memberships',
        ],
        cta: 'Get Lifetime Access',
        priceKeyMonthly: 'angel',
        priceKeyYearly: 'angel',
    },
];

export const COMPARISON_SECTIONS = [
    { label: 'Feed access', rows: [
        { feature: 'Stories per view', free: '50', pro: '1,000', analyst: '1,000', angel: '1,000' },
        { feature: 'History', free: '24 hours', pro: 'Up to 1 month', analyst: 'All retained + custom', angel: 'All retained + custom' },
        { feature: 'Source timeline', free: 'First + latest', pro: 'Full', analyst: 'Full', angel: 'Full' },
    ]},
    { label: 'Investigation workflow', rows: [
        { feature: 'Search / source / category filters', free: '✓', pro: '✓', analyst: '✓', angel: '✓' },
        { feature: 'Volume and credibility filters', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
        { feature: 'Draw and measure annotations', free: 'Local', pro: 'Local', analyst: 'Local', angel: 'Local' },
        { feature: 'GeoJSON import / export', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    ]},
    { label: 'Map intelligence', rows: [
        { feature: 'Map styles and 3D globe', free: 'Standard + Dark', pro: 'All styles + 3D', analyst: 'All styles + 3D', angel: 'All styles + 3D' },
        { feature: 'Live overlays', free: 'Earthquakes', pro: 'Weather, fires, NASA', analyst: 'All overlays', angel: 'All overlays' },
        { feature: 'Analyst inspection modes', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    ]},
    { label: 'Ownership', rows: [
        { feature: 'Billing', free: 'Free', pro: 'Subscription', analyst: 'Subscription', angel: 'One-time' },
        { feature: 'Trial', free: '—', pro: '14 days', analyst: '14 days', angel: '—' },
        { feature: 'Lifetime / Founder role', free: '—', pro: '—', analyst: '—', angel: '✓' },
    ]},
];
