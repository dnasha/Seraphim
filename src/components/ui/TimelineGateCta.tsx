'use client';

import { GatedButton } from '@/components/ui/FeatureGate';
import { hasFeature, type UserTier } from '@/lib/entitlements';
import { setAuthModalOpen } from '@/hooks/useAuthModalState';
import { currentReturnPath } from '@/lib/upgradeNavigation';
import actions from './UpgradeActions.module.css';

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
    if (hasFeature(userTier, 'fullTimeline')) return null;

    if (userTier === 'guest') {
        return (
            <button
                type="button"
                className={`${actions.action} ${actions.inline} ${className} ${guestClassName}`.trim()}
                onClick={() => {
                    setAuthModalOpen(true, { initialTab: 'signup', returnTo: currentReturnPath(), subtitle: 'Create a free account to preview more story sources' });
                }}
                title="Create a free account to preview more story sources"
            >
                Create an account to see more
            </button>
        );
    }

    return (
        <GatedButton
            className={`${actions.action} ${actions.inline} ${className}`}
            allowed={false}
            requiredTier="pro"
            featureName="Full story timeline"
            featureDescription="See every source and follow the story from the first report through the latest update."
            title="Show every source in this story timeline"
        >
            Unlock full timeline
        </GatedButton>
    );
}
