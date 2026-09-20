import type { ReactNode } from 'react';
import Link from 'next/link';
import PublicPageHeader from '@/components/ui/PublicPageHeader';
import LegalContents from '@/components/ui/LegalContents';
import styles from '@/app/terms/LegalPage.module.css';

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  policyVersion: string;
  currentPage: 'privacy' | 'terms';
  sections: readonly { id: string; title: string }[];
  children: ReactNode;
}

export default function LegalPageLayout({
  title, effectiveDate, policyVersion, currentPage, sections, children,
}: LegalPageLayoutProps) {
  return (
    <div className={styles.pageWrapper} data-legal-scroll>
      <PublicPageHeader />
      <div className={styles.container} id="legal-top">
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.subtitle}>Effective: {effectiveDate} · Version {policyVersion}</p>
          </div>
          <nav className={styles.documentTabs} aria-label="Legal documents">
            <Link href="/privacy" aria-current={currentPage === 'privacy' ? 'page' : undefined}>Privacy Policy</Link>
            <Link href="/terms" aria-current={currentPage === 'terms' ? 'page' : undefined}>Terms of Service</Link>
          </nav>
        </header>
        <div className={styles.readingLayout}>
          <LegalContents sections={sections} />
          <main id="legal-document" className={styles.document}>
            {children}
          </main>
        </div>
        <footer className={styles.footer}>
          <Link href={currentPage === 'privacy' ? '/terms' : '/privacy'}>
            {currentPage === 'privacy' ? 'Terms of Service' : 'Privacy Policy'}
            <span aria-hidden="true"> →</span>
          </Link>
          <a href="#legal-top">Back to top <span aria-hidden="true">↑</span></a>
        </footer>
      </div>
    </div>
  );
}
