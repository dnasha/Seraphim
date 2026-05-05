'use client';

import styles from './MapError.module.css';

interface MapErrorProps {
    onRetry: () => void;
    error?: string;
}

export default function MapError({ onRetry, error }: MapErrorProps) {
    return (
        <div className={styles.errorContainer}>
            <svg className={styles.errorIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <h2 className={styles.errorTitle}>Map Unavailable</h2>
            <p className={styles.errorMessage}>
                {error || "We're having trouble loading the interactive map. This could be due to a connectivity issue or a service interruption."}
            </p>
            <button className={styles.retryButton} onClick={onRetry}>
                Retry Loading Map
            </button>
        </div>
    );
}
