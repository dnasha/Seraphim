/**
 * Pricing Page
 * 
 * Conversion-optimized pricing page with monthly/yearly toggle, 4-tier comparison,
 * feature matrix, and FAQ section. Uses Stripe Checkout Sessions for payment.
 * 
 * Marketing psychology applied: anchoring, urgency (Angel scarcity),
 * loss aversion (savings badges), default yearly selection (higher LTV).
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
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
        tagline: 'Explore the global intelligence feed',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: false,
        lifetimePrice: 0,
        badge: null,
        popular: false,
        trialDays: 0,
        features: [
            'Live event map (100 pins)',
            'Hot & New sort modes',
            'Light & Dark themes',
            'Basic event details',
        ],
        excluded: [
            'Source & category filters',
            'Time range controls',
            'Search',
            'Bookmarks',
            'Live overlays',
            'Map style themes',
            '3D Globe mode',
        ],
        cta: 'Current Plan',
        priceKeyMonthly: '',
        priceKeyYearly: '',
    },
    {
        key: 'pro',
        name: 'Pro',
        tagline: 'Full OSINT toolkit for power users',
        monthlyPrice: 9.99,
        yearlyPrice: 99.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'Most Popular',
        popular: true,
        trialDays: 7,
        features: [
            'Unlimited event pins',
            'Source & category filters',
            'Time range controls',
            'Full-text search',
            'Up to 50 bookmarks',
            'Live overlays (USGS, NOAA, NASA)',
            'All map style themes',
            '3D Globe mode',
            'Sort by Hot & New',
            '7-day free trial',
        ],
        excluded: [
            'Geofence alerts',
            'API access',
            'Custom intel reports',
            'Priority support',
        ],
        cta: 'Start Free Trial',
        priceKeyMonthly: 'pro_monthly',
        priceKeyYearly: 'pro_yearly',
    },
    {
        key: 'analyst',
        name: 'Analyst',
        tagline: 'Professional intelligence & analytics',
        monthlyPrice: 29.99,
        yearlyPrice: 299.99,
        isLifetime: false,
        lifetimePrice: 0,
        badge: 'For Teams',
        popular: false,
        trialDays: 0,
        features: [
            'Everything in Pro',
            'Unlimited bookmarks',
            'Geofence alerts',
            'API access',
            'Custom intel reports',
            'Priority support',
            'Advanced analytics',
            'Data export (CSV/JSON)',
        ],
        excluded: [
            'Founder badge',
            'Lifetime access',
        ],
        cta: 'Get Analyst',
        priceKeyMonthly: 'analyst_monthly',
        priceKeyYearly: 'analyst_yearly',
    },
    {
        key: 'angel',
        name: 'Angel',
        tagline: 'Lifetime access. Founding supporter.',
        monthlyPrice: 0,
        yearlyPrice: 0,
        isLifetime: true,
        lifetimePrice: 299,
        badge: 'Limited Edition',
        popular: false,
        trialDays: 0,
        features: [
            'Everything in Analyst',
            'Lifetime access — pay once',
            'Exclusive Founder badge',
            'Early access to new features',
            'Direct line to the team',
            'Name in the credits',
        ],
        excluded: [],
        cta: 'Become an Angel',
        priceKeyMonthly: 'angel',
        priceKeyYearly: 'angel',
    },
];

const COMPARISON_ROWS = [
    { feature: 'Live Event Map', free: '100 pins', pro: 'Unlimited', analyst: 'Unlimited', angel: 'Unlimited' },
    { feature: 'Source Filters', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Category Filters', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Time Range Controls', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Full-text Search', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Sort Modes (Hot/New)', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Bookmarks', free: '—', pro: '50', analyst: 'Unlimited', angel: 'Unlimited' },
    { feature: 'Live Overlays (USGS/NOAA/NASA)', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Map Style Themes', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: '3D Globe Mode', free: '—', pro: '✓', analyst: '✓', angel: '✓' },
    { feature: 'Geofence Alerts', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    { feature: 'API Access', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    { feature: 'Custom Intel Reports', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    { feature: 'Data Export', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    { feature: 'Priority Support', free: '—', pro: '—', analyst: '✓', angel: '✓' },
    { feature: 'Founder Badge', free: '—', pro: '—', analyst: '—', angel: '✓' },
    { feature: 'Lifetime Access', free: '—', pro: '—', analyst: '—', angel: '✓' },
];

export default function PricingPage() {
    const [isYearly, setIsYearly] = useState(true); // Default to yearly for higher LTV
    const [loadingTier, setLoadingTier] = useState<string | null>(null);
    const [angelRemaining, setAngelRemaining] = useState<number | null>(null);
    const { user, isGuest } = useAuth();
    const router = useRouter();

    // Fetch angel remaining count
    useEffect(() => {
        async function fetchAngelCount() {
            try {
                const res = await fetch('/api/stripe/angel-count');
                if (res.ok) {
                    const data = await res.json() as { remaining: number };
                    setAngelRemaining(data.remaining);
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
                alert(data.error || 'Failed to start checkout');
            }
        } catch {
            alert('Network error. Please try again.');
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
                    <h2 className={styles.heroTitle}>Intelligence at every level</h2>
                    <p className={styles.heroSubtitle}>
                        Choose the plan that matches your mission. Upgrade, downgrade, or cancel anytime.
                    </p>
                </section>

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
                        const isLoading = loadingTier === priceKey;

                        return (
                            <div
                                key={tier.key}
                                className={`${styles.card} ${tier.popular ? styles.cardPopular : ''} ${tier.key === 'angel' ? styles.cardAngel : ''}`}
                            >
                                {tier.badge && (
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
                                    <div className={styles.scarcityBadge}>
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
                                        </svg>
                                        Only {angelRemaining} of 100 remaining
                                    </div>
                                )}

                                {tier.trialDays > 0 && (
                                    <div className={styles.trialBadge}>
                                        {tier.trialDays}-day free trial · Cancel anytime
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
                                    className={`${styles.ctaBtn} ${tier.popular ? styles.ctaBtnPopular : ''} ${tier.key === 'angel' ? styles.ctaBtnAngel : ''} ${isFreeTier ? styles.ctaBtnFree : ''}`}
                                    disabled={isFreeTier || isLoading}
                                    onClick={() => handleCheckout(priceKey)}
                                >
                                    {isLoading ? (
                                        <span className={styles.spinner} />
                                    ) : (
                                        tier.cta
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
                            <p>Pro monthly includes a 7-day free trial. Your card won&apos;t be charged until the trial ends. Cancel anytime before to avoid charges.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Can I switch plans?</h3>
                            <p>Yes! You can upgrade, downgrade, or cancel anytime from your account settings. Changes take effect at the next billing cycle.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>What happens when I cancel?</h3>
                            <p>You&apos;ll retain access until the end of your current billing period, then your account reverts to the Free tier.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Is the Angel tier really lifetime?</h3>
                            <p>Yes. Angel is a one-time payment for permanent access to all features. Only 100 will ever be sold — once they&apos;re gone, they&apos;re gone.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>What payment methods are accepted?</h3>
                            <p>We accept all major credit cards, debit cards, and select local payment methods through Stripe&apos;s secure payment infrastructure.</p>
                        </div>
                        <div className={styles.faqItem}>
                            <h3>Is my payment information secure?</h3>
                            <p>Absolutely. All payments are processed by Stripe, a PCI Level 1 certified payment processor. We never store your card details.</p>
                        </div>
                    </div>
                </section>

                <footer className={styles.footer}>
                    <p>Secured by <strong>Stripe</strong> · PCI Level 1 Certified · 256-bit SSL Encryption</p>
                </footer>
            </div>
        </div>
    );
}
