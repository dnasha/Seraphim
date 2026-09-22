'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import StartupScreen from './StartupScreen';
import styles from './StartupScreen.module.css';

export type MapLoadState = 'loading' | 'ready' | 'error';

interface StartupGateProps {
    sessionReady: boolean;
    storiesReady: boolean;
    mapState: MapLoadState;
    hasError: boolean;
    children: ReactNode;
}

export default function StartupGate({ sessionReady, storiesReady, mapState, hasError, children }: StartupGateProps) {
    const [revealed, setRevealed] = useState(false);
    const [slow, setSlow] = useState(false);
    const [elapsedMs, setElapsedMs] = useState<number>();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const ready = sessionReady && storiesReady && mapState === 'ready';
    const failed = hasError || mapState === 'error';

    useEffect(() => {
        const dialog = dialogRef.current;
        if (revealed || !dialog?.showModal) return;
        // Upgrade the server-rendered open dialog to a modal so root-level UI
        // (including cookie choices) cannot receive focus behind the screen.
        dialog.close();
        dialog.showModal();
        return () => { dialog.close(); };
    }, [revealed]);

    useEffect(() => {
        if (revealed) return;
        const timer = setTimeout(() => setSlow(true), 8_000);
        return () => clearTimeout(timer);
    }, [revealed]);

    useEffect(() => {
        if (revealed || (!ready && !failed)) return;
        // Keep layout and WebGL mounted throughout startup. Allow the sidebar's
        // measurement/render pass to finish before revealing both surfaces.
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (ready) {
                    performance.mark?.('seraphim:ready');
                    performance.measure?.('seraphim:startup', { start: 0, end: 'seraphim:ready' });
                    setElapsedMs(Math.round(performance.now()));
                }
                setRevealed(true);
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [failed, ready, revealed]);

    const progress = ready ? 100 : 10 + (sessionReady ? 25 : 0) + (storiesReady ? 25 : 0) + (mapState === 'ready' ? 35 : 0);
    const message = !sessionReady ? 'Preparing your view' : !storiesReady ? 'Loading the latest stories' : 'Rendering the map';

    return (
        <>
            <div
                className={styles.content}
                data-revealed={revealed}
                data-startup-ms={elapsedMs}
                aria-hidden={!revealed}
                inert={!revealed}
            >
                {children}
            </div>
            {!revealed && (
                <dialog
                    ref={dialogRef}
                    open
                    className={styles.dialog}
                    aria-label="Loading Seraphim"
                    onCancel={(event) => { event.preventDefault(); setRevealed(true); }}
                >
                <StartupScreen
                    progress={progress}
                    message={ready ? 'Ready' : message}
                    onContinue={slow ? () => setRevealed(true) : undefined}
                />
                </dialog>
            )}
        </>
    );
}
