/**
 * UpgradeButton Component
 * 
 * A floating CTA button positioned in the top-left of the map viewport.
 * Only visible to Free-tier and Guest users. Links to the /pricing page.
 * Adjusts position when sidebar is collapsed to avoid overlapping the expand button.
 */

'use client';

import React from 'react';
import UpgradeLink from '@/components/ui/UpgradeLink';
import styles from './UpgradeButton.module.css';

interface UpgradeButtonProps {
    isSidebarOpen: boolean;
}

const UpgradeButton: React.FC<UpgradeButtonProps> = ({ isSidebarOpen }) => {
    return (
        <UpgradeLink
            className={`${styles.upgradeBtn} ${!isSidebarOpen ? styles.upgradeBtnShifted : ''}`}
        />
    );
};

export default UpgradeButton;
