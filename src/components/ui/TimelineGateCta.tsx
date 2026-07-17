'use client';

import { GatedButton } from '@/components/ui/FeatureGate';
import { useAuth } from '@/hooks/useAuth';
import { hasFeature, type UserTier } from '@/lib/entitlements';

interface TimelineGateCtaProps {
    userTier: UserTier;
    className: string;
    guestClassName?: string;
}

/** Shows the appropriate timeline action for anonymous and signed-in users. */
export default function TimelineGateCta({
    userTier,
    className,
    guestClassName = '',
}: TimelineGateCtaProps) {
    const { setShowAuthModal } = useAuth();

    if (hasFeature(userTier, 'fullTimeline')) return null;

    if (userTier === 'guest') {
        return (
            <button
                type="button"
                className={`${className} ${guestClassName}`.trim()}
                onClick={() => setShowAuthModal(true)}
                title="Create a free account to preview more story sources"
            >
                Create an account to see more
            </button>
        );
    }

    return (
        <GatedButton
            className={className}
            allowed={false}
            requiredTier="pro"
            featureName="Full story timeline"
            title="Show every source in this story timeline"
        >
            Unlock full timeline
        </GatedButton>
    );
}
