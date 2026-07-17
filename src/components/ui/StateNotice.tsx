'use client';

import type { ReactNode } from 'react';

import styles from './StateNotice.module.css';

export type StateNoticeVariant = 'loading' | 'error' | 'info';
export type StateNoticePlacement = 'overlay' | 'floating' | 'page';

interface StateNoticeProps {
    title: string;
    message?: ReactNode;
    variant?: StateNoticeVariant;
    placement?: StateNoticePlacement;
    actionLabel?: string;
    actionTitle?: string;
    onAction?: () => void;
    onDismiss?: () => void;
    dismissLabel?: string;
}

function NoticeIcon({ variant }: { variant: StateNoticeVariant }) {
    if (variant === 'loading') {
        return <span className={styles.spinner} aria-hidden="true" />;
    }

    if (variant === 'error') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.75v5" />
                <path d="M12 16.25h.01" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 7.75h.01" />
        </svg>
    );
}

export default function StateNotice({
    title,
    message,
    variant = 'info',
    placement = 'floating',
    actionLabel,
    actionTitle,
    onAction,
    onDismiss,
    dismissLabel = 'Dismiss notification',
}: StateNoticeProps) {
    const isError = variant === 'error';
    const placementClass = styles[placement];
    const variantClass = styles[variant];

    return (
        <div
            className={`${styles.viewport} ${placementClass}`}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            aria-busy={variant === 'loading' || undefined}
        >
            <div className={`${styles.notice} ${variantClass}`}>
                <span className={styles.icon}>
                    <NoticeIcon variant={variant} />
                </span>

                <div className={styles.copy}>
                    <p className={styles.title}>{title}</p>
                    {message && <p className={styles.message}>{message}</p>}
                </div>

                {actionLabel && onAction && (
                    <button
                        type="button"
                        className={styles.action}
                        onClick={onAction}
                        title={actionTitle ?? actionLabel}
                    >
                        {actionLabel}
                    </button>
                )}

                {onDismiss && (
                    <button
                        type="button"
                        className={styles.dismiss}
                        onClick={onDismiss}
                        title={dismissLabel}
                        aria-label={dismissLabel}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="m7 7 10 10M17 7 7 17" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
