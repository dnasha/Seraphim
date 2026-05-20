/**
 * Pricing Page
 *
 * Four-tier pricing page with monthly and yearly billing options,
 * Stripe Checkout integration, feature comparison, and FAQ content.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useUserTier } from '@/hooks/useUserTier';
import ThemeToggle from '@/components/ui/ThemeToggle';
import styles from './PricingPage.module.css';

interface TierConfig {
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

const TIERS: TierConfig[] = [
    {
        key: 'free',
        name: 'Free',
        tagline: 'Full toolkit with a 100 story cap',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: false,
        lifetimePrice: 0,
        badge: null,
        popular: false,
        trialDays: 0,
        features: [
            'Up to 100 stories per refresh',
            'Search, source filters, and category filters',
            'Time range controls with custom dates',
            'Hot and New sorting',
            'Live overlays: USGS, NOAA, NASA EONET',
            'Map styles, 3D globe, and draw tools',
            'Import and export GeoJSON annotations',
        ],
        excluded: [
            'Unlimited story volume',
        ],
        cta: 'Included',
        priceKeyMonthly: '',
        priceKeyYearly: '',
    },
    {
        key: 'pro',
        name: 'Pro',
        tagline: 'Premium features details coming soon',
        monthlyPrice: 9.99,
        yearlyPrice: 99.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Most Popular',
        popular: true,
        trialDays: 7,
        features: [
            'Pro tier features coming soon',
            'Subscription options coming soon',
            'Verification badge coming soon',
        ],
        excluded: [
            'Lifetime billing',
        ],
        cta: 'Coming Soon',
        priceKeyMonthly: 'pro_monthly',
        priceKeyYearly: 'pro_yearly',
    },
    {
        key: 'analyst',
        name: 'Analyst',
        tagline: 'Analyst features details coming soon',
        monthlyPrice: 29.99,
        yearlyPrice: 299.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Power User',
        popular: false,
        trialDays: 0,
        features: [
            'Analyst tier features coming soon',
            'Everything in Pro (Coming Soon)',
            'Analytical tools coming soon',
        ],
        excluded: [
            'Lifetime billing',
        ],
        cta: 'Coming Soon',
        priceKeyMonthly: 'analyst_monthly',
        priceKeyYearly: 'analyst_yearly',
    },
    {
        key: 'angel',
        name: 'Angel',
        tagline: 'Angel tier features details coming soon',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: true,
        lifetimePrice: 299,
        badge: 'Limited 100',
        popular: false,
        trialDays: 0,
        features: [
            'Angel tier features coming soon',
            'Lifetime membership options coming soon',
            'Founder rewards coming soon',
        ],
        excluded: [],
        cta: 'Coming Soon',
        priceKeyMonthly: 'angel',
        priceKeyYearly: 'angel',
    },
];

const COMPARISON_ROWS = [
    { feature: 'Story volume (map and sidebar)', free: '100 per refresh', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Search and filters', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Time range controls', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Map styles and 3D globe', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Live overlays (USGS, NOAA, NASA)', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Draw, measure, and text annotations', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'GeoJSON import and export', free: 'Included', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Tier badge in app', free: 'Free', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Billing model', free: 'Free', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Trial availability', free: 'No', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Manage billing in account', free: 'No', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
    { feature: 'Lifetime access', free: 'No', pro: 'Coming Soon', analyst: 'Coming Soon', angel: 'Coming Soon' },
];

export default function PricingPage() {
    const [isYearly, setIsYearly] = useState(true); // Default to yearly for higher LTV
    const [loadingTier, setLoadingTier] = useState<string | null>(null);
    const [angelRemaining, setAngelRemaining] = useState<number | null>(null);
    const [angelTotal, setAngelTotal] = useState<number>(100);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const { user, isGuest } = useAuth();
    const { tier: currentTier } = useUserTier();
    const router = useRouter();

    // Redirect to homepage since pricing/checkout is disabled for demo
    useEffect(() => {
        router.replace('/');
    }, [router]);

    // Fetch angel remaining count
    useEffect(() => {
        async function fetchAngelCount() {
            try {
                const res = await fetch('/api/stripe/angel-count');
                if (res.ok) {
                    const data = await res.json() as { remaining: number; total: number };
                    setAngelRemaining(data.remaining);
                    setAngelTotal(data.total);
                }
            } catch {
                // Non-critical, default to showing nothing
            }
        }
        fetchAngelCount();
    }, []);

    const handleCheckout = useCallback(async (priceKey: string) => {
        if (!user || isGuest) {
            // Redirect to home which will show auth modal
            router.push('/?auth=signup');
            return;
        }

        if (!priceKey) return;

        setLoadingTier(priceKey);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priceKey }),
            });

            const data = await res.json() as { url?: string; error?: string };

            if (data.url) {
                window.location.href = data.url;
            } else {
                setErrorMsg(data.error || 'Failed to start checkout');
            }
        } catch {
            setErrorMsg('Network error. Please try again.');
        } finally {
            setLoadingTier(null);
        }
    }, [user, isGuest, router]);

    const formatPrice = (price: number) => {
        if (price === 0) return 'Free';
        return `$${price.toFixed(2)}`;
    };

    const getSavingsPercent = (monthly: number, yearly: number) => {
        if (monthly === 0) return 0;
        const monthlyAnnual = monthly * 12;
        return Math.round(((monthlyAnnual - yearly) / monthlyAnnual) * 100);
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                {/* Header */}
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <button onClick={() => router.push('/')} className={styles.backBtn} aria-label="Go back">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="19" y1="12" x2="5" y2="12"></line>
                                <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                        </button>
                    </div>
                    <div className={styles.headerCenter}>
                        <svg
                            width="200"
                            height="200"
                            viewBox="0 0 200 200"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ height: '2.5rem', width: 'auto' }}
                        >
                            <path
                                className={styles.logoFill}
                                d="M100 110.528L125 83.5281H75L100 110.528Z"
                            />
                            <path
                                className={styles.logoStroke}
                                d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                                strokeWidth="12"
                            />
                            <path
                                className={styles.logoStroke}
                                d="M100 110.528L125 83.5281H75L100 110.528Z"
                                strokeWidth="12"
                            />
                        </svg>
                        <h1 className={styles.logoTitle}>Seraphim</h1>
                    </div>
                    <div className={styles.headerRight}>
                        <ThemeToggle />
                    </div>
                </header>

                {/* Hero */}
                <section className={styles.hero}>
                    <h2 className={styles.heroTitle}>See more of the global signal</h2>
                    <p className={styles.heroSubtitle}>
                        Free includes the full toolkit with a 100 story cap. Paid plans remove the cap and include subscription management.
                    </p>
                </section>

                {/* Error Toast */}
                {errorMsg && (
                    <div
                        style={{
                            position: 'fixed',
                            bottom: '24px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#ef4444',
                            color: '#fff',
                            padding: '12px 24px',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            zIndex: 1000,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            boxShadow: '0 8px 32px rgba(239, 68, 68, 0.35)',
                            animation: 'fadeIn 0.2s ease-out',
                        }}
                    >
                        {errorMsg}
                        <button
                            onClick={() => setErrorMsg(null)}
                            style={{
                                background: 'rgba(255,255,255,0.2)',
                                border: 'none',
                                color: '#fff',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Billing Toggle */}
                <div className={styles.toggleContainer}>
                    <span className={`${styles.toggleLabel} ${!isYearly ? styles.toggleLabelActive : ''}`}>Monthly</span>
                    <button
                        className={`${styles.toggleTrack} ${isYearly ? styles.toggleTrackActive : ''}`}
                        onClick={() => setIsYearly(!isYearly)}
                        aria-label="Toggle billing period"
                    >
                        <div className={styles.toggleThumb} />
                    </button>
                    <span className={`${styles.toggleLabel} ${isYearly ? styles.toggleLabelActive : ''}`}>
                        Yearly
                        <span className={styles.saveBadge}>Save 17%</span>
                    </span>
                </div>

                {/* Pricing Cards */}
                <div className={styles.cardsGrid}>
                    {TIERS.map((tier) => {
                        const price = tier.isLifetime
                            ? tier.lifetimePrice
                            : isYearly
                                ? tier.yearlyPrice
                                : tier.monthlyPrice;
                        const savings = tier.isLifetime
                            ? null
                            : getSavingsPercent(tier.monthlyPrice, tier.yearlyPrice);
                        const priceKey = tier.isLifetime
                            ? tier.priceKeyMonthly
                            : isYearly
                                ? tier.priceKeyYearly
                                : tier.priceKeyMonthly;
                        const isFreeTier = tier.key === 'free';
                        const isCurrentPlan = tier.key === currentTier;
                        const isLoading = loadingTier === priceKey;
                        const ctaText = isCurrentPlan
                            ? 'Current Plan'
                            : isFreeTier
                                ? 'Included'
                                : 'Coming Soon';

                        return (
                            <div
                                key={tier.key}
                                className={`${styles.card} ${tier.popular ? styles.cardPopular : ''} ${tier.key === 'angel' ? styles.cardAngel : ''} ${isCurrentPlan ? styles.cardCurrent : ''}`}
                            >
                                {isCurrentPlan ? (
                                    <div className={`${styles.cardBadge} ${styles.cardBadgeCurrent}`}>
                                        Current Plan
                                    </div>
                                ) : tier.badge && (
                                    <div className={`${styles.cardBadge} ${tier.popular ? styles.cardBadgePopular : ''} ${tier.key === 'angel' ? styles.cardBadgeAngel : ''}`}>
                                        {tier.badge}
                                    </div>
                                )}

                                <div className={styles.cardHeader}>
                                    <h3 className={styles.cardName}>{tier.name}</h3>
                                    <p className={styles.cardTagline}>{tier.tagline}</p>
                                </div>

                                <div className={styles.cardPricing}>
                                    {tier.isLifetime ? (
                                        <>
                                            <span className={styles.priceAmount}>${tier.lifetimePrice}</span>
                                            <span className={styles.pricePeriod}>one-time</span>
                                        </>
                                    ) : price === 0 ? (
                                        <>
                                            <span className={styles.priceAmount}>$0</span>
                                            <span className={styles.pricePeriod}>forever</span>
                                        </>
                                    ) : (
                                        <>
                                            {isYearly && tier.monthlyPrice > 0 && (
                                                <span className={styles.priceOriginal}>
                                                    ${(tier.monthlyPrice * 12).toFixed(2)}/yr
                                                </span>
                                            )}
                                            <span className={styles.priceAmount}>{formatPrice(price)}</span>
                                            <span className={styles.pricePeriod}>
                                                /{isYearly ? 'year' : 'month'}
                                            </span>
                                            {isYearly && savings && savings > 0 && (
                                                <span className={styles.priceSavings}>Save {savings}%</span>
                                            )}
                                        </>
                                    )}
                                </div>

                                {tier.key === 'angel' && angelRemaining !== null && (
                                    <div className={styles.scarcityBadge} style={angelRemaining === 0 ? { color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
                                        </svg>
                                        {angelRemaining === 0
                                            ? 'Sold out'
                                            : `Only ${angelRemaining} of ${angelTotal} remaining`
                                        }
                                    </div>
                                )}

                                {tier.trialDays > 0 && !isYearly && (
                                    <div className={styles.trialBadge}>
                                        {tier.trialDays} day free trial. Cancel anytime.
                                    </div>
                                )}

                                <ul className={styles.featureList}>
                                    {tier.features.map((f) => (
                                        <li key={f} className={styles.featureItem}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                            {f}
                                        </li>
                                    ))}
                                    {tier.excluded.map((f) => (
                                        <li key={f} className={`${styles.featureItem} ${styles.featureExcluded}`}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    className={`${styles.ctaBtn} ${tier.popular && !isCurrentPlan ? styles.ctaBtnPopular : ''} ${tier.key === 'angel' && !isCurrentPlan ? styles.ctaBtnAngel : ''} ${isFreeTier || isCurrentPlan ? styles.ctaBtnFree : ''}`}
                                    disabled={isCurrentPlan || !isFreeTier || isLoading}
                                    onClick={() => handleCheckout(priceKey)}
                                >
                                    {isLoading ? (
                                        <span className={styles.spinner} />
                                    ) : (tier.key === 'angel' && angelRemaining === 0 && !isCurrentPlan) ? (
                                        'Sold Out'
                                    ) : (
                                        ctaText
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Feature Comparison Table */}
                <section className={styles.comparisonSection}>
                    <h2 className={styles.comparisonTitle}>Full Feature Comparison</h2>
                    <div className={styles.tableWrapper}>
                        <table className={styles.comparisonTable}>
                            <thead>
                                <tr>
                                    <th className={styles.thFeature}>Feature</th>
                                    <th>Free</th>
                                    <th className={styles.thPopular}>Pro</th>
                                    <th>Analyst</th>
                                    <th className={styles.thAngel}>Angel</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_ROWS.map((row) => (
                                    <tr key={row.feature}>
                                        <td className={styles.tdFeature}>{row.feature}</td>
                                        <td className={styles.tdValue}>{row.free}</td>
                                        <td className={`${styles.tdValue} ${styles.tdPopular}`}>{row.pro}</td>
                                        <td className={styles.tdValue}>{row.analyst}</td>
                                        <td className={`${styles.tdValue} ${styles.tdAngel}`}>{row.angel}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* FAQ */}
                <section className={styles.faqSection}>
                    <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
                    <div className={styles.faqGrid}>
                        <div className={styles.faqItem}>
                            <h3>How does the free trial work?</h3>
                            <p>The Pro monthly plan includes a 7 day trial. You are charged only after the trial ends, and you can cancel before then.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>What is the core difference between Free and paid?</h3>
                            <p>Free is capped at 100 stories per refresh. Pro, Analyst, and Angel remove that cap so you can monitor the full stream.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Can I switch plans?</h3>
                            <p>Yes. You can upgrade, downgrade, or cancel from your account settings. Changes apply on your next billing cycle.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>What happens when I cancel?</h3>
                            <p>You keep access until the end of your current period, then your account returns to the Free tier.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Is the Angel tier really lifetime?</h3>
                            <p>Yes. Angel is a one time payment for lifetime access. Only 100 Angel memberships are available.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Where do I manage billing?</h3>
                            <p>Pro and Analyst subscriptions include a Manage Billing button in your account page for plan changes and cancellation.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>What payment methods are accepted?</h3>
                            <p>Stripe supports major credit cards, debit cards, and supported local payment methods.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Is my payment information secure?</h3>
                            <p>Yes. Payments are processed by Stripe, a PCI Level 1 certified provider, and card details are not stored by Seraphim.</p>
                        </div>
                    </div>
                </section>

                <footer className={styles.footer}>
                    <p>Payments are secured by <strong>Stripe</strong>, PCI Level 1 certified, with 256 bit SSL encryption.</p>
                </footer>
            </div>
        </div>
    );
}
