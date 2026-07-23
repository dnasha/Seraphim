'use client';

/**
 * CookieConsent component provides a minimalist popup for GDPR and CCPA compliance.
 * It manages consent state via localStorage and handles hydration to prevent SSR mismatches.
 */

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
    getPrivacyConsent,
    PRIVACY_CONSENT_EVENT,
    setPrivacyConsent,
} from '@/lib/privacyConsent';
import styles from './CookieConsent.module.css';

const CookieConsent: React.FC = () => {
    const { showAuthModal } = useAuth();
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
                    Seraphim uses essential cookies to function. We also use analytics to improve the quality of your experience. 
                    Upholding EU (GDPR) and California (CCPA) standards, we ask for your consent.
                </p>
            </div>
            <div className={styles.actions}>
                <button 
                    className={styles.declineBtn} 
                    onClick={handleDecline}
                    title="Use essential cookies only and decline analytics"
                >
                    Essential Only
                </button>
                <button 
                    className={styles.acceptBtn} 
                    onClick={handleAccept}
                    aria-label="Accept all cookies"
                    title="Allow essential cookies and privacy-conscious analytics"
                >
                    Accept All
                </button>
            </div>
        </div>
    );
};

export default CookieConsent;
