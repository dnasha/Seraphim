/*
MapActionTools component for managing environmental overlays.
Provides a menu to toggle live data layers such as earthquakes, weather, and disasters.
*/

import React, { useState, useEffect, useRef } from 'react';
import styles from './MapActionTools.module.css';

interface MapActionToolsProps {
    overlays: Record<string, boolean>;
    onOverlayToggle: (overlay: string, active: boolean) => void;
}

const MapActionTools: React.FC<MapActionToolsProps> = ({
    overlays,
    onOverlayToggle,
}) => {
    const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Effect to handle closing the overlay menu when clicking outside of it.
    useEffect(() => {
        if (!overlayMenuOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOverlayMenuOpen(false);
            }
        };
        const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClick);
        };
    }, [overlayMenuOpen]);

    return (
        <div className={styles.mapActionArea} ref={menuRef}>
            {overlayMenuOpen && (
                <div className={styles.overlayMenu}>
                    <div className={styles.menuHeader}>Live Overlays</div>
                    <label className={styles.overlayToggle}>
                        <div className={styles.overlayLabelInfo}>
                            <span>USGS Earthquakes</span>
                            <span className={styles.overlayTimeframe}>Past 24 Hours</span>
                        </div>
                        <div className={`${styles.toggleSwitch}${overlays['usgs'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('usgs', !overlays['usgs'])}>
                            <div className={styles.toggleKnob} />
                        </div>
                    </label>
                    <label className={styles.overlayToggle}>
                        <div className={styles.overlayLabelInfo}>
                            <span>NOAA Weather (Radar)</span>
                            <span className={styles.overlayTimeframe}>Real-time (Live)</span>
                        </div>
                        <div className={`${styles.toggleSwitch}${overlays['noaa'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('noaa', !overlays['noaa'])}>
                            <div className={styles.toggleKnob} />
                        </div>
                    </label>
                    <label className={styles.overlayToggle}>
                        <div className={styles.overlayLabelInfo}>
                            <span>NASA Events (Disasters)</span>
                            <span className={styles.overlayTimeframe}>Past 30 Days</span>
                        </div>
                        <div className={`${styles.toggleSwitch}${overlays['eonet'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('eonet', !overlays['eonet'])}>
                            <div className={styles.toggleKnob} />
                        </div>
                    </label>
                </div>
            )}
            
            <button
                className={`${styles.actionBtn}${overlayMenuOpen || Object.values(overlays).some(Boolean) ? ` ${styles.actionBtnActive}` : ''}`}
                onClick={() => setOverlayMenuOpen(!overlayMenuOpen)}
                title="Environmental Overlays"
            >
                <svg viewBox="0 0 1200 1200" width="20" height="20" fill="currentColor">
                    <path d="M381.64,1200C135.779,1061.434,71.049,930.278,108.057,751.148 c27.321-132.271,116.782-239.886,125.36-371.903c38.215,69.544,54.183,119.691,58.453,192.364 C413.413,422.695,493.731,216.546,498.487,0c0,0,316.575,186.01,337.348,466.98c27.253-57.913,40.972-149.892,13.719-209.504 c81.757,59.615,560.293,588.838-64.818,942.524c117.527-228.838,30.32-537.611-173.739-680.218 c13.628,61.319-10.265,290.021-100.542,390.515c25.014-167.916-23.8-238.918-23.8-238.918s-16.754,94.054-81.758,189.065 C345.537,947.206,304.407,1039.291,381.64,1200L381.64,1200z"/>
                </svg>
            </button>
        </div>
    );
};

export default MapActionTools;

