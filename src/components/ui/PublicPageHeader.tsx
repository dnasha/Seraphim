import Link from 'next/link';

import ThemeToggle from '@/components/ui/ThemeToggle';
import styles from './PublicPageHeader.module.css';

interface PublicPageHeaderProps {
  backHref?: string;
  backTitle?: string;
}

export default function PublicPageHeader({
  backHref = '/',
  backTitle = 'Return to the live intelligence map',
}: PublicPageHeaderProps) {
  return (
    <header className={styles.header}>
      <Link href={backHref} className={styles.backLink} aria-label="Go back" title={backTitle}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </Link>

      <Link href="/" className={styles.brandLink} aria-label="SERAPHIM home" title="Return to the Seraphim home page">
        <svg className={styles.logo} viewBox="0 0 200 200" fill="none" aria-hidden="true">
          <path className={styles.logoFill} d="M100 110.528L125 83.5281H75L100 110.528Z" />
          <path className={styles.logoStroke} d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z" strokeWidth="12" />
          <path className={styles.logoStroke} d="M100 110.528L125 83.5281H75L100 110.528Z" strokeWidth="12" />
        </svg>
        <span className={styles.brandName}>SERAPHIM</span>
      </Link>

      <div className={styles.actions}>
        <ThemeToggle />
      </div>
    </header>
  );
}
