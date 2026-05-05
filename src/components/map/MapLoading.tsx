'use client';

import styles from './MapLoading.module.css';

export default function MapLoading() {
    return (
        <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
            <div className={styles.loadingText}>Initializing Map Engine</div>
        </div>
    );
}
