/*
MapSettings component for the Seraphim OSINT dashboard.
Provides a configuration panel to toggle map styles, clustering, and visibility filters.
*/

import React from 'react';
import { MAP_STYLES } from './MapConstants';
import styles from './MapSettings.module.css';

interface MapSettingsProps {
    mapStyle: string;
    onStyleChange: (style: string) => void;
    forceIndividualPins: boolean;
    onForceIndividualPinsToggle: () => void;
    isOpen: boolean;
    onToggleOpen: () => void;
    panelRef: React.RefObject<HTMLDivElement>;
    unmappedOnly: boolean;
    onUnmappedOnlyChange: (val: boolean) => void;
}

const MapSettings: React.FC<MapSettingsProps> = ({
    mapStyle,
    onStyleChange,
    forceIndividualPins,
    onForceIndividualPinsToggle,
    isOpen,
    onToggleOpen,
    panelRef,
    unmappedOnly,
    onUnmappedOnlyChange
}) => {
    return (
        <div className={styles.mapSettingsArea} ref={panelRef}>
            <button
                className={styles.mapSettingsBtn}
                onClick={onToggleOpen}
                title="Map settings"
                aria-label="Map settings"
            >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/>
                </svg>
                <div className={styles.btnRedDot} />
            </button>

            {isOpen && (
                <div className={styles.mapSettingsPanel}>
                    {/* Map style selection grid */}
                    <div className={styles.settingsSection}>
                        <div className={styles.settingsLabel}>Map Style</div>
                        <div className={styles.settingsStyleGrid}>
                            {Object.entries(MAP_STYLES).map(([key, style]) => (
                                <button
                                    key={key}
                                    className={`${styles.settingsStyleBtn}${mapStyle === key ? ` ${styles.settingsStyleBtnActive}` : ''}`}
                                    onClick={() => onStyleChange(key)}
                                >
                                    {style.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={styles.settingsDivider} />

                    {/* Toggle for disabling client-side clustering */}
                    <div className={styles.settingsSection}>
                        <div className={styles.settingsLabel}>Display Mode</div>
                        <div className={styles.settingsToggle} onClick={onForceIndividualPinsToggle} style={{ cursor: 'pointer' }}>
                            <span className={styles.settingsToggleLabel}>Force individual pins</span>
                            <div className={`${styles.toggleSwitch}${forceIndividualPins ? ` ${styles.toggleSwitchOn}` : ''}`}>
                                <div className={styles.toggleKnob} />
                            </div>
                        </div>
                    </div>

                    <div className={styles.settingsDivider} />

                    {/* Filter for showing ONLY news items without geographic coordinates */}
                    <div className={styles.settingsSection}>
                        <div className={styles.settingsLabel}>Visibility</div>
                        <div className={styles.settingsToggle} onClick={() => onUnmappedOnlyChange(!unmappedOnly)} style={{ cursor: 'pointer' }}>
                            <span className={styles.settingsToggleLabel}>Unmapped only</span>
                            <div className={`${styles.toggleSwitch}${unmappedOnly ? ` ${styles.toggleSwitchOn}` : ''}`}>
                                <div className={styles.toggleKnob} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MapSettings;

