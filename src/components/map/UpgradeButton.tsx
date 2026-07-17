/**
 * UpgradeButton Component
 * 
 * A floating CTA button positioned in the top-left of the map viewport.
 * Only visible to Free-tier and Guest users. Links to the /pricing page.
 * Adjusts position when sidebar is collapsed to avoid overlapping the expand button.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import styles from './UpgradeButton.module.css';

interface UpgradeButtonProps {
    isSidebarOpen: boolean;
}

const UpgradeButton: React.FC<UpgradeButtonProps> = ({ isSidebarOpen }) => {
    return (
        <Link
            href="/pricing?returnTo=%2F"
            className={`${styles.upgradeBtn} ${!isSidebarOpen ? styles.upgradeBtnShifted : ''}`}
            aria-label="View pricing plans"
            title="View paid plans and unlock advanced monitoring tools"
        >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={styles.icon}>
                <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
            </svg>
            <span className={styles.label}>Upgrade</span>
        </Link>
    );
};

export default UpgradeButton;
