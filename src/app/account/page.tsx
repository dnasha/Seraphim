'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuArrowUpRight, LuChevronDown, LuCreditCard, LuMail, LuShieldCheck, LuTriangleAlert, LuCopy, LuCheck, LuUserRound } from 'react-icons/lu';
import { useAuth } from '@/hooks/useAuth';
import { useUserTier } from '@/hooks/useUserTier';
import TierBadge from '@/components/ui/TierBadge';
import AuthModal from '@/components/auth/AuthModal';
import PublicPageHeader from '@/components/ui/PublicPageHeader';
import styles from './AccountPage.module.css';
import { trackOptionalMetric } from '@/lib/privacyConsent';
import { getSubscriptionStatusLabel } from './billingPresentation';

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
  useEffect(() => { void trackOptionalMetric('account_view'); }, []);
  const { user, isLoading, supabase, signOut, setShowAuthModal } = useAuth();
  const router = useRouter();

  const [emailMsg, setEmailMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [passMsg, setPassMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isUpdatingPass, setIsUpdatingPass] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isVerifyingDeletion, setIsVerifyingDeletion] = useState(false);
  const [requiresDeletionReauth, setRequiresDeletionReauth] = useState(false);
  const [isManagingBilling, setIsManagingBilling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const deletionRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (user && new URLSearchParams(window.location.search).get('reauth') === 'delete') {
      deletionRef.current?.setAttribute('open', '');
    }
  }, [user]);

  const handleCopyUserId = async () => {
    if (!user?.id) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  const { tier: userTier, isLoading: tierLoading, subscriptionStatus, billingInterval, currentPeriodEnd, trialEndsAt, cancelAtPeriodEnd, angelStatus } = useUserTier();

  if (isLoading) {
    return <AccountShell><div className={styles.loading} role="status"><span className={styles.spinner} /> Loading your account…</div></AccountShell>;
  }

  if (!user) {
    return (
      <AccountShell>
        <section className={`${styles.section} ${styles.guestSection}`}>
          <div className={styles.guestIcon}><LuUserRound size={28} aria-hidden="true" /></div>
          <TierBadge tier="guest" size="md" />
          <h2>Make yourself at home</h2>
          <p className={styles.helperText}>You’re exploring as a guest. Sign in or create a free account to manage your profile and plan.</p>
          <button className={styles.button} onClick={() => setShowAuthModal(true)}>Sign in or create an account <LuArrowUpRight aria-hidden="true" /></button>
          <Link href="/" className={styles.link}>Continue exploring the map</Link>
        </section>
        <AuthModal />
      </AccountShell>
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

    if (newPassword !== confirmPassword) {
      setPassMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsUpdatingPass(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPassMsg({ type: 'success', text: 'Password updated successfully.' });
      setNewPassword('');
      setConfirmPassword('');
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
        const data = await res.json() as { code?: string; error?: string };
        if (data.code === 'reauth_required') {
          setRequiresDeletionReauth(true);
          setDeleteMsg({
            type: 'error',
            text: 'Your session is too old for this sensitive action. Re-authenticate by email, then submit the deletion again within 10 minutes.',
          });
          return;
        }
        throw new Error(data.error || 'Failed to delete account.');
      }
      setRequiresDeletionReauth(false);
      await signOut();
      router.push('/');
    } catch (err: unknown) {
      setDeleteMsg({ type: 'error', text: err instanceof Error ? err.message : 'An unknown error occurred.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const sendDeletionVerification = async () => {
    if (!user?.email) {
      setDeleteMsg({ type: 'error', text: 'This account does not have a verified email address.' });
      return;
    }
    setIsVerifyingDeletion(true);
    setDeleteMsg(null);
    try {
      const next = encodeURIComponent('/account?reauth=delete');
      const { error } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}`,
        },
      });
      if (error) throw error;
      setDeleteMsg({
        type: 'success',
        text: 'Reauthentication link sent. Open it in this browser, then submit the deletion again within 10 minutes.',
      });
    } catch {
      setDeleteMsg({ type: 'error', text: 'Unable to send the verification link. Please try again.' });
    } finally {
      setIsVerifyingDeletion(false);
    }
  };


  const handleManageBilling = async () => {
    setIsManagingBilling(true);
    setBillingError(null);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open billing. Please try again.');
      window.location.href = data.url;
    } catch (err: unknown) {
      setBillingError(err instanceof Error ? err.message : 'Unable to open billing. Please try again.');
    } finally {
      setIsManagingBilling(false);
    }
  };

  const avatarUrl = user.user_metadata?.avatar_url;
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name;
  const provider = user.app_metadata?.provider || 'email';
  const providerName = ({ email: 'Email and password', google: 'Google', github: 'GitHub', discord: 'Discord' } as Record<string, string>)[provider] || provider;
  const subscriptionStatusLabel = getSubscriptionStatusLabel(userTier, subscriptionStatus);
  const isLifetime = userTier === 'angel';
  const passwordMismatch = !!confirmPassword && newPassword !== confirmPassword;

  return (
    <AccountShell>
      <section className={`${styles.section} ${styles.profileSection}`} aria-label="Your profile">
        <div className={styles.profileRow}>
          <div className={styles.avatar}>
            {avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : <LuUserRound size={26} aria-hidden="true" />}
          </div>
          <div className={styles.profileInfo}>
            <h2 className={styles.profileName}>{displayName || user.email}</h2>
            {displayName && <p className={styles.profileEmail}>{user.email}</p>}
            <span className={styles.profileProvider}><ProviderIcon provider={provider} /> {providerName}</span>
          </div>
        </div>
        {!tierLoading && <TierBadge tier={userTier} size="md" />}
      </section>

      <div className={styles.accountGrid}>
        <section className={`${styles.section} ${styles.planSection}`} aria-labelledby="plan-title">
          <div className={styles.sectionHeading}>
            <LuCreditCard size={19} aria-hidden="true" />
            <h2 id="plan-title" className={styles.sectionTitle}>Your plan</h2>
          </div>
          {tierLoading ? <p className={styles.helperText} role="status">Loading your plan…</p> : (
            <>
              <div>
                <div className={styles.planTitleRow}>
                  <h3 className={styles.planName} data-tier={userTier}>{userTier === 'angel' ? 'Angel' : userTier === 'analyst' ? 'Analyst' : userTier === 'pro' ? 'Pro' : 'Free'}</h3>
                  {subscriptionStatusLabel && <span className={styles.statusBadge}>{subscriptionStatusLabel}</span>}
                </div>
                <p className={styles.helperText}>
                  {userTier === 'angel' ? 'Thank you for being a founding supporter.' : userTier === 'free' ? 'Your everyday view of the global signal.' : 'More tools to follow the stories that matter.'}
                </p>
              </div>
              <dl className={styles.planFacts}>
                <div><dt>Access</dt><dd>{isLifetime ? 'Lifetime access' : userTier === 'free' ? 'Free account' : 'Subscription'}</dd></div>
                <div><dt>Billing</dt><dd>{isLifetime ? 'One-time payment · no renewals' : userTier === 'free' ? 'No subscription' : billingInterval === 'year' ? 'Yearly' : billingInterval === 'month' ? 'Monthly' : 'See billing portal'}</dd></div>
                {!isLifetime && trialEndsAt && subscriptionStatus === 'trialing' && <div><dt>Trial ends</dt><dd>{new Date(trialEndsAt).toLocaleDateString()}</dd></div>}
                {!isLifetime && currentPeriodEnd && (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') && (
                  <div><dt>{cancelAtPeriodEnd ? 'Access ends' : 'Next renewal'}</dt><dd>{new Date(currentPeriodEnd).toLocaleDateString()}</dd></div>
                )}
              </dl>
              {angelStatus === 'dispute_pending' && <p className={`${styles.message} ${styles.error}`} role="status">Angel access is suspended while the payment is under review. <a href="mailto:support@seraphi.me">Contact support</a> for help.</p>}
              {angelStatus === 'revoked' && <p className={`${styles.message} ${styles.error}`} role="status">Angel access ended after a refund or payment dispute. <a href="mailto:support@seraphi.me">Contact support</a> with questions.</p>}
              <div className={styles.buttonGroup}>
                {userTier === 'free' ? (
                  <Link className={styles.button} href="/pricing?returnTo=%2Faccount">Explore plans <LuArrowUpRight aria-hidden="true" /></Link>
                ) : (
                  <>
                    <button className={`${styles.button} ${styles.buttonSecondary}`} disabled={isManagingBilling} onClick={handleManageBilling}>
                      {isManagingBilling && <span className={styles.spinner} aria-hidden="true" />}
                      {isManagingBilling ? 'Opening billing…' : isLifetime ? 'View billing history' : 'Manage billing'}
                      {!isManagingBilling && <LuArrowUpRight aria-hidden="true" />}
                    </button>
                    {!isLifetime && <Link className={styles.link} href="/pricing?returnTo=%2Faccount">Compare plans</Link>}
                  </>
                )}
              </div>
              {billingError && <p className={`${styles.message} ${styles.error}`} role="alert">{billingError}</p>}
              {userTier === 'angel' && (
                <div className={styles.founderNote}>
                  <h3>Claim your Founder role</h3>
                  <p className={styles.helperText}>Join our Discord, then email support from your account address to get your Angel Founder role.</p>
                  <div className={styles.buttonGroup}>
                    <a className={styles.link} href="https://discord.gg/rqaBsXkFmY" target="_blank" rel="noopener noreferrer">Join Discord <LuArrowUpRight aria-hidden="true" /></a>
                    <a className={styles.link} href="mailto:support@seraphi.me">Email support <LuArrowUpRight aria-hidden="true" /></a>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className={`${styles.section} ${styles.securitySection}`} aria-labelledby="security-title">
          <div className={styles.sectionHeading}>
            <LuShieldCheck size={19} aria-hidden="true" />
            <h2 id="security-title" className={styles.sectionTitle}>Sign-in & security</h2>
          </div>
          <p className={styles.helperText}>Manage how you access your account.</p>
          {provider === 'email' ? (
            <details className={styles.setting}>
              <summary className={styles.settingSummary}>
                <span><span className={styles.settingTitle}>Email address</span><span className={styles.settingDescription}>{user.email}</span></span>
                <LuChevronDown className={styles.chevron} aria-hidden="true" />
              </summary>
              <form onSubmit={handleUpdateEmail} className={styles.formGroup}>
                <p id="email-help" className={styles.helperText}>We’ll send confirmation links to your current and new email addresses.</p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="account-email">New email address</label>
                  <input id="account-email" type="email" autoComplete="email" aria-describedby="email-help" className={styles.input} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required placeholder="you@example.com" disabled={isUpdatingEmail} />
                </div>
                {emailMsg && <div className={`${styles.message} ${styles[emailMsg.type]}`} role={emailMsg.type === 'error' ? 'alert' : 'status'}>{emailMsg.text}</div>}
                <button type="submit" className={styles.button} disabled={isUpdatingEmail || !newEmail.trim() || newEmail.trim() === user.email}>
                  {isUpdatingEmail ? 'Sending confirmation…' : 'Update email'}
                </button>
              </form>
            </details>
          ) : (
            <div className={styles.setting}>
              <div className={styles.providerSetting}><span className={styles.settingTitle}>Email address</span><span className={styles.settingDescription}>{user.email}</span></div>
              <p className={styles.helperText}>Managed by {providerName}. Change your email in your provider’s settings.</p>
            </div>
          )}
          <details className={styles.setting}>
            <summary className={styles.settingSummary}>
              <span><span className={styles.settingTitle}>{provider === 'email' ? 'Password' : 'Add a password'}</span><span className={styles.settingDescription}>{provider === 'email' ? 'Change your account password' : 'Enable email and password sign-in'}</span></span>
              <LuChevronDown className={styles.chevron} aria-hidden="true" />
            </summary>
            <form onSubmit={handleUpdatePassword} className={styles.formGroup}>
              <p id="password-help" className={styles.helperText}>{provider === 'email' ? 'Use at least 6 characters.' : `Set a password to sign in with your email as well as ${providerName}. Use at least 6 characters.`}</p>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="account-password">New password</label>
                <input id="account-password" type="password" autoComplete="new-password" aria-describedby="password-help" className={styles.input} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} disabled={isUpdatingPass} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="account-password-confirm">Confirm new password</label>
                <input id="account-password-confirm" type="password" autoComplete="new-password" aria-invalid={passwordMismatch} aria-describedby={passwordMismatch ? 'password-mismatch' : undefined} className={styles.input} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} disabled={isUpdatingPass} />
                {passwordMismatch && <p id="password-mismatch" className={styles.validationText} role="status">Passwords don’t match yet.</p>}
              </div>
              {passMsg && <div className={`${styles.message} ${styles[passMsg.type]}`} role={passMsg.type === 'error' ? 'alert' : 'status'}>{passMsg.text}</div>}
              <button type="submit" className={styles.button} disabled={isUpdatingPass || newPassword.length < 6 || !confirmPassword || passwordMismatch}>{isUpdatingPass ? 'Saving password…' : 'Save password'}</button>
            </form>
          </details>
          <details className={styles.setting}>
            <summary className={styles.settingSummary}>
              <span><span className={styles.settingTitle}>Account ID</span><span className={styles.settingDescription}>For help from our support team</span></span>
              <LuChevronDown className={styles.chevron} aria-hidden="true" />
            </summary>
            <div className={styles.userIdRow}>
              <code>{user.id}</code>
              <button onClick={handleCopyUserId} className={styles.copyBtn} aria-label="Copy account ID">{copied ? <LuCheck aria-hidden="true" /> : <LuCopy aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</button>
            </div>
            {copyError && <p className={styles.helperText} role="alert">Couldn’t copy. Select the account ID above to copy it manually.</p>}
            <span className={styles.srOnly} role="status">{copied ? 'Account ID copied' : ''}</span>
          </details>
        </section>
      </div>

      <details className={`${styles.section} ${styles.dangerSection}`} ref={deletionRef}>
        <summary className={styles.settingSummary}>
          <span><span className={styles.settingTitle}>Delete account</span><span className={styles.settingDescription}>Permanently remove your account and application data.</span></span>
          <LuChevronDown className={styles.chevron} aria-hidden="true" />
        </summary>
        <form onSubmit={handleDeleteAccount} className={styles.formGroup}>
          <p id="delete-help" className={styles.helperText}><LuTriangleAlert className={styles.warningIcon} aria-hidden="true" /> This cannot be undone. Active billing is canceled immediately without an automatic refund; legally required financial records remain with Stripe.</p>
          {requiresDeletionReauth && (
            <div className={styles.formGroup}>
              <p className={styles.helperText}>Confirm you still control this account. We’ll email you a one-time sign-in link.</p>
              <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={sendDeletionVerification} disabled={isVerifyingDeletion || isDeleting}>{isVerifyingDeletion ? 'Sending verification…' : 'Verify by email'}</button>
            </div>
          )}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="account-delete">Type FAREWELL to confirm</label>
            <input id="account-delete" type="text" autoComplete="off" aria-describedby="delete-help" className={styles.input} value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} required pattern="FAREWELL" disabled={isDeleting} />
          </div>
          {deleteMsg && <div className={`${styles.message} ${styles[deleteMsg.type]}`} role={deleteMsg.type === 'error' ? 'alert' : 'status'}>{deleteMsg.text}</div>}
          <button type="submit" className={`${styles.button} ${styles.dangerButton}`} disabled={isDeleting || deleteConfirm !== 'FAREWELL'}>{isDeleting ? 'Deleting account…' : 'Permanently delete account'}</button>
        </form>
      </details>
      <p className={styles.supportNote}><LuMail aria-hidden="true" /> Need a hand? <a className={styles.link} href="mailto:support@seraphi.me">Contact support</a></p>
    </AccountShell>
  );
}

function AccountShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <PublicPageHeader />
      <div className={styles.content}>
        <main className={styles.main}>
          <div className={styles.pageHeading}><h1>Your account</h1><p>Profile, plan, and sign-in settings. All in one place.</p></div>
          {children}
        </main>
        <footer className={styles.footer}>
          <span>© {new Date().getFullYear()} Seraphim</span>
          <div className={styles.footerLinks}><Link href="/terms?from=account">Terms of Service</Link><Link href="/privacy?from=account">Privacy Policy</Link></div>
        </footer>
      </div>
    </div>
  );
}
