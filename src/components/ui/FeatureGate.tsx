'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './FeatureGate.module.css';
import { getAccessRequirementTooltip, type RequiredAccessTier } from '@/lib/entitlements';

interface GatedButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  allowed: boolean;
  requiredTier: RequiredAccessTier;
  featureName: string;
  /** Describes the action when available; locked controls replace it with the access requirement. */
  title: string;
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
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    dismissRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (allowed) {
    return <button className={className} onClick={onClick} title={title} {...buttonProps}>{children}</button>;
  }

  const tierLabel = requiredTier === 'free'
    ? 'Free'
    : requiredTier[0].toUpperCase() + requiredTier.slice(1);
  const prompt = open && typeof document !== 'undefined'
    ? createPortal(
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            id={dialogId}
            className={styles.prompt}
            role="dialog"
            aria-modal="true"
            aria-label={`${featureName} upgrade`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.promptIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7.75 10V7.75a4.25 4.25 0 0 1 8.5 0V10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <rect x="5" y="10" width="14" height="10" rx="3" fill="currentColor" opacity=".14" />
                <rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="15" r="1.25" fill="currentColor" />
              </svg>
            </div>
            <span className={styles.promptEyebrow}>{tierLabel} feature</span>
            <h2>Unlock {featureName.toLowerCase()}</h2>
            <p>See every source and follow the story from the first report through the latest update.</p>
            <div className={styles.promptActions}>
              <button ref={dismissRef} onClick={() => setOpen(false)} className={styles.dismiss} title="Close the upgrade prompt">Maybe later</button>
              <Link
                href={`/pricing?feature=${encodeURIComponent(featureName)}&tier=${encodeURIComponent(requiredTier)}&returnTo=${encodeURIComponent(pathname || '/')}`}
                className={styles.upgradeLink}
                title={`View plans that include ${featureName}`}
              >Explore {tierLabel}</Link>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        {...buttonProps}
        className={`${className} ${styles.lockedControl}`}
        onClick={() => setOpen(true)}
        title={getAccessRequirementTooltip(featureName, requiredTier)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
      >
        {children}
      </button>
      {prompt}
    </>
  );
}
