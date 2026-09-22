'use client';

import React, { useId, useState } from 'react';
import { LuLockKeyhole } from 'react-icons/lu';
import { getAccessRequirementTooltip, type RequiredAccessTier } from '@/lib/entitlements';
import { currentReturnPath } from '@/lib/upgradeNavigation';
import TierBadge from './TierBadge';
import UpgradePrompt from './UpgradePrompt';
import styles from './FeatureGate.module.css';
import tierStyles from './TierBadge.module.css';

interface GatedButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  allowed: boolean;
  requiredTier: RequiredAccessTier;
  featureName: string;
  featureDescription: string;
  /** A badge replaces an unavailable switch; icon suits compact controls. */
  indicator?: 'icon' | 'badge' | 'none';
  title: string;
}

/** One access prompt for filters, map tools, overlays, and story timelines. */
export function GatedButton({
  allowed, requiredTier, featureName, featureDescription, indicator = 'icon',
  className = '', children, onClick, title, type = 'button', ...buttonProps
}: GatedButtonProps) {
  if (allowed) {
    return <button {...buttonProps} type={type} className={className} onClick={onClick} title={title}>{children}</button>;
  }

  return <LockedButton {...buttonProps} requiredTier={requiredTier} featureName={featureName}
    featureDescription={featureDescription} indicator={indicator} className={className}>{children}</LockedButton>;
}

// Unmount the prompt state when access changes, so it cannot reopen on expiry.
function LockedButton({ requiredTier, featureName, featureDescription, indicator, className, children, ...buttonProps }: Omit<GatedButtonProps, 'allowed' | 'onClick' | 'title'>) {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const dialogId = useId();
  const requirement = getAccessRequirementTooltip(featureName, requiredTier);

  return (
    <>
      <button
        {...buttonProps}
        type="button"
        className={`${tierStyles.tier} ${indicator === 'badge' ? styles.badgeControl : `${className} ${styles.lockedControl}`}`}
        data-tier={requiredTier}
        data-access-tier={requiredTier}
        onClick={(event) => {
          event.stopPropagation();
          setReturnTo(currentReturnPath());
        }}
        title={requirement}
        aria-label={indicator === 'badge' ? requirement : buttonProps['aria-label']}
        aria-describedby={[buttonProps['aria-describedby'], `${dialogId}-requirement`].filter(Boolean).join(' ')}
        aria-pressed={undefined}
        aria-haspopup="dialog"
        aria-expanded={returnTo !== null}
        aria-controls={returnTo !== null ? dialogId : undefined}
      >
        {indicator === 'badge' ? <TierBadge tier={requiredTier} locked /> : <>
          {children}
          {indicator === 'icon' && <LuLockKeyhole className={styles.lockIcon} aria-hidden="true" />}
        </>}
      </button>
      <span id={`${dialogId}-requirement`} className={styles.srOnly}>{requirement}</span>
      {returnTo !== null && <UpgradePrompt
        id={dialogId}
        requiredTier={requiredTier}
        featureName={featureName}
        featureDescription={featureDescription}
        returnTo={returnTo}
        onDismiss={() => setReturnTo(null)}
      />}
    </>
  );
}
