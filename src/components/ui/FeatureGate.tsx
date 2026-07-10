'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './FeatureGate.module.css';
import type { UserTier } from '@/lib/entitlements';

interface GatedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  allowed: boolean;
  requiredTier: Exclude<UserTier, 'guest' | 'free'> | 'free';
  featureName: string;
}

/**
 * Keeps paid capabilities discoverable without letting a disabled control hide
 * its value. Locked actions open a concise, keyboard-accessible upgrade prompt.
 */
export function GatedButton({
  allowed,
  requiredTier,
  featureName,
  className = '',
  children,
  onClick,
  title,
  ...buttonProps
}: GatedButtonProps) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const pathname = usePathname();

  if (allowed) {
    return <button className={className} onClick={onClick} title={title} {...buttonProps}>{children}</button>;
  }

  return (
    <>
      <button
        {...buttonProps}
        className={`${className} ${styles.lockedControl}`}
        onClick={() => setOpen(true)}
        title={`${featureName} requires ${requiredTier === 'free' ? 'a free account' : requiredTier[0].toUpperCase() + requiredTier.slice(1)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
      >
        {children}
      </button>
      {open && (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            id={dialogId}
            className={styles.prompt}
            role="dialog"
            aria-modal="true"
            aria-label={`${featureName} upgrade`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className={styles.promptLock} aria-hidden="true">✦</span>
            <h2>{featureName} is a {requiredTier === 'free' ? 'Free' : requiredTier[0].toUpperCase() + requiredTier.slice(1)} feature</h2>
            <p>Upgrade to unlock this monitoring capability without losing your current view.</p>
            <div className={styles.promptActions}>
              <button onClick={() => setOpen(false)} className={styles.dismiss}>Not now</button>
              <Link
                href={`/pricing?feature=${encodeURIComponent(featureName)}&returnTo=${encodeURIComponent(pathname || '/')}`}
                className={styles.upgradeLink}
              >View plans</Link>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
