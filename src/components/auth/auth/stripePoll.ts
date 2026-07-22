import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';

export function useStripeCheckoutPoll(
    user: User | null,
    fetchUserTier: (userId: string | undefined, force?: boolean) => Promise<void>
) {
    useEffect(() => {
        if (typeof window === 'undefined' || !user?.id) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('checkout') !== 'success') return;

        // Checkout completed, so a later visit to pricing must not treat this
        // Session as abandoned and call the cancellation endpoint.
        window.sessionStorage.removeItem('seraphim.activeCheckoutIntent');

        let attempts = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;

        const poll = async () => {
            if (cancelled || attempts >= 5) return;
            attempts += 1;
            await fetchUserTier(user.id, true);
            if (!cancelled && attempts < 5) timer = setTimeout(poll, 3000);
        };

        timer = setTimeout(poll, 2000);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [user, fetchUserTier]);
}
