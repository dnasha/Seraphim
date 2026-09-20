'use client';

import { useEffect, useRef, useState } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import styles from '@/app/terms/LegalPage.module.css';

interface LegalContentsProps {
  sections: readonly { id: string; title: string }[];
}

export default function LegalContents({ sections }: LegalContentsProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');
  const sidebarRef = useRef<HTMLElement>(null);
  const desktopRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const scroller = sidebar?.closest<HTMLElement>('[data-legal-scroll]');
    const documentBody = scroller?.querySelector<HTMLElement>('main');
    if (!sidebar || !scroller || !documentBody) return;

    const headings = sections.flatMap(({ id }) => {
      const heading = document.getElementById(id);
      return heading && documentBody.contains(heading) ? [heading] : [];
    });
    if (!headings.length) return;

    let frame = 0;
    let lastActiveId = '';
    const update = () => {
      frame = 0;
      const clearance = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
      const readingTop = scroller.getBoundingClientRect().top + clearance + 1;
      let current = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > readingTop) break;
        current = heading;
      }

      // A short final section may never reach the top of the reading area.
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        current = headings[headings.length - 1];
      }
      if (current.id === lastActiveId) return;
      lastActiveId = current.id;
      setActiveId(current.id);

      // Keep the current link visible without moving the article or keyboard focus.
      const activeLink = desktopRef.current?.querySelector<HTMLAnchorElement>(`a[href="#${current.id}"]`);
      if (activeLink && activeLink.getClientRects().length) {
        const linkBounds = activeLink.getBoundingClientRect();
        const sidebarBounds = sidebar.getBoundingClientRect();
        if (linkBounds.top < sidebarBounds.top) sidebar.scrollTop += linkBounds.top - sidebarBounds.top - 8;
        else if (linkBounds.bottom > sidebarBounds.bottom) sidebar.scrollTop += linkBounds.bottom - sidebarBounds.bottom + 8;
      }
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroller);
    observer.observe(documentBody);
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      observer.disconnect();
    };
  }, [sections]);

  const contents = (
    <ol className={styles.contentsList}>
      {sections.map((section) => (
        <li key={section.id}>
          <a title={`Jump to ${section.title}`} href={`#${section.id}`} aria-current={activeId === section.id ? 'location' : undefined}>
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <aside className={styles.contents} ref={sidebarRef}>
      <nav className={styles.desktopContents} aria-label="On this page" ref={desktopRef}>
        <p className={styles.contentsTitle}>On this page</p>
        {contents}
        <a title="Return to the top of this document" className={styles.topLink} href="#legal-top">Back to top <span aria-hidden="true">↑</span></a>
      </nav>
      <details className={styles.mobileContents}>
        <summary>On this page <LuChevronDown className={styles.contentsChevron} size={16} aria-hidden="true" /></summary>
        <nav aria-label="On this page">{contents}</nav>
      </details>
    </aside>
  );
}
