'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuArrowRight, LuLayers } from 'react-icons/lu';
import { currentReturnPath, pricingHref } from '@/lib/upgradeNavigation';
import styles from './UpgradeActions.module.css';

export default function UpgradeLink({ className = '', returnTo }: { className?: string; returnTo?: string }) {
  const router = useRouter();
  const [href, setHref] = useState(pricingHref(returnTo ?? '/'));
  const currentHref = () => pricingHref(returnTo ?? currentReturnPath());
  const refreshHref = () => setHref(currentHref());

  return <Link
    href={href}
    className={`${styles.action} ${styles.primary} ${className}`}
    title="Compare Seraphim plans and advanced tools"
    onFocus={refreshHref}
    onPointerEnter={refreshHref}
    onPointerDown={refreshHref}
    onContextMenu={refreshHref}
    onClick={(event) => { event.currentTarget.href = currentHref(); }}
    onNavigate={(event) => { event.preventDefault(); router.push(currentHref()); }}
  ><LuLayers aria-hidden="true" /> View plans <LuArrowRight aria-hidden="true" /></Link>;
}
