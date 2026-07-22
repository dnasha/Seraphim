import 'server-only';

import { supabaseAdmin } from '@/lib/core/supabase-admin';
import { stripe } from '@/lib/stripe';

export interface CheckoutReservationRef {
  intent_id: string | null;
  intent_status: string | null;
  existing_session_id: string | null;
}

export async function retireCheckoutReservation(
  reservation: CheckoutReservationRef,
  userId: string,
  options: { expireOpenSession: boolean; failureCode?: string },
) {
  if (
    reservation.intent_status !== 'open'
    || !reservation.intent_id
    || !reservation.existing_session_id
  ) {
    return false;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(reservation.existing_session_id);
    let failureCode = options.failureCode ?? 'stripe_session_expired';

    if (session.status === 'open') {
      if (!options.expireOpenSession) return false;
      await stripe.checkout.sessions.expire(session.id);
      failureCode = options.failureCode ?? 'superseded_by_new_checkout';
    } else if (session.status !== 'expired') {
      // A completed or otherwise non-expirable Session may already represent a payment.
      return false;
    }

    const { error } = await supabaseAdmin
      .from('billing_checkout_intents')
      .update({
        status: 'expired',
        failure_code: failureCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservation.intent_id)
      .eq('user_id', userId)
      .eq('status', 'open');
    return !error;
  } catch {
    // Fail closed. The Stripe expiry webhook or the normal timeout can release it later.
    return false;
  }
}
