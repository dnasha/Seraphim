'use client';

/**
 * CookieConsent component provides a minimalist popup for GDPR and CCPA compliance.
 * It manages consent state via localStorage and handles hydration to prevent SSR mismatches.
 */

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { useAuthModalState } from '@/hooks/useAuthModalState';
import {
    getPrivacyConsent,
    PRIVACY_CONSENT_EVENT,
    setPrivacyConsent,
} from '@/lib/privacyConsent';
import styles from './CookieConsent.module.css';

const CookieConsent: React.FC = () => {
    const [showAuthModal] = useAuthModalState();
    const [isVisible, setIsVisible] = useState(false);

    /**
     * useSyncExternalStore acts as a hydration guard. 
     * It ensures the component only renders on the client to avoid SSR flickering 
     * or mismatch between server-side HTML and client-side state.
     */
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );

    useEffect(() => {
        if (!mounted || showAuthModal) return;

        const consent = getPrivacyConsent();
        if (consent) return;

        // Delayed entry for a smoother, premium feel
        const timer = setTimeout(() => setIsVisible(true), 2000);
        return () => clearTimeout(timer);
    }, [mounted, showAuthModal]);

    useEffect(() => {
        const open = () => setIsVisible(true);
        window.addEventListener(`${PRIVACY_CONSENT_EVENT}:open`, open);
        return () => window.removeEventListener(`${PRIVACY_CONSENT_EVENT}:open`, open);
    }, []);

    const handleAccept = () => {
        setPrivacyConsent('accepted');
        setIsVisible(false);
    };

    const handleDecline = () => {
        setPrivacyConsent('essential');
        setIsVisible(false);
    };

    if (!mounted || !isVisible) return null;

    return (
        <div className={styles.container} role="alert" aria-live="polite">
            <div className={styles.content}>
                <h3 className={styles.title}>Privacy & Cookies</h3>
                <p className={styles.description}>
                    Seraphim uses essential browser storage to function. With your permission, we also collect optional performance and product-usage metrics to improve your experience.
                </p>
            </div>
            <div className={styles.actions}>
                <button 
                    className={styles.declineBtn} 
                    onClick={handleDecline}
                    title="Use essential storage only and decline optional metrics"
                >
                    Essential Only
                </button>
                <button 
                    className={styles.acceptBtn} 
                    onClick={handleAccept}
                    aria-label="Allow optional performance and product-usage metrics"
                    title="Allow optional performance and product-usage metrics"
                >
                    Allow Optional Metrics
                </button>
            </div>
        </div>
    );
};

export default CookieConsent;
