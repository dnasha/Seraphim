import { useEffect } from 'react';
import type { User, SupabaseClient } from '@supabase/supabase-js';

const log = (message: unknown, ...optionalParams: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...optionalParams);
    }
};

export function useStripeCheckoutPoll(
    supabase: SupabaseClient,
    user: User | null,
    fetchUserTier: (userId: string | undefined, force?: boolean) => Promise<void>
) {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        let checkTimer: NodeJS.Timeout | undefined;
        let pollInterval: NodeJS.Timeout | undefined;

        if (params.get('checkout') === 'success' && user?.id) {
            let attempts = 0;
            const maxAttempts = 5;

            const checkTier = async () => {
                attempts++;
                log(`[AuthProvider] Polling user tier on success redirect (attempt ${attempts}/${maxAttempts})...`);
                await fetchUserTier(user.id, true);
            };

            // Check once after 2 seconds
            checkTimer = setTimeout(async () => {
                await checkTier();

                // Set up polling interval to check if they upgraded
                pollInterval = setInterval(async () => {
                    if (attempts >= maxAttempts) {
                        if (pollInterval) clearInterval(pollInterval);
                        return;
                    }

                    try {
                        const { data } = await supabase
                            .from('user_profiles')
                            .select('tier')
                            .eq('id', user.id)
                            .single();

                        const currentTier = data?.tier?.toLowerCase();
                        if (currentTier && currentTier !== 'free' && currentTier !== 'guest') {
                            log('[AuthProvider] Premium tier detected via polling, stopping poll.');
                            await fetchUserTier(user.id, true);
                            if (pollInterval) clearInterval(pollInterval);
                        } else {
                            await checkTier();
                        }
                    } catch (err) {
                        console.warn('[AuthProvider] Error polling profile tier status:', err);
                        await checkTier();
                    }
                }, 3000);
            }, 2000);
        }

        return () => {
            if (checkTimer) clearTimeout(checkTimer);
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [user, fetchUserTier, supabase]);
}
