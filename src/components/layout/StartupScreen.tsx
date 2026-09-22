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
                <div className={styles.emblem} aria-hidden="true">
                    <span /><span /><span />
                </div>
                <p className={styles.brand}>SERAPHIM</p>
                <p className={styles.tagline}>The world, in view.</p>
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
