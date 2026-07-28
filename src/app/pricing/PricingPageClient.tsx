/**
 * Pricing Page
 *
 * Three subscription tiers plus a separate Angel founder offer,
 * Stripe Checkout integration, feature comparison, and FAQ content.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useUserTier } from '@/hooks/useUserTier';
import PublicPageHeader from '@/components/ui/PublicPageHeader';
import StateNotice from '@/components/ui/StateNotice';
import styles from './PricingPage.module.css';
import { TIERS, COMPARISON_SECTIONS } from './pricingConstants';
import { PricingCard } from './PricingCard';
import { FaqSection } from './FaqSection';
import { trackOptionalMetric, type OptionalMetricDimensions } from '@/lib/privacyConsent';

const SUBSCRIPTION_TIERS = TIERS.filter((tier) => tier.key !== 'angel');
const ANGEL_TIER = TIERS.find((tier) => tier.key === 'angel');

function checkoutMetricDimensions(priceKey: string): OptionalMetricDimensions {
    if (priceKey === 'angel') return { plan: 'angel' as const, interval: 'lifetime' as const };
    const [plan, interval] = priceKey.split('_');
    if ((plan !== 'pro' && plan !== 'analyst') || (interval !== 'monthly' && interval !== 'yearly')) return {};
    return {
        plan: plan as 'pro' | 'analyst',
        interval: interval === 'monthly' ? 'month' as const : 'year' as const,
    };
}

async function requestAngelAvailability() {
    try {
        const res = await fetch('/api/stripe/angel-count');
        if (!res.ok) return null;
        return await res.json() as { remaining: number; total: number };
    } catch {
        return null;
    }
}

export interface PricingPageClientProps {
    returnTo: string;
    requestedFeature: string | null;
    recommendedTier: 'pro' | 'analyst' | null;
    cancelledCheckoutIntent: string | null;
}

export function PricingPageClient({
    returnTo,
    requestedFeature,
    recommendedTier,
    cancelledCheckoutIntent,
}: PricingPageClientProps) {
    const [isYearly, setIsYearly] = useState(true); // Default to yearly for higher LTV
    const [loadingTier, setLoadingTier] = useState<string | null>(null);
    const [angelRemaining, setAngelRemaining] = useState<number | null>(null);
    const [angelTotal, setAngelTotal] = useState<number>(100);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const { user, isGuest } = useAuth();
    const { tier: currentTier } = useUserTier();
    const router = useRouter();
    const [comparisonTier, setComparisonTier] = useState<'free' | 'pro' | 'analyst' | 'angel'>(recommendedTier ?? 'pro');

    useEffect(() => {
        void trackOptionalMetric('pricing_view', {
            source: requestedFeature ? 'feature_gate' : 'direct',
            plan: recommendedTier ?? undefined,
        });
    }, [recommendedTier, requestedFeature]);

    useEffect(() => {
        // A returning Checkout cancellation refreshes availability after the
        // Session has been expired. Avoid racing that refresh with the normal
        // mount request and issuing the same inventory query twice.
        if (
            cancelledCheckoutIntent
            || window.sessionStorage.getItem('seraphim.activeCheckoutIntent')
        ) return;

        let active = true;
        void requestAngelAvailability().then((data) => {
            if (active && data) {
                setAngelRemaining(data.remaining);
                setAngelTotal(data.total);
            }
        });
        return () => { active = false; };
    }, [cancelledCheckoutIntent]);

    // Release the specific Session when Stripe's cancel link or browser Back
    // returns the customer to pricing, then refresh the reserved Angel count.
    useEffect(() => {
        if (!user || isGuest) return;
        const storedIntent = window.sessionStorage.getItem('seraphim.activeCheckoutIntent');
        const intentId = cancelledCheckoutIntent ?? storedIntent;
        if (!intentId) return;

        window.sessionStorage.removeItem('seraphim.activeCheckoutIntent');
        let active = true;
        void (async () => {
            try {
                await fetch('/api/stripe/checkout/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ intentId }),
                });
            } finally {
                const data = await requestAngelAvailability();
                if (active && data) {
                    setAngelRemaining(data.remaining);
                    setAngelTotal(data.total);
                }
            }
        })();
        return () => { active = false; };
    }, [cancelledCheckoutIntent, isGuest, user]);

    const handleCheckout = useCallback(async (priceKey: string) => {
        void trackOptionalMetric('checkout_click', {
            ...checkoutMetricDimensions(priceKey),
            source: requestedFeature ? 'feature_gate' : 'pricing',
        });
        if (!user || isGuest) {
            // Redirect to home which will show auth modal
            router.push('/?auth=true');
            return;
        }

        if (!priceKey) return;

        setLoadingTier(priceKey);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priceKey, returnTo }),
            });

            const data = await res.json() as { url?: string; intentId?: string; error?: string };

            if (data.url) {
                if (data.intentId) {
                    window.sessionStorage.setItem('seraphim.activeCheckoutIntent', data.intentId);
                }
                window.location.href = data.url;
            } else {
                setErrorMsg(data.error || 'Failed to start checkout');
            }
        } catch {
            setErrorMsg('Network error. Please try again.');
        } finally {
            setLoadingTier(null);
        }
    }, [user, isGuest, router, returnTo, requestedFeature]);

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <PublicPageHeader backHref={returnTo} backTitle="Return to the previous page" />

                {/* Hero */}
                <section className={styles.hero}>
                    <h2 className={styles.heroTitle}>See more of the global signal</h2>
                    <p className={styles.heroSubtitle}>
                        Start with a useful free command center, then unlock monitoring depth and investigation tools when the signal demands it.
                    </p>
                </section>

                <section className={styles.guestPreview}>
                    <span className={styles.guestPreviewEyebrow}>Try before signing up</span>
                    <p><strong>Guest mode</strong> lets anyone explore the live map and its top 10 stories from the last 24 hours. Create a Free account for 50 stories per view, filtering, and local annotations.</p>
                </section>

                {requestedFeature && recommendedTier && (
                    <section className={styles.contextualUpgrade} aria-live="polite">
                        <span>Unlock {requestedFeature}</span>
                        <strong>{recommendedTier === 'pro' ? 'Pro' : 'Analyst'} includes this capability and a 14-day free trial.</strong>
                    </section>
                )}

                {/* Error Toast */}
                {errorMsg && (
                    <StateNotice
                        placement="floating"
                        variant="error"
                        title="Checkout unavailable"
                        message={errorMsg}
                        onDismiss={() => setErrorMsg(null)}
                        dismissLabel="Dismiss checkout error"
                    />
                )}

                {/* Billing Toggle */}
                <div className={styles.toggleContainer}>
                    <span className={`${styles.toggleLabel} ${!isYearly ? styles.toggleLabelActive : ''}`}>Monthly</span>
                    <button
                        className={`${styles.toggleTrack} ${isYearly ? styles.toggleTrackActive : ''}`}
                        onClick={() => setIsYearly(!isYearly)}
                        aria-label="Toggle billing period"
                        title={`Switch to ${isYearly ? 'monthly' : 'yearly'} billing`}
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
                    {SUBSCRIPTION_TIERS.map((tier) => (
                        <PricingCard
                            key={tier.key}
                            tier={tier}
                            isYearly={isYearly}
                            currentTier={currentTier}
                            loadingTier={loadingTier}
                            angelRemaining={angelRemaining}
                            angelTotal={angelTotal}
                            isRecommended={tier.key === recommendedTier}
                            handleCheckout={handleCheckout}
                        />
                    ))}
                </div>

                {ANGEL_TIER && (
                    <section className={styles.angelOfferSection}>
                        <div className={styles.angelOfferCopy}>
                            <span className={styles.guestPreviewEyebrow}>Founder offer</span>
                            <h2>Back Seraphim for the long term</h2>
                            <p>
                                One payment unlocks the complete Analyst experience for the lifetime of the service. Limited to 100 founding memberships.{' '}
                                <a href="/terms" title="Read Angel refund and lifetime terms">Refund and lifetime terms</a> apply.
                            </p>
                        </div>
                        <div className={styles.angelOfferCard}>
                            <PricingCard
                                tier={ANGEL_TIER}
                                isYearly={isYearly}
                                currentTier={currentTier}
                                loadingTier={loadingTier}
                                angelRemaining={angelRemaining}
                                angelTotal={angelTotal}
                                handleCheckout={handleCheckout}
                            />
                        </div>
                    </section>
                )}

                {/* Feature Comparison Table */}
                <section className={styles.comparisonSection}>
                    <h2 className={styles.comparisonTitle}>Choose the depth you need</h2>
                    <div className={styles.comparisonMobilePicker} role="tablist" aria-label="Compare plan features">
                        {(['free', 'pro', 'analyst', 'angel'] as const).map((tier) => (
                            <button
                                key={tier}
                                role="tab"
                                aria-selected={comparisonTier === tier}
                                className={comparisonTier === tier ? styles.comparisonMobilePickerActive : ''}
                                onClick={() => setComparisonTier(tier)}
                                title={`Compare ${tier === 'free' ? 'Free' : tier[0].toUpperCase() + tier.slice(1)} plan features`}
                            >
                                {tier === 'free' ? 'Free' : tier[0].toUpperCase() + tier.slice(1)}
                            </button>
                        ))}
                    </div>
                    <div className={styles.comparisonMobileCards}>
                        {COMPARISON_SECTIONS.map((section) => (
                            <div key={section.label} className={styles.comparisonMobileGroup}>
                                <h3>{section.label}</h3>
                                {section.rows.map((row) => (
                                    <div key={row.feature} className={styles.comparisonMobileRow}>
                                        <span>{row.feature}</span><strong>{row[comparisonTier]}</strong>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
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
                                {COMPARISON_SECTIONS.flatMap((section) => [
                                    <tr key={section.label} className={styles.tableGroupRow}>
                                        <th colSpan={5}>{section.label}</th>
                                    </tr>,
                                    ...section.rows.map((row) => (
                                        <tr key={row.feature}>
                                            <td className={styles.tdFeature}>{row.feature}</td>
                                            <td className={styles.tdValue}>{row.free}</td>
                                            <td className={`${styles.tdValue} ${styles.tdPopular}`}>{row.pro}</td>
                                            <td className={styles.tdValue}>{row.analyst}</td>
                                            <td className={`${styles.tdValue} ${styles.tdAngel}`}>{row.angel}</td>
                                        </tr>
                                    )),
                                ])}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* FAQ */}
                <FaqSection />

                <footer className={styles.footer}>
                    <p>Secure checkout powered by <strong>Stripe</strong>. Seraphim never stores your card details.</p>
                </footer>
            </div>
        </div>
    );
}
