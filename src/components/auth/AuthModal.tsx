'use client';

/**
 * AuthModal — Premium glassmorphism login/signup modal for Seraphim.
 * 
 * Features:
 * - Tab-based Login / Sign Up views with email + password
 * - OAuth buttons for Google, GitHub, and Discord
 * - "Continue as Guest" button (guests are limited to 7 events, no filters)
 * - Glassmorphism backdrop with smooth fade-in animation
 * - Matches Seraphim's design system (indigo accent, radius tokens, dark mode)
 */

import React, { useState, useCallback, useRef } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useAuth } from '@/hooks/useAuth';
import styles from './AuthModal.module.css';

type AuthTab = 'login' | 'signup' | 'reset';

export default function AuthModal() {
    const { showAuthModal, setShowAuthModal, supabase, continueAsGuest } = useAuth();
    const [activeTab, setActiveTab] = useState<AuthTab>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const turnstileRef = useRef<TurnstileInstance>(null);

    const handleEmailAuth = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setLoading(true);

        try {
            if (activeTab === 'reset') {
                const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/auth/callback?next=/account`,
                    captchaToken: captchaToken || undefined,
                });
                if (resetError) throw resetError;
                setSuccess('Check your email for a password reset link.');
                turnstileRef.current?.reset();
            } else if (activeTab === 'signup') {
                const { error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/auth/callback`,
                        captchaToken: captchaToken || undefined,
                    },
                });
                if (signUpError) throw signUpError;
                setSuccess('Check your email for a confirmation link.');
                turnstileRef.current?.reset();
            } else {
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                    options: {
                        captchaToken: captchaToken || undefined,
                    }
                });
                if (signInError) throw signInError;
                // Auth state change listener in AuthProvider will handle the rest
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            turnstileRef.current?.reset();
        } finally {
            setLoading(false);
        }
    }, [activeTab, email, password, supabase, captchaToken]);

    const handleOAuth = useCallback(async (provider: 'google' | 'github' | 'discord') => {
        setError(null);
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (oauthError) {
            setError(oauthError.message);
        }
    }, [supabase]);

    if (!showAuthModal) return null;

    return (
        <div className={styles.overlay} onClick={() => setShowAuthModal(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Logo — matches sidebar header: inline icon + title */}
                <div className={styles.logoSection}>
                    <div className={styles.logoInline}>
                        <svg
                            className={styles.logo}
                            width="200"
                            height="200"
                            viewBox="0 0 200 200"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M100 110.528L125 83.5281H75L100 110.528Z"
                                fill="var(--accent)"
                            />
                            <path
                                d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                                stroke="var(--accent)"
                                strokeWidth="12"
                            />
                            <path
                                d="M100 110.528L125 83.5281H75L100 110.528Z"
                                stroke="var(--accent)"
                                strokeWidth="12"
                            />
                        </svg>
                        <h2 className={styles.logoTitle}>Seraphim</h2>
                    </div>
                    <p className={styles.logoSubtitle}>Real-time global intelligence</p>
                </div>

                {/* Tabs - Only show when not resetting password */}
                {activeTab !== 'reset' && (
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${activeTab === 'login' ? styles.tabActive : ''}`}
                            onClick={() => { setActiveTab('login'); setError(null); setSuccess(null); }}
                        >
                            Log In
                        </button>
                        <button
                            className={`${styles.tab} ${activeTab === 'signup' ? styles.tabActive : ''}`}
                            onClick={() => { setActiveTab('signup'); setError(null); setSuccess(null); }}
                        >
                            Sign Up
                        </button>
                    </div>
                )}
                {/* OAuth Buttons - Only show when not resetting password */}
                {activeTab !== 'reset' && (
                    <>
                        <div className={styles.oauthSection}>
                            <button
                                className={`${styles.oauthBtn} ${styles.oauthGoogle}`}
                                onClick={() => handleOAuth('google')}
                                type="button"
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>
                            <button
                                className={`${styles.oauthBtn} ${styles.oauthGithub}`}
                                onClick={() => handleOAuth('github')}
                                type="button"
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                                Continue with GitHub
                            </button>
                            <button
                                className={`${styles.oauthBtn} ${styles.oauthDiscord}`}
                                onClick={() => handleOAuth('discord')}
                                type="button"
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
                                </svg>
                                Continue with Discord
                            </button>
                        </div>
                        <div className={styles.divider}>
                            <span>or</span>
                        </div>
                    </>
                )}

                {/* Email/Password Form */}
                <form onSubmit={handleEmailAuth} className={styles.form}>
                    <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={styles.input}
                        required
                        autoComplete="email"
                    />
                    {activeTab !== 'reset' && (
                        <>
                            <input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={styles.input}
                                required
                                autoComplete={activeTab === 'signup' ? 'new-password' : 'current-password'}
                                minLength={6}
                            />
                            {activeTab === 'login' && (
                                <button
                                    type="button"
                                    className={styles.forgotPasswordBtn}
                                    onClick={() => { setActiveTab('reset'); setError(null); setSuccess(null); }}
                                >
                                    Forgot Password?
                                </button>
                            )}
                        </>
                    )}

                    {error && <div className={styles.errorMsg}>{error}</div>}
                    {success && <div className={styles.successMsg}>{success}</div>}

                    {/* Cloudflare Turnstile Captcha */}
                    <div className={styles.captchaContainer}>
                        <Turnstile
                            ref={turnstileRef}
                            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
                            onSuccess={(token) => setCaptchaToken(token)}
                            onExpire={() => setCaptchaToken(null)}
                            onError={() => setCaptchaToken(null)}
                            options={{
                                theme: 'dark',
                                size: 'normal',
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        className={styles.submitBtn}
                        disabled={loading}
                    >
                        {loading ? (
                            <span className={styles.btnSpinner} />
                        ) : (
                            activeTab === 'reset' ? 'Send Reset Link' :
                            activeTab === 'login' ? 'Log In' : 'Create Account'
                        )}
                    </button>

                    {activeTab === 'reset' && (
                        <button
                            type="button"
                            className={styles.backToLoginBtn}
                            onClick={() => { setActiveTab('login'); setError(null); setSuccess(null); }}
                        >
                            Back to Login
                        </button>
                    )}
                </form>

                {/* Guest Button */}
                <button
                    className={styles.guestBtn}
                    onClick={continueAsGuest}
                    type="button"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                    Continue as Guest
                </button>

                <p className={styles.guestNote}>
                    Guest access is limited to 7 events with no filter controls.
                </p>
            </div>
        </div>
    );
}
