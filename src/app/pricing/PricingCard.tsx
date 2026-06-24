import React from 'react';
import styles from './PricingPage.module.css';
import { TierConfig } from './pricingConstants';

interface PricingCardProps {
    tier: TierConfig;
    isYearly: boolean;
    currentTier: string | null;
    loadingTier: string | null;
    angelRemaining: number | null;
    angelTotal: number;
    handleCheckout: (priceKey: string) => Promise<void>;
}

const formatPrice = (price: number) => {
    if (price === 0) return 'Free';
    return `$${price.toFixed(2)}`;
};

const getSavingsPercent = (monthly: number, yearly: number) => {
    if (monthly === 0) return 0;
    const monthlyAnnual = monthly * 12;
    return Math.round(((monthlyAnnual - yearly) / monthlyAnnual) * 100);
};

export function PricingCard({
    tier,
    isYearly,
    currentTier,
    loadingTier,
    angelRemaining,
    angelTotal,
    handleCheckout,
}: PricingCardProps) {
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
        : tier.key === 'pro' && isYearly ? 'Get Pro Yearly' : tier.cta;

    return (
        <div
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
                disabled={isFreeTier || isCurrentPlan || isLoading || (tier.key === 'angel' && angelRemaining === 0)}
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
}
