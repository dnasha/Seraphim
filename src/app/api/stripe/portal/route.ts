/**
 * Stripe Customer Portal API Route
 * 
 * Creates a Stripe Customer Portal session for self-service subscription management.
 * Users can upgrade, downgrade, cancel, and update payment methods.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getConfiguredSiteUrl, isPaymentsEnabled } from '@/lib/security/payments';

const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
    try {
        if (!isPaymentsEnabled()) {
            return NextResponse.json({ error: 'Payments are currently disabled' }, { status: 503 });
        }

        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (!profile?.stripe_customer_id) {
            return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
        }

        const origin = getConfiguredSiteUrl();
        if (!origin) {
            return NextResponse.json({ error: 'Site URL is not configured' }, { status: 500 });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${origin}/account`,
        });

        return NextResponse.json({ url: session.url });
    } catch (err) {
        console.error('Stripe portal error:', err);
        return NextResponse.json(
            { error: 'Failed to create portal session' },
            { status: 500 }
        );
    }
}
