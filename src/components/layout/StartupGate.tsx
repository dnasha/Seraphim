'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import StartupScreen from './StartupScreen';
import styles from './StartupScreen.module.css';

export type MapLoadState = 'loading' | 'ready' | 'error';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

interface StartupGateProps {
    sessionReady: boolean;
    storiesReady: boolean;
    mapState: MapLoadState;
    hasError: boolean;
    children: ReactNode;
}

export default function StartupGate({ sessionReady, storiesReady, mapState, hasError, children }: StartupGateProps) {
    // Auth can resolve before this subtree hydrates. Keep its first client render
    // identical to the server shell, then mount the map and sidebar behind it.
    const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
    const [revealed, setRevealed] = useState(false);
    const [slow, setSlow] = useState(false);
    const [elapsedMs, setElapsedMs] = useState<number>();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const ready = hydrated && sessionReady && storiesReady && mapState === 'ready';
    const failed = hydrated && (hasError || mapState === 'error');

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

    const progress = !hydrated ? 10 : ready ? 100 : 10 + (sessionReady ? 25 : 0) + (storiesReady ? 25 : 0) + (mapState === 'ready' ? 35 : 0);
    const message = !hydrated || !sessionReady ? 'Preparing your view' : !storiesReady ? 'Loading the latest stories' : 'Rendering the map';

    return (
        <>
            <div
                className={styles.content}
                data-revealed={revealed}
                data-startup-ms={elapsedMs}
                aria-hidden={!revealed}
                inert={!revealed}
            >
                {hydrated ? children : null}
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
