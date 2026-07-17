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
import { canUseOverlay, hasFeature, type UserTier } from '@/lib/entitlements';
import { GatedButton } from '@/components/ui/FeatureGate';
import { 
    LuActivity, 
    LuCloudRain, 
    LuBiohazard, 
    LuFlame, 
    LuRadiation, 
    LuWind, 
    LuPlane,
    LuRocket
} from 'react-icons/lu';

interface MapActionToolsProps {
    overlays: Record<string, boolean>;
    overlayStatuses?: Record<string, 'idle' | 'loading' | 'live' | 'degraded'>;
    onOverlayToggle: (overlay: string, active: boolean) => void;
    isGlobe: boolean;
    onToggleGlobe: () => void;
    onResetOrientation: () => void;
    drawToolsOpen: boolean;
    onToggleDrawTools: () => void;
    bearing?: number;
    disabled?: boolean;
    userTier?: UserTier;
}

const MapActionTools: React.FC<MapActionToolsProps> = ({
    overlays,
    overlayStatuses = {},
    onOverlayToggle,
    isGlobe,
    onToggleGlobe,
    onResetOrientation,
    drawToolsOpen,
    onToggleDrawTools,
    bearing = 0,
    disabled = false,
    userTier = 'guest'
}) => {
    const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
    const [showBadge, setShowBadge] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const statusLabel = (key: string, fallback: string) => {
        const status = overlayStatuses[key] ?? 'idle';
        if (!overlays[key] || status === 'idle') return fallback;
        if (status === 'loading') return 'Connecting…';
        if (status === 'degraded') return 'Provider unavailable';
        return `Live · ${fallback}`;
    };

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
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.eqIcon}`}>
                                <LuActivity className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>USGS Earthquakes</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.usgs ?? 'idle'}`]}`}>{statusLabel('usgs', 'USGS · past 24 hours')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['usgs'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('usgs', !overlays['usgs'])} allowed={canUseOverlay(userTier, 'usgs')} requiredTier="free" featureName="Earthquake overlay"
                             title={`${overlays.usgs ? 'Hide' : 'Show'} USGS earthquakes from the past 24 hours`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.weatherIcon}`}>
                                <LuCloudRain className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>NOAA Weather (Radar)</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.noaa ?? 'idle'}`]}`}>{statusLabel('noaa', 'Iowa State NEXRAD')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['noaa'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('noaa', !overlays['noaa'])} allowed={canUseOverlay(userTier, 'noaa')} requiredTier="pro" featureName="Weather radar overlay"
                             title={`${overlays.noaa ? 'Hide' : 'Show'} NOAA weather radar`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.fireIcon}`}>
                                <LuFlame className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>Active Wildfires</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.fires ?? 'idle'}`]}`}>{statusLabel('fires', 'NASA FIRMS')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['fires'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('fires', !overlays['fires'])} allowed={canUseOverlay(userTier, 'fires')} requiredTier="pro" featureName="Wildfire overlay"
                             title={`${overlays.fires ? 'Hide' : 'Show'} active wildfire detections`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.planeIcon}`}>
                                <LuPlane className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>Live Flights</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.flights ?? 'idle'}`]}`}>{statusLabel('flights', 'ADSB.lol / ADSB.fi')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['flights'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('flights', !overlays['flights'])} allowed={canUseOverlay(userTier, 'flights')} requiredTier="analyst" featureName="Live flight tracking"
                             title={`${overlays.flights ? 'Hide' : 'Show'} live aircraft positions`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.issIcon}`}>
                                <LuRocket className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>Space Station (ISS)</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.iss ?? 'idle'}`]}`}>{statusLabel('iss', 'Where the ISS at')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['iss'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('iss', !overlays['iss'])} allowed={canUseOverlay(userTier, 'iss')} requiredTier="analyst" featureName="ISS tracking"
                             title={`${overlays.iss ? 'Hide' : 'Show'} the current ISS position`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.aqiIcon}`}>
                                <LuWind className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>Air Quality (AQI)</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.aqi ?? 'idle'}`]}`}>{statusLabel('aqi', 'World Air Quality Index')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['aqi'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('aqi', !overlays['aqi'])} allowed={canUseOverlay(userTier, 'aqi')} requiredTier="analyst" featureName="Air quality overlay"
                             title={`${overlays.aqi ? 'Hide' : 'Show'} air-quality readings`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.radIcon}`}>
                                <LuRadiation className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>Safecast Radiation</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.radiation ?? 'idle'}`]}`}>{statusLabel('radiation', 'Safecast')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['radiation'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('radiation', !overlays['radiation'])} allowed={canUseOverlay(userTier, 'radiation')} requiredTier="analyst" featureName="Radiation overlay"
                             title={`${overlays.radiation ? 'Hide' : 'Show'} Safecast radiation readings`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>

                    <label className={styles.overlayToggle}>
                        <div className={styles.toggleLeft}>
                            <div className={`${styles.iconWrapper} ${styles.disasterIcon}`}>
                                <LuBiohazard className={styles.toggleIcon} />
                            </div>
                            <div className={styles.overlayLabelInfo}>
                                <span className={styles.overlayName}>NASA Events (EONET)</span>
                                <span className={`${styles.overlayTimeframe} ${styles[`status_${overlayStatuses.eonet ?? 'idle'}`]}`}>{statusLabel('eonet', 'NASA EONET · 30 days')}</span>
                            </div>
                        </div>
                        <GatedButton className={`${styles.toggleSwitch}${overlays['eonet'] ? ` ${styles.toggleSwitchOn}` : ''}`}
                             onClick={() => onOverlayToggle('eonet', !overlays['eonet'])} allowed={canUseOverlay(userTier, 'eonet')} requiredTier="pro" featureName="NASA events overlay"
                             title={`${overlays.eonet ? 'Hide' : 'Show'} NASA natural events from the past 30 days`}>
                            <div className={styles.toggleKnob} />
                        </GatedButton>
                    </label>
                </div>
            )}
            
            <button
                className={styles.actionBtn}
                onClick={onResetOrientation}
                title="Reset Orientation (North up)"
                aria-label="Reset map orientation to north up"
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

            <GatedButton
                className={`${styles.actionBtn}${isGlobe ? ` ${styles.actionBtnActive}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                onClick={onToggleGlobe}
                title={isGlobe ? "Switch to 2D Map" : "Switch to 3D Globe"}
                allowed={!disabled && hasFeature(userTier, 'globe')}
                requiredTier={userTier === 'guest' ? 'free' : 'pro'}
                featureName="3D globe"
            >
                <span className={styles.btnText}>3D</span>
            </GatedButton>

            <div className={styles.bottomRow}>
                <GatedButton
                    className={`${styles.actionBtn}${drawToolsOpen ? ` ${styles.actionBtnActive}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                    onClick={onToggleDrawTools}
                    title="Draw & Measure"
                    allowed={!disabled && hasFeature(userTier, 'drawTools')}
                    requiredTier="free"
                    featureName="Draw and measure tools"
                >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                        <path d="M2 2l7.58 7.58"></path>
                    </svg>
                </GatedButton>

            <button
                className={`${styles.actionBtn}${overlayMenuOpen || Object.values(overlays).some(Boolean) ? ` ${styles.actionBtnActive}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
                onClick={handleOverlayButtonClick}
                title={overlayMenuOpen ? "Close environmental overlay controls" : "Open environmental overlay controls"}
                aria-label={overlayMenuOpen ? "Close environmental overlay controls" : "Open environmental overlay controls"}
                >
                    <svg viewBox="0 0 1200 1200" width="20" height="20" fill="currentColor">
                        <path d="M381.64,1200C135.779,1061.434,71.049,930.278,108.057,751.148 c27.321-132.271,116.782-239.886,125.36-371.903c38.215,69.544,54.183,119.691,58.453,192.364 C413.413,422.695,493.731,216.546,498.487,0c0,0,316.575,186.01,337.348,466.98c27.253-57.913,40.972-149.892,13.719-209.504 c81.757,59.615,560.293,588.838-64.818,942.524c117.527-228.838,30.32-537.611-173.739-680.218 c13.628,61.319-10.265,290.021-100.542,390.515c25.014-167.916-23.8-238.918-23.8-238.918s-16.754,94.054-81.758,189.065 C345.537,947.206,304.407,1039.291,381.64,1200L381.64,1200z"/>
                    </svg>
                    {showBadge && <div className={styles.btnBadgeDot} />}
                </button>
            </div>
        </div>
    );
};

export default MapActionTools;

