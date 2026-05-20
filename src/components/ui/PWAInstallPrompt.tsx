'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from './PWAInstallPrompt.module.css';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export default function PWAInstallPrompt() {
  const [isVisible, setIsVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Check if the app is already running in standalone mode (installed)
    const isStandalone = 
      window.matchMedia('(display-mode: standalone)').matches || 
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    
    if (isStandalone) return;

    // 2. Check if user dismissed the prompt recently (within 7 days)
    const dismissedTime = localStorage.getItem('seraphim_pwa_dismissed');
    if (dismissedTime) {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - parseInt(dismissedTime, 10) < sevenDaysMs) {
        return;
      }
    }

    // 3. Detect iOS Safari
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    
    if (isIOS) {
      // Wait 6 seconds after mounting to display the prompt gently
      timeoutRef.current = setTimeout(() => {
        setIsIOSDevice(true);
        setIsVisible(true);
      }, 6000);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }

    // 4. Handle standard beforeinstallprompt (Android / Chrome / Windows / macOS Edge/Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Clear any existing scheduled prompt timer to prevent duplicate overlays
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      // Show the prompt gently after a delay
      timeoutRef.current = setTimeout(() => {
        // Double check cooldown in case it was dismissed while the timeout was pending
        const dismissedTime = localStorage.getItem('seraphim_pwa_dismissed');
        if (dismissedTime) {
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
          if (Date.now() - parseInt(dismissedTime, 10) < sevenDaysMs) {
            return;
          }
        }
        setIsVisible(true);
      }, 5000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    // Fallback: If PWA is installable but the event fired before listener mounted, 
    // some browsers might allow standard install triggers, but listening is safest.
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOSDevice) {
      setShowIOSInstructions(true);
      return;
    }

    if (!deferredPrompt) return;

    // Show the browser's install prompt
    await deferredPrompt.prompt();
    
    // Wait for the user's response
    const { outcome } = await deferredPrompt.userChoice;
    
    setIsVisible(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    if (outcome === 'accepted') {
      // Installed!
    } else {
      // Dismissed the native install prompt - set cooldown
      localStorage.setItem('seraphim_pwa_dismissed', Date.now().toString());
    }
    
    // Clear deferred prompt either way
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setShowIOSInstructions(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    localStorage.setItem('seraphim_pwa_dismissed', Date.now().toString());
  };

  if (!isVisible) return null;

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
            <button className={styles.dismissBtn} onClick={handleDismiss} aria-label="Dismiss install prompt">
              Later
            </button>
            <button className={styles.installBtn} onClick={handleInstallClick}>
              Install Now
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.iosInstructionsCard}>
          <div className={styles.iosHeader}>
            <h3>Install Seraphim on iOS</h3>
            <button className={styles.iosCloseBtn} onClick={handleDismiss} aria-label="Close instructions">
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
            <button className={styles.iosDoneBtn} onClick={handleDismiss}>
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
