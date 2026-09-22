'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { LuArrowRight, LuLayers, LuUserRoundPlus, LuX } from 'react-icons/lu';
import { setAuthModalOpen } from '@/hooks/useAuthModalState';
import type { RequiredAccessTier } from '@/lib/entitlements';
import { pricingHref } from '@/lib/upgradeNavigation';
import TierBadge, { TIER_LABELS } from './TierBadge';
import styles from './UpgradePrompt.module.css';
import actions from './UpgradeActions.module.css';
import tierStyles from './TierBadge.module.css';

interface UpgradePromptProps {
  id: string;
  requiredTier: RequiredAccessTier;
  featureName: string;
  featureDescription: string;
  returnTo: string;
  onDismiss: () => void;
}

export default function UpgradePrompt({ id, requiredTier, featureName, featureDescription, returnTo, onDismiss }: UpgradePromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const isFree = requiredTier === 'free';
  const tierLabel = TIER_LABELS[requiredTier];

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      id={id}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget && event.button === 0
          ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId } : null;
      }}
      onPointerCancel={() => { backdropPress.current = null; }}
      onPointerUp={(event) => {
        const press = backdropPress.current;
        backdropPress.current = null;
        if (press && press.pointerId === event.pointerId && event.target === event.currentTarget
          && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 4) onDismiss();
      }}
    >
      <section className={`${styles.prompt} ${tierStyles.tier}`} data-tier={requiredTier}>
        <button type="button" className={actions.closeButton} onClick={onDismiss} title="Close this feature preview" aria-label="Close feature preview">
          <LuX aria-hidden="true" />
        </button>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">{isFree ? <LuUserRoundPlus /> : <LuLayers />}</span>
          <TierBadge tier={requiredTier} size="md" locked />
        </div>
        <h2 id={`${id}-title`}>{featureName}</h2>
        <p id={`${id}-description`} className={styles.description}>{featureDescription}</p>
        <p className={styles.accessNote}>
          {isFree ? 'Included with a free account. No card needed.'
            : requiredTier === 'pro' ? 'Included in Pro, Analyst, and Angel.'
              : requiredTier === 'analyst' ? 'Included in Analyst and Angel.'
                : 'Included with an Angel membership.'}
        </p>
        <div className={styles.actions}>
          {isFree ? <button type="button" className={`${actions.action} ${actions.primary}`} title="Create a free Seraphim account" onClick={() => {
            onDismiss();
            setAuthModalOpen(true, { initialTab: 'signup', returnTo, subtitle: `Create a free account to use ${featureName}` });
          }}>Create free account <LuArrowRight aria-hidden="true" /></button>
            : <Link href={pricingHref(returnTo, featureName, requiredTier)} className={`${actions.action} ${actions.primary}`} title={`Compare plans that include ${featureName}`} onClick={onDismiss}>
              View {tierLabel} plan <LuArrowRight aria-hidden="true" />
            </Link>}
          <button type="button" className={actions.action} onClick={onDismiss} title="Close this feature preview and keep exploring">Maybe later</button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
