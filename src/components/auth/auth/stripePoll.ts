import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserTier } from '@/components/ui/TierBadge';

export function useStripeCheckoutPoll(
    user: User | null,
    fetchUserTier: (userId: string | undefined, force?: boolean) => Promise<UserTier | undefined>
) {
    useEffect(() => {
        if (typeof window === 'undefined' || !user?.id) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('checkout') !== 'success') return;

        // Checkout completed, so a later visit to pricing must not treat this
        // Session as abandoned and call the cancellation endpoint.
        window.sessionStorage.removeItem('seraphim.activeCheckoutIntent');
        const expectedTier = params.get('checkoutPlan');
        const hasExpectedTier = expectedTier === 'pro' || expectedTier === 'analyst' || expectedTier === 'angel';

        let attempts = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;

        const poll = async () => {
            if (cancelled || attempts >= 5) return;
            attempts += 1;
            const tier = await fetchUserTier(user.id, true);
            if (hasExpectedTier && tier === expectedTier) {
                params.delete('checkout');
                params.delete('checkoutPlan');
                const query = params.toString();
                window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
                return;
            }
            if (!cancelled && attempts < 5) timer = setTimeout(poll, 3000);
        };

        timer = setTimeout(poll, 2000);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [user, fetchUserTier]);
}
