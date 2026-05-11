/**
 * MapLoading Component
 * 
 * Provides a visual splash state during the initial loading and setup of the 
 * MapLibre engine. Used to prevent layout shifts before the map is ready for interaction.
 */

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
