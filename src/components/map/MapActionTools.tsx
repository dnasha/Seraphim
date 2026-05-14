/**
 * MapActionTools Component
 * 
 * Provides a specialized interface for managing map-specific environment overlays,
 * toggling 3D globe mode, and resetting map orientation.
 * 
 * Features:
 * - Environment overlay toggles (Earthquakes, Weather, Disasters).
 * - Orientation reset (North-up alignment).
 * - 2D/3D projection switching.
 * - Discovery badge system for first-time user interaction.
 */

import React, { useState, useEffect, useRef } from 'react';
import styles from './MapActionTools.module.css';

interface MapActionToolsProps {
    overlays: Record<string, boolean>;
    onOverlayToggle: (overlay: string, active: boolean) => void;
    isGlobe: boolean;
    onToggleGlobe: () => void;
    onResetOrientation: () => void;
    bearing?: number;
    disabled?: boolean;
}

const MapActionTools: React.FC<MapActionToolsProps> = ({
    overlays,
    onOverlayToggle,
    isGlobe,
    onToggleGlobe,
    onResetOrientation,
    bearing = 0,
    disabled = false
}) => {
    const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
    const [showBadge, setShowBadge] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        /**
         * Discovery badge logic:
         * Checks local storage to determine if the user has previously interacted with
         * the overlay menu. If not, a discovery badge is displayed.
         */
        const hasSeen = localStorage.getItem('seraphim_seen_overlays');
        if (!hasSeen) {
            requestAnimationFrame(() => {
                setShowBadge(true);
            });
        }
    }, []);

    const handleOverlayButtonClick = () => {
        // Dismiss the discovery badge upon the first interaction
        if (showBadge) {
            localStorage.setItem('seraphim_seen_overlays', 'true');
            setShowBadge(false);
        }
        setOverlayMenuOpen(!overlayMenuOpen);
    };

    /**
     * Click-outside handler:
     * Closes the overlay menu when the user clicks anywhere outside the component.
     */
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
                className={`${styles.actionBtn}${disabled ? ` ${styles.disabled}` : ''}`}
                onClick={disabled ? undefined : onResetOrientation}
                title="Reset Orientation (North up)"
                disabled={disabled}
            >
                <svg 
                    viewBox="0 0 512 512" 
                    width="18" 
                    height="18" 
                    fill="currentColor"
                    style={{ 
                        transform: `rotate(${-bearing - 45}deg)`,
                        transition: 'transform 0.15s ease-out'
                    }}
                >
                    <path d="M256,0C114.6,0,0,114.6,0,256s114.6,256,256,256s256-114.6,256-256S397.4,0,256,0z M256,472.6
                        c-119.6,0-216.6-97-216.6-216.6S136.4,39.4,256,39.4s216.6,97,216.6,216.6S375.6,472.6,256,472.6z M118.2,393.8l187.1-88.6
                        l88.6-187.1l-187.1,88.6L118.2,393.8z M285.5,285.5l-118.2,59.1l59.1-118.2L285.5,285.5z"/>
                </svg>
            </button>

            <button
                className={`${styles.actionBtn}${isGlobe ? ` ${styles.actionBtnActive}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                onClick={disabled ? undefined : onToggleGlobe}
                title={isGlobe ? "Switch to 2D Map" : "Switch to 3D Globe"}
                disabled={disabled}
            >
                <span className={styles.btnText}>3D</span>
            </button>

            <button
                className={`${styles.actionBtn}${overlayMenuOpen || Object.values(overlays).some(Boolean) ? ` ${styles.actionBtnActive}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                onClick={disabled ? undefined : handleOverlayButtonClick}
                title="Environmental Overlays"
                disabled={disabled}
            >
                <svg viewBox="0 0 1200 1200" width="20" height="20" fill="currentColor">
                    <path d="M381.64,1200C135.779,1061.434,71.049,930.278,108.057,751.148 c27.321-132.271,116.782-239.886,125.36-371.903c38.215,69.544,54.183,119.691,58.453,192.364 C413.413,422.695,493.731,216.546,498.487,0c0,0,316.575,186.01,337.348,466.98c27.253-57.913,40.972-149.892,13.719-209.504 c81.757,59.615,560.293,588.838-64.818,942.524c117.527-228.838,30.32-537.611-173.739-680.218 c13.628,61.319-10.265,290.021-100.542,390.515c25.014-167.916-23.8-238.918-23.8-238.918s-16.754,94.054-81.758,189.065 C345.537,947.206,304.407,1039.291,381.64,1200L381.64,1200z"/>
                </svg>
                {showBadge && <div className={styles.btnBadgeDot} />}
            </button>
        </div>
    );
};

export default MapActionTools;

