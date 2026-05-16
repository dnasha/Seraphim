/**
 * TierBadge Component
 * 
 * Displays a compact, color-coded tier status badge.
 * Colors: Guest(grey), Free(default text), Pro(indigo), Analyst(gold), Angel(emerald).
 * 
 * Used in the sidebar header and account page.
 */

'use client';

import React from 'react';
import styles from './TierBadge.module.css';

export type UserTier = 'guest' | 'free' | 'pro' | 'analyst' | 'angel';

interface TierBadgeProps {
    tier: UserTier;
    size?: 'sm' | 'md';
}

const TIER_LABELS: Record<UserTier, string> = {
    guest: 'Guest',
    free: 'Free',
    pro: 'Pro',
    analyst: 'Analyst',
    angel: 'Angel',
};

const TierBadge: React.FC<TierBadgeProps> = ({ tier, size = 'sm' }) => {
    return (
        <span className={`${styles.badge} ${styles[tier]} ${size === 'md' ? styles.md : ''}`}>
            {tier === 'angel' && (
                <svg viewBox="0 0 24 24" width={size === 'md' ? 14 : 10} height={size === 'md' ? 14 : 10} fill="currentColor" className={styles.icon}>
                    <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
                </svg>
            )}
            {tier === 'pro' && (
                <svg viewBox="0 0 24 24" width={size === 'md' ? 14 : 10} height={size === 'md' ? 14 : 10} fill="currentColor" className={styles.icon}>
                    <path d="M12 1l3.22 6.636 7.28 1.032-5.28 5.076 1.26 7.256L12 17.27 5.52 21l1.26-7.256L1.5 8.668l7.28-1.032z" />
                </svg>
            )}
            {tier === 'analyst' && (
                <svg viewBox="0 0 24 24" width={size === 'md' ? 14 : 10} height={size === 'md' ? 14 : 10} fill="currentColor" className={styles.icon}>
                    <path d="M12 1l3.22 6.636 7.28 1.032-5.28 5.076 1.26 7.256L12 17.27 5.52 21l1.26-7.256L1.5 8.668l7.28-1.032z" />
                </svg>
            )}
            {TIER_LABELS[tier]}
        </span>
    );
};

export default TierBadge;
