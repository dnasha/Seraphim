export interface PwaDismissal {
  pwaDismissCount: number;
  pwaLastDismissedAt: number;
}

export const PWA_DISMISS_LIMIT = 2;
export const PWA_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function sanitizePwaDismissal(value: Partial<PwaDismissal>): PwaDismissal {
  return {
    pwaDismissCount: typeof value.pwaDismissCount === 'number' && Number.isFinite(value.pwaDismissCount)
      ? Math.min(PWA_DISMISS_LIMIT, Math.max(0, Math.floor(value.pwaDismissCount))) : 0,
    pwaLastDismissedAt: typeof value.pwaLastDismissedAt === 'number' && Number.isFinite(value.pwaLastDismissedAt)
      ? Math.max(0, value.pwaLastDismissedAt) : 0,
  };
}

export function mergePwaDismissals(...values: Partial<PwaDismissal>[]): PwaDismissal {
  const normalized = values.map(sanitizePwaDismissal);
  return {
    pwaDismissCount: Math.max(0, ...normalized.map(value => value.pwaDismissCount)),
    pwaLastDismissedAt: Math.max(0, ...normalized.map(value => value.pwaLastDismissedAt)),
  };
}

const storageKey = (userId: string | null) => `seraphim_pwa_preference:${userId ?? 'guest'}`;

export function readPwaDismissal(userId: string | null): PwaDismissal {
  try {
    const saved = localStorage.getItem(storageKey(userId));
    if (saved) return sanitizePwaDismissal(JSON.parse(saved) ?? {});
    // The old implementation only recorded the most recent dismissal.
    const legacyTime = Number(localStorage.getItem('seraphim_pwa_dismissed'));
    return sanitizePwaDismissal({
      pwaDismissCount: Number.isFinite(legacyTime) && legacyTime > 0 ? 1 : 0,
      pwaLastDismissedAt: legacyTime,
    });
  } catch {
    return sanitizePwaDismissal({});
  }
}

export function writePwaDismissal(userId: string | null, value: PwaDismissal) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(value));
  } catch {
    // Account persistence and in-memory suppression still work without storage.
  }
}
