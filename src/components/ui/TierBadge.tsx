import { LuLockKeyhole, LuSparkles } from 'react-icons/lu';
import type { UserTier } from '@/lib/entitlements';
import styles from './TierBadge.module.css';

export type { UserTier } from '@/lib/entitlements';

export const TIER_LABELS: Record<UserTier, string> = {
    guest: 'Guest', free: 'Free', pro: 'Pro', analyst: 'Analyst', angel: 'Angel',
};

interface TierBadgeProps {
    tier: UserTier;
    size?: 'sm' | 'md';
    locked?: boolean;
}

/** Plan identity and feature access share the same label, icon, and color. */
export default function TierBadge({ tier, size = 'sm', locked = false }: TierBadgeProps) {
    return (
        <span data-tier={tier} className={`${styles.tier} ${styles.badge} ${size === 'md' ? styles.md : ''}`}>
            {locked ? <LuLockKeyhole aria-hidden="true" /> : tier === 'angel' && <LuSparkles aria-hidden="true" />}
            {TIER_LABELS[tier]}
        </span>
    );
}
