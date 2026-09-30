import { ACTIVITY_COLORS } from './layers';
import type { ActivityHeatmapData } from './data';
import styles from './ActivityHeatmapLegend.module.css';

export default function ActivityHeatmapLegend({ data, dark, loading, isCapped, unavailable }: {
    data: ActivityHeatmapData; dark: boolean; loading: boolean; isCapped: boolean; unavailable: boolean;
}) {
    const approximate = data.features.some(feature => feature.properties.weight > 1);
    return (
        <section className={styles.legend} aria-label="Activity density legend">
            <details>
                <summary title="Explain relative density, coverage and approximate grouped locations">Activity density <span className={styles.hint}>Info</span></summary>
                <p>Relative density of loaded, filtered stories. Colors show reporting activity, not danger or risk.</p>
                <p>{approximate ? 'Grouped locations use approximate story counts, especially at low zoom.' : 'Each located event contributes once.'} Density changes with zoom and filters.</p>
                <p>Coverage can be incomplete, capped or stale. Tap a small dot or choose a sidebar story to inspect its representative event.</p>
            </details>
            <div className={styles.ramp} style={{ background: `linear-gradient(to right, ${ACTIVITY_COLORS[dark ? 'dark' : 'light'].join(', ')})` }} aria-hidden="true" />
            <div className={styles.scale}><span>Less</span><span>More</span></div>
            <p className={styles.status} role="status">{loading ? 'Updating displayed stories…' : unavailable ? 'Update unavailable; showing last loaded stories.' : data.features.length === 0 ? 'No located stories in the displayed data.' : `${data.features.length.toLocaleString()} displayed points${approximate ? ' · approximate' : ''}`}</p>
            {isCapped && <p className={styles.status}>Loaded result is capped.</p>}
        </section>
    );
}
