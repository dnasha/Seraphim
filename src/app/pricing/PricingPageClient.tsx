/**
 * Plan selection, signup, and the handoff to hosted Stripe Checkout.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { LuArrowRight, LuCheck, LuChevronDown, LuLockKeyhole, LuX } from 'react-icons/lu';
import { useAuth } from '@/hooks/useAuth';
import { useUserTier } from '@/hooks/useUserTier';
import PublicPageHeader from '@/components/ui/PublicPageHeader';
import styles from './PricingPage.module.css';
import { TIERS, COMPARISON_SECTIONS } from './pricingConstants';
import { PricingCard } from './PricingCard';
import { FaqSection } from './FaqSection';
import { trackOptionalMetric, type OptionalMetricDimensions } from '@/lib/privacyConsent';

const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false });
const SUBSCRIPTION_TIERS = TIERS.filter((tier) => !tier.isLifetime);
const ANGEL_TIER = TIERS.find((tier) => tier.key === 'angel');
type ComparisonTier = 'free' | 'pro' | 'analyst' | 'angel';

function checkoutMetricDimensions(priceKey: string): OptionalMetricDimensions {
    if (priceKey === 'angel') return { plan: 'angel', interval: 'lifetime' };
    const [plan, interval] = priceKey.split('_');
    if ((plan !== 'pro' && plan !== 'analyst') || (interval !== 'monthly' && interval !== 'yearly')) return {};
    return { plan, interval: interval === 'monthly' ? 'month' : 'year' };
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

function ComparisonValue({ value }: { value: string }) {
    if (value === '✓') return <LuCheck aria-label="Included" role="img" className={styles.comparisonCheck} />;
    if (value === '—') return <span aria-label="Not included" className={styles.comparisonDash}>—</span>;
    return <>{value}</>;
}

export interface PricingPageClientProps {
    returnTo: string;
    requestedFeature: string | null;
    recommendedTier: 'pro' | 'analyst' | null;
    cancelledCheckoutIntent: string | null;
    initialPriceKey?: string | null;
}

export function PricingPageClient({
    returnTo,
    requestedFeature,
    recommendedTier,
    cancelledCheckoutIntent,
    initialPriceKey = null,
}: PricingPageClientProps) {
    const initialTier = TIERS.find((tier) => initialPriceKey && (
        tier.priceKeyMonthly === initialPriceKey || tier.priceKeyYearly === initialPriceKey
    ));
    const [isYearly, setIsYearly] = useState(!initialPriceKey?.endsWith('_monthly'));
    const [selectedPriceKey, setSelectedPriceKey] = useState(initialPriceKey);
    const [mobileTier, setMobileTier] = useState(initialTier && !initialTier.isLifetime ? initialTier.key : recommendedTier ?? 'pro');
    const [loadingTier, setLoadingTier] = useState<string | null>(null);
    const [checkoutReturnCount, setCheckoutReturnCount] = useState(0);
    const checkoutInFlight = useRef(false);
    const [angelRemaining, setAngelRemaining] = useState<number | null>(null);
    const [angelTotal, setAngelTotal] = useState(100);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const { user, isGuest, isLoading: authLoading, showAuthModal, setShowAuthModal } = useAuth();
    const { tier: currentTier, isLoading: tierLoading } = useUserTier();
    const [comparisonTier, setComparisonTier] = useState<ComparisonTier>(recommendedTier ?? 'pro');
    const selectedTier = TIERS.find((tier) => selectedPriceKey && (
        tier.priceKeyMonthly === selectedPriceKey || tier.priceKeyYearly === selectedPriceKey
    ));
    const authReturnParams = new URLSearchParams({ returnTo });
    if (selectedPriceKey) authReturnParams.set('plan', selectedPriceKey);
    if (requestedFeature) authReturnParams.set('feature', requestedFeature);
    if (recommendedTier) authReturnParams.set('tier', recommendedTier);
    const authReturnTo = `/pricing?${authReturnParams.toString()}`;

    useEffect(() => {
        if (errorMsg) errorRef.current?.focus();
    }, [errorMsg]);

    useEffect(() => {
        const handlePageShow = (event: PageTransitionEvent) => {
            if (!event.persisted) return;
            // Browser Back can restore the page without mounting it again.
            checkoutInFlight.current = false;
            setLoadingTier(null);
            setCheckoutReturnCount((count) => count + 1);
        };
        window.addEventListener('pageshow', handlePageShow);
        return () => window.removeEventListener('pageshow', handlePageShow);
    }, []);

    useEffect(() => {
        void trackOptionalMetric('pricing_view', {
            source: requestedFeature ? 'feature_gate' : 'direct',
            plan: recommendedTier ?? undefined,
        });
    }, [recommendedTier, requestedFeature]);

    useEffect(() => {
        // Cancellation refreshes inventory after the old Session is released.
        if (cancelledCheckoutIntent || window.sessionStorage.getItem('seraphim.activeCheckoutIntent')) return;
        let active = true;
        void requestAngelAvailability().then((data) => {
            if (active && data) {
                setAngelRemaining(data.remaining);
                setAngelTotal(data.total);
            }
        });
        return () => { active = false; };
    }, [cancelledCheckoutIntent]);

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
            } catch {
                // The reservation also expires on the server if this request fails.
            } finally {
                const data = await requestAngelAvailability();
                if (active && data) {
                    setAngelRemaining(data.remaining);
                    setAngelTotal(data.total);
                }
            }
        })();
        return () => { active = false; };
    }, [cancelledCheckoutIntent, checkoutReturnCount, isGuest, user]);

    const handleCheckout = useCallback(async (priceKey: string) => {
        if (checkoutInFlight.current || authLoading || tierLoading) return;
        void trackOptionalMetric('checkout_click', {
            ...checkoutMetricDimensions(priceKey),
            source: requestedFeature ? 'feature_gate' : 'pricing',
        });
        setSelectedPriceKey(priceKey || null);
        setErrorMsg(null);
        if (!user || isGuest) {
            setShowAuthModal(true);
            return;
        }
        if (!priceKey) return;

        checkoutInFlight.current = true;
        setLoadingTier(priceKey);
        try {
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priceKey, returnTo }),
            });
            const data = await res.json() as { url?: string; intentId?: string; error?: string };

            if (res.ok && data.url) {
                if (data.intentId) window.sessionStorage.setItem('seraphim.activeCheckoutIntent', data.intentId);
                window.location.href = data.url;
                return; // Keep every checkout button disabled during navigation.
            }
            setErrorMsg(data.error || 'We couldn’t open checkout. Please try again.');
        } catch {
            setErrorMsg('We couldn’t connect to checkout. Check your connection and try again.');
        }
        checkoutInFlight.current = false;
        setLoadingTier(null);
    }, [user, isGuest, authLoading, tierLoading, setShowAuthModal, returnTo, requestedFeature]);

    function changeBilling(yearly: boolean) {
        setIsYearly(yearly);
        if (selectedTier && !selectedTier.isLifetime) {
            setSelectedPriceKey(yearly ? selectedTier.priceKeyYearly : selectedTier.priceKeyMonthly);
        }
    }

    return (
        <div className={styles.container}>
            <PublicPageHeader backHref={returnTo} backTitle="Return to the previous page" />
            <main className={styles.content}>
                <section className={styles.hero} aria-labelledby="pricing-title">
                    <span className={styles.eyebrow}>Plans & pricing</span>
                    <h1 id="pricing-title">Follow the world.<br className={styles.mobileBreak} /> See the bigger picture.</h1>
                    <p>Start free. Go deeper with more history, richer maps, and tools built for investigation.</p>
                    <div className={styles.trialAssurance}>
                        <span><LuCheck aria-hidden="true" /> Pro & Analyst: 14 days free</span>
                        <span><LuCheck aria-hidden="true" /> Cancel anytime</span>
                    </div>
                </section>

                {requestedFeature && recommendedTier && (
                    <div className={styles.contextualUpgrade}>
                        <LuCheck aria-hidden="true" />
                        <p><strong>{recommendedTier === 'pro' ? 'Pro' : 'Analyst'} unlocks {requestedFeature}.</strong> Try it free for 14 days.</p>
                    </div>
                )}

                {cancelledCheckoutIntent && !errorMsg && (
                    <p className={styles.returnNotice} role="status">Checkout wasn’t completed. Choose a plan whenever you’re ready.</p>
                )}

                {selectedTier && user && !isGuest && !errorMsg && !loadingTier && selectedTier.key !== currentTier && (
                    <p className={styles.returnNotice} role="status">Your {selectedTier.name} selection is saved. Review the details below, then continue.</p>
                )}

                <div className={styles.billingControls}>
                    <div className={styles.billingToggle} role="group" aria-label="Billing period">
                        <button type="button" title="Show monthly plan prices" aria-pressed={!isYearly} onClick={() => changeBilling(false)} disabled={loadingTier !== null}>Monthly</button>
                        <button type="button" title="Show yearly plan prices" aria-pressed={isYearly} onClick={() => changeBilling(true)} disabled={loadingTier !== null}>Yearly <span className={styles.saveBadge}>Save 17%</span></button>
                    </div>
                    <p>All prices in USD. {isYearly ? 'Yearly plans are billed annually.' : 'Monthly plans are billed each month.'}</p>
                </div>

                {errorMsg && (
                    <div className={styles.checkoutNotice} role="alert" ref={errorRef} tabIndex={-1}>
                        <div><strong>Checkout couldn’t be opened</strong><p>{errorMsg}</p></div>
                        <button type="button" aria-label="Dismiss checkout error" title="Dismiss checkout error" onClick={() => setErrorMsg(null)}><LuX aria-hidden="true" /></button>
                    </div>
                )}

                <div className={styles.mobilePlanPicker} role="group" aria-label="Choose a plan">
                    {SUBSCRIPTION_TIERS.map((tier) => (
                        <button key={tier.key} type="button" title={`Show ${tier.name} plan`} aria-pressed={mobileTier === tier.key} aria-controls="subscription-plans" disabled={loadingTier !== null} onClick={() => setMobileTier(tier.key)}>
                            {tier.name}
                        </button>
                    ))}
                </div>

                <div id="subscription-plans" className={styles.cardsGrid}>
                    {SUBSCRIPTION_TIERS.map((tier) => (
                        <PricingCard
                            key={tier.key}
                            tier={tier}
                            isYearly={isYearly}
                            currentTier={!user || isGuest ? 'guest' : currentTier}
                            loadingTier={loadingTier}
                            angelRemaining={angelRemaining}
                            angelTotal={angelTotal}
                            isRecommended={tier.key === (recommendedTier ?? 'pro')}
                            isMobileSelected={tier.key === mobileTier}
                            isAuthLoading={authLoading || tierLoading}
                            handleCheckout={handleCheckout}
                        />
                    ))}
                </div>

                <div className={styles.checkoutReassurance}>
                    <p><LuLockKeyhole aria-hidden="true" /> Secure checkout with <strong>Stripe</strong></p>
                    <span>Card details stay with Stripe. Applicable taxes are shown at checkout.</span>
                </div>

                <details className={styles.comparisonSection}>
                    <summary><span>Compare every feature</span><LuChevronDown aria-hidden="true" /></summary>
                    <div className={styles.comparisonContent}>
                        <div className={styles.comparisonMobilePicker}>
                            <label htmlFor="comparison-plan">Show features for</label>
                            <select id="comparison-plan" title="Choose a plan to compare features" value={comparisonTier} onChange={(event) => setComparisonTier(event.target.value as ComparisonTier)}>
                                {TIERS.map((tier) => <option key={tier.key} value={tier.key}>{tier.name}</option>)}
                            </select>
                        </div>
                        <div className={styles.comparisonMobileCards}>
                            {COMPARISON_SECTIONS.map((section) => (
                                <div key={section.label} className={styles.comparisonMobileGroup}>
                                    <h3>{section.label}</h3>
                                    <dl>
                                        {section.rows.map((row) => (
                                            <div key={row.feature}>
                                                <dt>{row.feature}</dt><dd><ComparisonValue value={row[comparisonTier]} /></dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ))}
                        </div>
                        <div className={styles.tableWrapper}>
                            <table className={styles.comparisonTable}>
                                <caption className={styles.srOnly}>Features included in each Seraphim plan</caption>
                                <thead><tr><th scope="col">Feature</th>{TIERS.map((tier) => <th key={tier.key} scope="col">{tier.name}</th>)}</tr></thead>
                                {COMPARISON_SECTIONS.map((section) => (
                                    <tbody key={section.label}>
                                        <tr className={styles.tableGroupRow}><th colSpan={5} scope="rowgroup">{section.label}</th></tr>
                                        {section.rows.map((row) => (
                                            <tr key={row.feature}>
                                                <th scope="row">{row.feature}</th>
                                                {(['free', 'pro', 'analyst', 'angel'] as const).map((tier) => (
                                                    <td key={tier}><ComparisonValue value={row[tier]} /></td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                ))}
                            </table>
                        </div>
                    </div>
                </details>

                {ANGEL_TIER && <PricingCard
                    tier={ANGEL_TIER}
                    isYearly={isYearly}
                    currentTier={!user || isGuest ? 'guest' : currentTier}
                    loadingTier={loadingTier}
                    angelRemaining={angelRemaining}
                    angelTotal={angelTotal}
                    isAuthLoading={authLoading || tierLoading}
                    handleCheckout={handleCheckout}
                />}

                <FaqSection />

                <div className={styles.explorePrompt}>
                    <p>Start with a little curiosity.</p>
                    <Link href="/" title="Explore the live map">Explore the live map <LuArrowRight aria-hidden="true" /></Link>
                </div>
                <footer className={styles.footer}>
                    <span>Seraphim · A clearer view of the world.</span>
                    <nav aria-label="Pricing page links"><Link href="/help" title="Get help">Help</Link><Link href="/terms" title="Read the Terms of Service">Terms</Link><Link href="/privacy" title="Read the Privacy Policy">Privacy</Link></nav>
                </footer>
            </main>
            {showAuthModal && <AuthModal
                returnTo={authReturnTo}
                initialTab="signup"
                subtitle={selectedTier ? `Create an account to continue with ${selectedTier.name}` : 'Create your free Seraphim account'}
            />}
        </div>
    );
}
