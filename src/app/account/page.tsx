'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import ThemeToggle from '@/components/ui/ThemeToggle';
import styles from './AccountPage.module.css';

const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider) {
    case 'google':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
      );
    case 'github':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.0777.0777 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
          <polyline points="22,6 12,13 2,6"></polyline>
        </svg>
      );
  }
};

export default function AccountPage() {
  const { user, isLoading, supabase, signOut } = useAuth();
  const router = useRouter();

  const [emailMsg, setEmailMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [passMsg, setPassMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<{ type: 'error', text: string } | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isUpdatingPass, setIsUpdatingPass] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className={styles.container}>
        <div style={{ margin: 'auto' }}><span className={styles.spinner} style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent', width: '32px', height: '32px' }} /></div>
      </div>
    );
  }

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMsg(null);
    setIsUpdatingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      setEmailMsg({ type: 'success', text: 'Confirmation emails sent to both old and new addresses. Please check your inbox.' });
      setNewEmail('');
    } catch (err: unknown) {
      setEmailMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update email.' });
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    setIsUpdatingPass(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPassMsg({ type: 'success', text: 'Password updated successfully.' });
      setNewPassword('');
    } catch (err: unknown) {
      setPassMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update password.' });
    } finally {
      setIsUpdatingPass(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirm !== 'FAREWELL') {
      setDeleteMsg({ type: 'error', text: 'Please type FAREWELL to confirm.' });
      return;
    }
    setDeleteMsg(null);
    setIsDeleting(true);
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete account.');
      }
      await signOut();
      router.push('/');
    } catch (err: unknown) {
      setDeleteMsg({ type: 'error', text: err instanceof Error ? err.message : 'An unknown error occurred.' });
      setIsDeleting(false);
    }
  };

  const avatarUrl = user.user_metadata?.avatar_url;
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name;
  const provider = user.app_metadata?.provider || 'email';

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button onClick={() => router.push('/')} className={styles.backBtn} aria-label="Go back">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
          </div>

          <div className={styles.headerCenter}>
            <svg
              className={styles.logoImg}
              width="200"
              height="200"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ height: "2.5rem", width: "auto" }}
            >
              <path
                className={styles.logoFill}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
              />
              <path
                className={styles.logoStroke}
                d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                strokeWidth="12"
              />
              <path
                className={styles.logoStroke}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
                strokeWidth="12"
              />
            </svg>
            <h1 className={styles.logoTitle}>Seraphim - Account</h1>
          </div>

          <div className={styles.headerRight}>
            <ThemeToggle />
          </div>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Profile Information</h2>
          <div className={styles.profileRow}>
            <div className={styles.avatar}>
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatarUrl} alt="Avatar" referrerPolicy="no-referrer" />
              ) : (
                <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              )}
            </div>
            <div className={styles.profileInfo}>
              <span className={styles.profileEmail}>{displayName || user.email}</span>
              <div className={styles.profileProvider}>
                <ProviderIcon provider={provider} />
                <span>Signed in via {provider}</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Update Email</h2>
          <form onSubmit={handleUpdateEmail} className={styles.formGroup}>
            <label className={styles.label}>New Email Address</label>
            <input 
              type="email" 
              className={styles.input} 
              value={newEmail} 
              onChange={(e) => setNewEmail(e.target.value)} 
              required 
              placeholder="Enter new email"
              disabled={isUpdatingEmail}
            />
            {emailMsg && <div className={`${styles.message} ${styles[emailMsg.type]}`}>{emailMsg.text}</div>}
            <button type="submit" className={styles.button} disabled={isUpdatingEmail || !newEmail}>
              {isUpdatingEmail ? <span className={styles.spinner} /> : 'Update Email'}
            </button>
          </form>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Update Password</h2>
          <form onSubmit={handleUpdatePassword} className={styles.formGroup}>
            <label className={styles.label}>New Password</label>
            <input 
              type="password" 
              className={styles.input} 
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
              required 
              minLength={6}
              placeholder="Enter new password"
              disabled={isUpdatingPass}
            />
            {passMsg && <div className={`${styles.message} ${styles[passMsg.type]}`}>{passMsg.text}</div>}
            <button type="submit" className={styles.button} disabled={isUpdatingPass || !newPassword}>
              {isUpdatingPass ? <span className={styles.spinner} /> : 'Update Password'}
            </button>
          </form>
        </section>

        <section className={`${styles.section} ${styles.dangerSection}`}>
          <div className={styles.sectionHeader}>
            <h2 className={`${styles.sectionTitle} ${styles.dangerTitle}`}>Danger Zone</h2>
            <p className={styles.dangerText}>
              Permanently obliterate your account and all associated intelligence data. This action is irreversible.
            </p>
          </div>
          <form onSubmit={handleDeleteAccount} className={styles.formGroup}>
            <label className={styles.label}>Type &quot;FAREWELL&quot; to confirm</label>
            <input 
              type="text" 
              className={styles.input} 
              value={deleteConfirm} 
              onChange={(e) => setDeleteConfirm(e.target.value)} 
              required 
              placeholder="FAREWELL"
              pattern="FAREWELL"
              disabled={isDeleting}
            />
            {deleteMsg && <div className={`${styles.message} ${styles[deleteMsg.type]}`}>{deleteMsg.text}</div>}
            <button type="submit" className={`${styles.button} ${styles.dangerButton}`} disabled={isDeleting || deleteConfirm !== 'FAREWELL'}>
              {isDeleting ? <span className={styles.spinner} /> : 'Erase Account'}
            </button>
          </form>
        </section>

      </div>
    </div>
  );
}
