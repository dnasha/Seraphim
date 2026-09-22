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
    includes?: string;
    cta: string;
    priceKeyMonthly: string;
    priceKeyYearly: string;
}

export const TIERS: TierConfig[] = [
    {
        key: 'free',
        name: 'Free',
        tagline: 'For a daily view of the world.',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: false,
        lifetimePrice: 0,
        badge: null,
        popular: false,
        trialDays: 0,
        features: [
            '50 stories per view, with 24-hour history',
            'Search by source and category',
            'Standard and Dark maps + earthquakes',
            'Draw, measure, and save local map notes',
        ],
        cta: 'Included',
        priceKeyMonthly: '',
        priceKeyYearly: '',
    },
    {
        key: 'pro',
        name: 'Pro',
        tagline: 'For following the stories that matter.',
        monthlyPrice: 9.99,
        yearlyPrice: 99.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Recommended',
        popular: true,
        trialDays: 14,
        includes: 'Everything in Free, plus:',
        features: [
            '1,000 stories per view + one month of history',
            'Full source timelines for every story',
            'Coverage volume and credibility filters',
            'All map styles, 3D globe + weather, fire, and NASA overlays',
        ],
        cta: 'Try Pro free',
        priceKeyMonthly: 'pro_monthly',
        priceKeyYearly: 'pro_yearly',
    },
    {
        key: 'analyst',
        name: 'Analyst',
        tagline: 'For deeper research and investigation.',
        monthlyPrice: 29.99,
        yearlyPrice: 299.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: null,
        popular: false,
        trialDays: 14,
        includes: 'Everything in Pro, plus:',
        features: [
            'All retained history + custom time windows',
            'GeoJSON import and export',
            'Flight, ISS, air quality, and radiation overlays',
            'Advanced inspection modes + individual pins',
        ],
        cta: 'Try Analyst free',
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
