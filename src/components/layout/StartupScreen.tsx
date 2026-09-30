import styles from './StartupScreen.module.css';

interface StartupScreenProps {
    progress?: number;
    message?: string;
    onContinue?: () => void;
}

/** Shared by the server fallback and the hydrated startup gate. */
export default function StartupScreen({
    progress = 10,
    message = 'Preparing your view',
    onContinue,
}: StartupScreenProps) {
    return (
        <div className={styles.screen}>
            <div className={styles.panel}>
                <svg className={styles.emblem} viewBox="0 0 200 200" fill="none" aria-hidden="true">
                    <path
                        d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                        stroke="currentColor"
                        strokeWidth="12"
                    />
                    <g className={styles.eye}>
                        <path
                            d="M100 110.528L125 83.5281H75L100 110.528Z"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="12"
                        />
                    </g>
                </svg>
                <p className={styles.brand}>SERAPHIM</p>
                <p className={styles.tagline}>Know the world as it happens!</p>
                <div
                    className={styles.track}
                    role="progressbar"
                    aria-label="Loading Seraphim"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-valuetext={message}
                >
                    <div className={styles.fill} style={{ width: `${progress}%` }} />
                </div>
                <p className={styles.message} role="status">{message}</p>
                {onContinue && (
                    <div className={styles.slowConnection}>
                        <p>Taking longer than usual. You can browse while loading continues.</p>
                        <button onClick={onContinue} title="Open available content while loading continues">Open available content</button>
                    </div>
                )}
            </div>
        </div>
    );
}
