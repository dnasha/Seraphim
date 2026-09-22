import Link from 'next/link';
import { LuArrowRight, LuCheck, LuSparkles } from 'react-icons/lu';
import styles from './PricingPage.module.css';
import { TierConfig } from './pricingConstants';
import tierStyles from '@/components/ui/TierBadge.module.css';

interface PricingCardProps {
    tier: TierConfig;
    isYearly: boolean;
    currentTier: string | null;
    loadingTier: string | null;
    angelRemaining: number | null;
    angelTotal: number;
    isRecommended?: boolean;
    isMobileSelected?: boolean;
    isAuthLoading?: boolean;
    handleCheckout: (priceKey: string) => Promise<void>;
}

const formatPrice = (price: number) => `$${price.toFixed(2)}`;

export function PricingCard({
    tier,
    isYearly,
    currentTier,
    loadingTier,
    angelRemaining,
    angelTotal,
    isRecommended = false,
    isMobileSelected = true,
    isAuthLoading = false,
    handleCheckout,
}: PricingCardProps) {
    const priceKey = tier.isLifetime || !isYearly ? tier.priceKeyMonthly : tier.priceKeyYearly;
    const isFree = tier.key === 'free';
    const isCurrent = tier.key === currentTier;
    const isLoading = loadingTier === priceKey;
    const isSoldOut = tier.isLifetime && angelRemaining === 0;
    const hasSubscription = currentTier === 'pro' || currentTier === 'analyst';
    const isIncluded = currentTier === 'angel' || (isFree && hasSubscription);
    const canManage = !tier.isLifetime && !isFree && hasSubscription;
    const isDisabled = isAuthLoading || loadingTier !== null || isCurrent || isIncluded || isSoldOut;
    const price = isYearly ? tier.yearlyPrice / 12 : tier.monthlyPrice;
    const buttonText = isCurrent ? 'Current plan'
        : isIncluded ? 'Included in your plan'
            : isSoldOut ? 'Sold out'
                : isFree ? 'Create free account' : tier.cta;
    const billingDescription = isFree ? 'Free forever. No card needed.'
        : tier.isLifetime ? 'One payment. No recurring bills.'
            : isYearly ? `${formatPrice(tier.yearlyPrice)} billed yearly after your trial`
                : `${formatPrice(tier.monthlyPrice)} billed monthly after your trial`;

    const action = canManage ? (
        <Link href="/account" className={styles.ctaBtn} title={isCurrent ? 'Manage your current plan' : `Switch to ${tier.name} from your account`}>
            {isCurrent ? 'Manage plan' : `Switch to ${tier.name}`} <LuArrowRight aria-hidden="true" />
        </Link>
    ) : (
        <button
            type="button"
            className={`${styles.ctaBtn} ${isRecommended && !isCurrent ? styles.ctaBtnPrimary : ''} ${tier.isLifetime ? styles.ctaBtnAngel : ''}`}
            disabled={isDisabled}
            aria-busy={isLoading}
            aria-describedby={`${tier.key}-billing ${tier.key}-terms`}
            title={isLoading ? 'Opening checkout' : buttonText}
            onClick={() => handleCheckout(priceKey)}
        >
            {isLoading ? <><span className={styles.spinner} aria-hidden="true" /> Opening checkout…</> : <>
                {buttonText}
                {!isDisabled && <LuArrowRight aria-hidden="true" />}
            </>}
        </button>
    );

    if (tier.isLifetime) {
        return (
            <article className={`${styles.founderOffer} ${tierStyles.tier}`} data-tier="angel" aria-labelledby="angel-name">
                <div className={styles.founderCopy}>
                    <span className={styles.eyebrow}><LuSparkles aria-hidden="true" /> Angel founder membership</span>
                    <h2 id="angel-name">Prefer to pay once?</h2>
                    <p>Every Analyst feature for the lifetime of Seraphim, plus a Founder badge and a manually assigned Discord role.</p>
                    <p id="angel-terms" className={styles.founderTerms}>Access lasts for the operational lifetime of the service. <Link href="/terms" title="Read refund and lifetime terms">Refund and lifetime terms</Link> apply.</p>
                </div>
                <div className={styles.founderAction}>
                    <div className={styles.priceLine}><span className={styles.priceAmount}>${tier.lifetimePrice}</span><span className={styles.pricePeriod}>one-time</span></div>
                    <p id="angel-billing" className={styles.billingNote}>{billingDescription}</p>
                    {action}
                    <p className={styles.actionNote}>
                        {isCurrent ? 'Your lifetime membership is active'
                            : isSoldOut ? 'All founder memberships have been claimed'
                                : angelRemaining === null ? `Limited to ${angelTotal} memberships`
                                    : `${angelRemaining} of ${angelTotal} memberships available`}
                    </p>
                </div>
            </article>
        );
    }

    return (
        <article
            className={`${styles.card} ${tierStyles.tier} ${isRecommended ? styles.cardRecommended : ''}`}
            data-tier={tier.key}
            data-mobile-selected={isMobileSelected}
            aria-labelledby={`${tier.key}-name`}
        >
            <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                    <h2 id={`${tier.key}-name`} className={styles.cardName}>{tier.name}</h2>
                    {isCurrent ? <span className={styles.currentBadge}>Your plan</span>
                        : isRecommended && <span className={styles.recommendedBadge}>Recommended</span>}
                </div>
                <p className={styles.cardTagline}>{tier.tagline}</p>
            </div>

            <div className={styles.cardPricing}>
                <div className={styles.priceLine}>
                    <span className={styles.priceAmount}>{isFree ? '$0' : formatPrice(price)}</span>
                    <span className={styles.pricePeriod}>{isFree ? '/ forever' : '/ month'}</span>
                </div>
                <p id={`${tier.key}-billing`} className={styles.billingNote}>{billingDescription}</p>
            </div>

            <div className={styles.cardAction}>
                {action}
                <p id={`${tier.key}-terms`} className={styles.actionNote}>
                    {isFree ? 'Your starting point for global news'
                        : canManage ? 'Review plan changes in your account'
                            : isIncluded ? 'Already included with your membership'
                                : <><strong>{tier.trialDays} days free</strong> · $0 today · card required</>}
                </p>
            </div>

            <div className={styles.cardFeatures}>
                <p className={styles.includesLabel}>{tier.includes ?? 'The essentials, included:'}</p>
                <ul className={styles.featureList}>
                    {tier.features.map((feature) => (
                        <li key={feature}><LuCheck aria-hidden="true" /><span>{feature}</span></li>
                    ))}
                </ul>
            </div>
        </article>
    );
}
