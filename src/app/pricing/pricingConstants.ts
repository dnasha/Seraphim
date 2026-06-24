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
    excluded: string[];
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
            '100 events per request, refreshed in real time',
            '24-hour feed with search, source, and category filters',
            'Standard and Dark maps plus earthquake overlay',
            'Draw, measure, and local text annotations',
        ],
        excluded: [
            'Historical monitoring and full source timelines',
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
        trialDays: 7,
        features: [
            'Full feed: up to 1,000 events per request',
            '3-day, 1-week, and 1-month history',
            'Full source timelines and advanced filters',
            'All map styles, 3D globe, weather, fire, and NASA overlays',
            'Everything in Free',
            '7 day trial on monthly billing',
            'Monthly or yearly billing',
            'Pro tier badge in app',
        ],
        excluded: [
            'Lifetime billing',
        ],
        cta: 'Start 7 Day Trial',
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
        trialDays: 0,
        features: [
            'Everything in Pro',
            'All retained history and custom time windows',
            'GeoJSON annotation import and export',
            'Flight, maritime, ISS, AQI, and radiation layers',
            'Analyst inspection modes',
            'Monthly or yearly billing',
        ],
        excluded: [
            'Lifetime billing',
        ],
        cta: 'Upgrade to Analyst',
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
        lifetimePrice: 299,
        badge: 'Limited 100',
        popular: false,
        trialDays: 0,
        features: [
            'Everything in Analyst',
            'Lifetime access with one payment',
            'Angel Founder badge and manual Discord role',
            'Limited to 100 total memberships',
        ],
        excluded: [],
        cta: 'Get Lifetime Access',
        priceKeyMonthly: 'angel',
        priceKeyYearly: 'angel',
    },
];

export const COMPARISON_SECTIONS = [
    { label: 'Feed access', rows: [
        { feature: 'Events per request', free: '100', pro: '1,000', analyst: '1,000', angel: '1,000' },
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
        { feature: 'Trial', free: '—', pro: '7 days monthly', analyst: '—', angel: '—' },
        { feature: 'Lifetime / Founder role', free: '—', pro: '—', analyst: '—', angel: '✓' },
    ]},
];
