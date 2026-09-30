import { useCallback, useEffect, useState } from 'react';

export const ACTIVITY_PREFERENCE_PREFIX = 'seraphim:experiment:activity-heatmap:v1:';
export function activityPreferenceKey(ownerId?: string) {
    return `${ACTIVITY_PREFERENCE_PREFIX}${ownerId ? `account:${ownerId}` : 'guest'}`;
}
const STORAGE_ERROR = 'Heatmap choice could not be saved on this device. It still works for this session.';
type Choice = { key: string; enabled: boolean; error: string | null };

export function useActivityHeatmapPreference(ownerId?: string) {
    const key = activityPreferenceKey(ownerId);
    const [choice, setChoice] = useState<Choice>({ key, enabled: false, error: null });
    useEffect(() => {
        let cancelled = false;
        const load = () => {
            if (cancelled) return;
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) { setChoice({ key, enabled: false, error: null }); return; }
                let parsed: unknown;
                try { parsed = raw.length <= 128 ? JSON.parse(raw) : null; } catch { parsed = null; }
                if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 1
                    && 'enabled' in parsed && typeof parsed.enabled === 'boolean' && Object.keys(parsed).length === 2) {
                    setChoice({ key, enabled: parsed.enabled, error: null });
                } else {
                    localStorage.removeItem(key);
                    setChoice({ key, enabled: false, error: 'Invalid saved heatmap choice was reset.' });
                }
            } catch { setChoice({ key, enabled: false, error: STORAGE_ERROR }); }
        };
        // Cancel pending hydration on account switch/unmount. Do not write defaults
        // during hydration or recreate preferences removed from another tab.
        const timer = setTimeout(load, 0);
        const onStorage = (event: StorageEvent) => {
            if (event.key === key || event.key === null) load();
        };
        window.addEventListener('storage', onStorage);
        return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('storage', onStorage); };
    }, [key]);

    const change = useCallback((enabled: boolean) => {
        let error = null;
        try { localStorage.setItem(key, JSON.stringify({ version: 1, enabled })); }
        catch { error = STORAGE_ERROR; }
        setChoice({ key, enabled, error });
    }, [key]);
    const reset = useCallback(() => {
        let error = null;
        try { localStorage.removeItem(key); } catch { error = STORAGE_ERROR; }
        setChoice({ key, enabled: false, error });
    }, [key]);

    // An account change hides the previous owner's preference immediately.
    return { enabled: choice.key === key && choice.enabled, error: choice.key === key ? choice.error : null, change, reset };
}
