'use client';

import { useState, useEffect } from 'react';
import { mergePwaDismissals, readPwaDismissal, writePwaDismissal, PWA_COOLDOWN_MS, PWA_DISMISS_LIMIT, type PwaDismissal } from '@/lib/pwaPreferences';
import styles from './PWAInstallPrompt.module.css';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PWAInstallPromptProps {
  userId: string | null;
  ready: boolean;
  preferences: PwaDismissal | null;
  onPreferencesChange: (patch: PwaDismissal, options?: { immediate?: boolean }) => void;
}

export default function PWAInstallPrompt(props: PWAInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // Capture the event even while account preferences are still loading.
  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  return <InstallPromptContent {...props} key={props.userId ?? 'guest'} deferredPrompt={deferredPrompt} clearPrompt={() => setDeferredPrompt(null)} />;
}

function InstallPromptContent({ userId, ready, preferences, onPreferencesChange, deferredPrompt, clearPrompt }: PWAInstallPromptProps & {
  deferredPrompt: BeforeInstallPromptEvent | null;
  clearPrompt: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [localDismissal, setLocalDismissal] = useState(() => readPwaDismissal(userId));
  const [visitStartedAt] = useState(() => Date.now());
  const dismissal = mergePwaDismissals(localDismissal, preferences ?? {});
  const { pwaDismissCount, pwaLastDismissedAt } = dismissal;
  const suppressed = pwaDismissCount >= PWA_DISMISS_LIMIT
    || (pwaLastDismissedAt > 0 && visitStartedAt - pwaLastDismissedAt < PWA_COOLDOWN_MS);

  useEffect(() => {
    if (!ready || suppressed) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !('MSStream' in window);
    if (!isIOS && !deferredPrompt) return;

    const timer = setTimeout(() => {
      // Another tab may have dismissed it during the delay.
      const latest = mergePwaDismissals({ pwaDismissCount, pwaLastDismissedAt }, readPwaDismissal(userId));
      if (latest.pwaDismissCount >= PWA_DISMISS_LIMIT
        || (latest.pwaLastDismissedAt > 0 && Date.now() - latest.pwaLastDismissedAt < PWA_COOLDOWN_MS)) return;
      setIsIOSDevice(isIOS);
      setIsVisible(true);
    }, isIOS ? 6000 : 5000);
    return () => clearTimeout(timer);
  }, [ready, suppressed, deferredPrompt, pwaDismissCount, pwaLastDismissedAt, userId]);

  useEffect(() => {
    const handleStorage = () => setLocalDismissal(current => mergePwaDismissals(current, readPwaDismissal(userId)));
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [userId]);

  const handleDismiss = () => {
    const current = mergePwaDismissals(dismissal, readPwaDismissal(userId));
    const next = {
      pwaDismissCount: Math.min(PWA_DISMISS_LIMIT, current.pwaDismissCount + 1),
      pwaLastDismissedAt: Date.now(),
    };
    setIsVisible(false);
    setShowIOSInstructions(false);
    setLocalDismissal(next);
    writePwaDismissal(userId, next);
    if (userId) onPreferencesChange(next, { immediate: true });
  };

  const handleInstallClick = async () => {
    if (isIOSDevice) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'dismissed') handleDismiss();
    else setIsVisible(false);
    clearPrompt();
  };

  if (!isVisible || !ready || suppressed) return null;

  return (
    <div className={styles.pwaPromptContainer} role="alert">
      {!showIOSInstructions ? (
        <div className={styles.pwaBanner}>
          <div className={styles.pwaBrandInfo}>
            <div className={styles.pwaLogoWrapper}>
              <svg viewBox="0 0 200 200" fill="none" className={styles.pwaLogo} xmlns="http://www.w3.org/2000/svg">
                <path d="M100 110.528L125 83.5281H75L100 110.528Z" fill="var(--accent)" />
                <path d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z" stroke="var(--accent)" strokeWidth="12" />
                <path d="M100 110.528L125 83.5281H75L100 110.528Z" stroke="var(--accent)" strokeWidth="12" />
              </svg>
            </div>
            <div className={styles.pwaTextWrapper}>
              <h3>Add Seraphim to Home Screen</h3>
              <p>Install Seraphim for a fast, full-screen standalone OSINT dashboard experience.</p>
            </div>
          </div>
          <div className={styles.pwaActions}>
            <button className={styles.dismissBtn} onClick={handleDismiss} aria-label="Dismiss install prompt" title="Dismiss the install prompt for now">
              Later
            </button>
            <button className={styles.installBtn} onClick={handleInstallClick} title="Install Seraphim as an app on this device">
              Install Now
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.iosInstructionsCard}>
          <div className={styles.iosHeader}>
            <h3>Install Seraphim on iOS</h3>
            <button className={styles.iosCloseBtn} onClick={handleDismiss} aria-label="Close instructions" title="Close the iOS installation instructions">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <p className={styles.iosSub}>Safari does not support direct installation. Please follow these manual steps to add Seraphim to your Home Screen:</p>
          <ol className={styles.iosSteps}>
            <li>
              <span>1.</span> Tap the <strong>Share</strong> button in Safari&apos;s bottom toolbar.
              <div className={styles.iosIconVisual}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M12 2v12M8 6l4-4 4 4" />
                </svg>
                <span>Share Button</span>
              </div>
            </li>
            <li>
              <span>2.</span> Scroll down the sharing menu and select <strong>Add to Home Screen</strong>.
              <div className={styles.iosIconVisual}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                <span>Add to Home Screen</span>
              </div>
            </li>
          </ol>
          <div className={styles.iosFooter}>
            <button className={styles.iosDoneBtn} onClick={handleDismiss} title="Close the iOS installation instructions">
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
