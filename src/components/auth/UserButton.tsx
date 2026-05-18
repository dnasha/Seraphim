'use client';

/**
 * UserButton — Circular avatar button for auth state display.
 * 
 * Placement:
 * - When sidebar is OPEN: Renders in the sidebar header (next to ThemeToggle).
 * - When sidebar is COLLAPSED: Renders as a floating button on the map.
 * 
 * Behavior:
 * - Not logged in: Shows a generic user icon. Clicking opens the AuthModal.
 * - Logged in: Shows user avatar or initials. Clicking opens a dropdown
 *   with user info and sign-out button.
 */

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import styles from './UserButton.module.css';

interface UserButtonProps {
    /** Whether this instance is rendered inside the sidebar header */
    variant?: 'sidebar' | 'floating';
}

export default function UserButton({ variant = 'sidebar' }: UserButtonProps) {
    const { user, isLoading, isGuest, signOut, setShowAuthModal } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Click-outside handler to close dropdown
    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClick);
        };
    }, [menuOpen]);

    const handleClick = () => {
        if (user) {
            setMenuOpen(!menuOpen);
        } else {
            setShowAuthModal(true);
        }
    };

    // Extract user display info
    const avatarUrl = user?.user_metadata?.avatar_url;
    const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0];
    const initials = displayName
        ? displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
        : '?';

    if (isLoading) return null;

    const containerClass = variant === 'floating'
        ? styles.floatingContainer
        : styles.sidebarContainer;

    return (
        <div className={containerClass} ref={menuRef}>
            <button
                className={`${styles.userBtn} ${user ? styles.userBtnLoggedIn : ''}`}
                onClick={handleClick}
                aria-label={user ? `User account menu for ${displayName || 'User'}` : (isGuest ? 'Guest account menu: click to sign in' : 'Sign in to Seraphim')}
                title={user ? `Account: ${displayName || 'User'}` : (isGuest ? 'Guest Mode: Click to sign in' : 'Sign in')}
            >
                {user ? (
                    avatarUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={avatarUrl}
                            alt={displayName ? `Profile picture of ${displayName}` : 'User profile picture'}
                            className={styles.avatar}
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <span className={styles.initials}>{initials}</span>
                    )
                ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className={styles.userIcon}>
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                )}
                {isGuest && !user && (
                    <span className={styles.guestDot} />
                )}
            </button>

            {/* Dropdown Menu */}
            {menuOpen && user && (
                <div className={`${styles.dropdown} ${variant === 'floating' ? styles.dropdownFloating : ''}`}>
                    <div className={styles.dropdownHeader}>
                        {avatarUrl && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                                src={avatarUrl}
                                alt=""
                                className={styles.dropdownAvatar}
                                referrerPolicy="no-referrer"
                            />
                        )}
                        <div className={styles.dropdownInfo}>
                            <span className={styles.dropdownName}>{displayName}</span>
                            <span className={styles.dropdownEmail}>{user.email}</span>
                        </div>
                    </div>
                    <div className={styles.dropdownDivider} />
                    <Link href="/account" className={styles.dropdownItem} onClick={() => setMenuOpen(false)}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
                        </svg>
                        Account Settings
                    </Link>
                    <button
                        className={styles.dropdownItem}
                        onClick={async () => {
                            setMenuOpen(false);
                            await signOut();
                        }}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                        </svg>
                        Sign Out
                    </button>
                </div>
            )}
        </div>
    );
}
