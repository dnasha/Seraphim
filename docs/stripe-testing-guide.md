# Stripe Payments Testing Guide

> **Current Mode: Sandbox (Test Mode)**
> All testing below uses Stripe test-mode keys. No real charges will occur.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Stripe Dashboard Setup](#2-stripe-dashboard-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [Local Webhook Testing](#4-local-webhook-testing)
5. [Test Scenarios](#5-test-scenarios)
6. [Verification Checklist](#6-verification-checklist)
7. [Going Live](#7-going-live)

---

## 1. Prerequisites

- [x] Stripe account created and verified
- [ ] Stripe CLI installed (`scoop install stripe` on Windows or https://docs.stripe.com/stripe-cli)
- [ ] Products & Prices created in Stripe Dashboard (see below)
- [ ] Environment variables configured (see below)

### Test Card Numbers (Stripe Sandbox)

| Card | Number | Behavior |
|------|--------|----------|
| **Visa (Success)** | `4242 4242 4242 4242` | Payment succeeds |
| **Visa (Declined)** | `4000 0000 0000 0002` | Payment is declined |
| **3D Secure** | `4000 0025 0000 3155` | Requires authentication |
| **Insufficient Funds** | `4000 0000 0000 9995` | Payment fails |

For all test cards: use any future expiry date (e.g., `12/34`), any 3-digit CVC, and any postal code.

---

## 2. Stripe Dashboard Setup

### 2.1 Create Products & Prices

Go to **Stripe Dashboard → Products** (`https://dashboard.stripe.com/test/products`):

#### Product 1: Seraphim Pro
1. Click **"+ Add product"**
2. Name: `Seraphim Pro`
3. Description: `Full OSINT toolkit for power users`
4. Add two prices:
   - **Monthly**: $9.99/month (Recurring)
   - **Yearly**: $99.99/year (Recurring)
5. Save and note both **Price IDs** (format: `price_...`)

#### Product 2: Seraphim Analyst
1. Click **"+ Add product"**
2. Name: `Seraphim Analyst`
3. Description: `Professional intelligence & analytics`
4. Add two prices:
   - **Monthly**: $29.99/month (Recurring)
   - **Yearly**: $299.99/year (Recurring)
5. Save and note both **Price IDs**

#### Product 3: Seraphim Angel
1. Click **"+ Add product"**
2. Name: `Seraphim Angel`
3. Description: `Lifetime access. Founding supporter.`
4. **Metadata**: Add key `inventory` with value `100`
5. Add one price:
   - **One-time**: $299.00
6. Save and note the **Price ID**

### 2.2 Configure Customer Portal

Go to **Stripe Dashboard → Settings → Billing → Customer Portal**:

1. Enable **subscription management** (upgrade, downgrade, cancel)
2. Enable **invoice history**
3. Set **Default return URL**: `http://localhost:3000/account` (for testing)
4. Save

### 2.3 Register Webhook Endpoint (Production Only)

For local testing, use the Stripe CLI instead (see Section 4). For production:

Go to **Stripe Dashboard → Developers → Webhooks**:

1. Click **"+ Add endpoint"**
2. URL: `https://seraphi.me/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Save and note the **Signing Secret** (format: `whsec_...`)

---

## 3. Environment Configuration

Add these to `.env.local`:

```env
# Stripe Keys (Test Mode — from Dashboard → Developers → API Keys)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Webhook Secret (from Stripe CLI for local, or Dashboard for production)
STRIPE_WEBHOOK_SECRET=whsec_...

# Price IDs (from Step 2.1 above)
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_ANALYST_MONTHLY=price_...
STRIPE_PRICE_ANALYST_YEARLY=price_...
STRIPE_PRICE_ANGEL=price_...
```

---

## 4. Local Webhook Testing

### Install Stripe CLI
```powershell
# Windows (Scoop)
scoop install stripe

# Or download from: https://docs.stripe.com/stripe-cli
```

### Login
```powershell
stripe login
```

### Forward Webhooks to Localhost
```powershell
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

This will output a **webhook signing secret** (starts with `whsec_...`). Copy it into your `.env.local` as `STRIPE_WEBHOOK_SECRET`.

### Keep Terminal Open
Leave the Stripe CLI running in a separate terminal while testing. It will show real-time webhook event delivery.

---

## 5. Test Scenarios

### Scenario 1: Free Tier (Baseline)

**Steps:**
1. Sign in with an email account
2. Observe the sidebar shows **"Free"** badge next to "Seraphim" title
3. Navigate to `/account` — see Subscription section showing **"Free"** tier badge with **"Upgrade Plan"** button
4. On the map, observe the **"Upgrade"** button (indigo, top-left)
5. Verify only 100 event pins are visible

**Expected:**
- Free badge visible in sidebar and account page
- Upgrade button visible on map
- Event list limited to 100 items
- Search, filters, sort modes are accessible (not guest-locked)

---

### Scenario 2: Guest User (No Auth)

**Steps:**
1. Visit the app without signing in (or click "Continue as Guest")
2. Observe **"Guest"** badge in sidebar
3. Verify only 7 events visible
4. Verify filters, sort, search are greyed out
5. Observe the **"Upgrade"** button on the map

**Expected:**
- Guest badge (grey) in sidebar
- Only 7 events
- Controls disabled
- "Upgrade" button visible

---

### Scenario 3: Pro Monthly with Free Trial

**Steps:**
1. Sign in → Click **"Upgrade"** button on map → lands on `/pricing`
2. Verify **"Yearly"** toggle is selected by default
3. Switch to **"Monthly"**
4. Click **"Start Free Trial"** on the Pro card
5. Should redirect to Stripe Checkout
6. Enter test card `4242 4242 4242 4242`, any future date, any CVC
7. Complete checkout
8. Should redirect back to `/?checkout=success`

**Verify:**
- [ ] Stripe Checkout shows "7-day free trial" text
- [ ] After redirect, sidebar badge changes to **"Pro"** (indigo)
- [ ] Map upgrade button disappears
- [ ] Event limit removed (unlimited)
- [ ] Account page shows "Trial Active" with trial end date
- [ ] In Stripe Dashboard → Customers, see the customer with subscription status "trialing"
- [ ] Stripe CLI terminal shows `checkout.session.completed` webhook

**Database check:**
```sql
SELECT tier, subscription_status, trial_ends_at, billing_interval
FROM public.user_profiles
WHERE stripe_customer_id IS NOT NULL;
```

---

### Scenario 4: Pro Yearly (No Trial)

**Steps:**
1. Sign in → Go to `/pricing`
2. Keep **"Yearly"** toggle active
3. Click **"Start Free Trial"** on Pro card (note: trial is only for monthly)
4. Complete Stripe Checkout with `4242 4242 4242 4242`

**Verify:**
- [ ] No free trial mentioned (yearly doesn't get trial)
- [ ] Price shows $99.99/year with "$119.88/yr" crossed out
- [ ] Subscription is immediately active (not trialing)
- [ ] Badge shows **"Pro"** (indigo)

---

### Scenario 5: Analyst Monthly

**Steps:**
1. Sign in → Go to `/pricing`
2. Switch to **"Monthly"**
3. Click **"Get Analyst"** on Analyst card
4. Complete checkout with `4242 4242 4242 4242`

**Verify:**
- [ ] Badge changes to **"Analyst"** (gold)
- [ ] Account page shows active subscription
- [ ] Stripe Dashboard shows subscription active

---

### Scenario 6: Angel (Lifetime One-Time)

**Steps:**
1. Sign in → Go to `/pricing`
2. Observe Angel card shows "Only X of 100 remaining"
3. Click **"Become an Angel"**
4. Complete checkout with `4242 4242 4242 4242`

**Verify:**
- [ ] Badge changes to **"Angel"** (emerald)
- [ ] Account page shows "Lifetime Access"
- [ ] No "Manage Billing" button (Angel is permanent)
- [ ] Angel count decremented on pricing page
- [ ] In Supabase: `angel_purchases` table has a new row
- [ ] In Supabase: `user_profiles.tier = 'angel'`, `billing_interval = 'lifetime'`

---

### Scenario 7: Manage Billing (Customer Portal)

**Steps:**
1. With an active Pro or Analyst subscription, go to `/account`
2. Click **"Manage Billing"** button
3. Should redirect to Stripe Customer Portal

**Verify:**
- [ ] Portal shows current subscription details
- [ ] Can update payment method
- [ ] Can cancel subscription
- [ ] After canceling: Stripe sends `customer.subscription.updated` then `customer.subscription.deleted`
- [ ] User tier downgrades to "Free" in the database

---

### Scenario 8: Payment Failure

**Steps:**
1. Create a Pro subscription with `4242 4242 4242 4242`
2. In Stripe Dashboard → Customers → find the customer
3. Update their default payment method to the declining card: `4000 0000 0000 0002`
4. Use Stripe CLI to trigger a renewal: `stripe invoices pay <invoice_id>`

**Verify:**
- [ ] Webhook receives `invoice.payment_failed`
- [ ] `user_profiles.subscription_status` changes to `past_due`
- [ ] User still has access (grace period)

---

### Scenario 9: Subscription Cancellation

**Steps:**
1. Create a Pro subscription
2. Cancel via Customer Portal OR use Stripe CLI: `stripe subscriptions cancel <sub_id>`

**Verify:**
- [ ] Webhook receives `customer.subscription.deleted`
- [ ] User tier downgrades to `free`
- [ ] Badge changes back to "Free"
- [ ] Upgrade button reappears on map

---

### Scenario 10: Angel Sold Out

**Steps:**
1. In Stripe Dashboard → Angel product → Edit metadata → Set `inventory` to `0`
2. Try to purchase Angel tier

**Verify:**
- [ ] Pricing page shows "Only 0 of 0 remaining" (or similar)
- [ ] Clicking "Become an Angel" shows "Angel tier is sold out" error
- [ ] Checkout is not created

---

### Scenario 11: Trial Expiration → Auto-Charge

**Steps:**
1. Create a Pro Monthly subscription (has 7-day trial)
2. In Stripe Dashboard, go to the subscription and click "End trial now"
3. Observe the auto-charge behavior

**Verify:**
- [ ] Stripe attempts to charge the card on file
- [ ] With `4242...` card: charge succeeds, status → `active`
- [ ] `subscription_status` in DB changes from `trialing` to `active`
- [ ] `trial_ends_at` becomes null or past

---

### Scenario 12: Pricing Page UI

**Steps:**
1. Visit `/pricing` in both light and dark mode
2. Toggle monthly/yearly
3. Resize browser to mobile width

**Verify:**
- [ ] Cards stack properly on mobile (1 column below 768px)
- [ ] Monthly/yearly toggle animates smoothly
- [ ] Pro card has "Most Popular" badge and indigo border
- [ ] Angel card has "Limited Edition" badge and emerald gradient
- [ ] Feature comparison table scrolls horizontally on mobile
- [ ] FAQ section renders cleanly
- [ ] Back button returns to dashboard
- [ ] Page is scrollable (full content visible)

---

### Scenario 13: Account Page Subscription Section

**Steps:**
1. Sign in with a Free account → go to `/account`
2. Sign in with a Pro account → go to `/account`
3. Sign in with an Angel account → go to `/account`

**Verify:**
- [ ] **Free**: Shows Free badge + "Upgrade Plan" button (links to /pricing)
- [ ] **Pro**: Shows Pro badge + subscription status + trial/renewal info + "Manage Billing" button
- [ ] **Angel**: Shows Angel badge + "Lifetime Access" + no billing button
- [ ] Page is scrollable

---

## 6. Verification Checklist

### Database
```sql
-- Check user profiles have correct subscription data
SELECT id, tier, stripe_customer_id, stripe_subscription_id,
       subscription_status, billing_interval, trial_ends_at, current_period_end
FROM public.user_profiles
WHERE stripe_customer_id IS NOT NULL;

-- Check angel purchase tracking
SELECT * FROM public.angel_purchases;

-- Verify auto-profile creation trigger works
SELECT COUNT(*) as auth_users FROM auth.users;
SELECT COUNT(*) as profiles FROM public.user_profiles;
-- These counts should match
```

### Stripe CLI Webhook Events to Monitor
```
✅ checkout.session.completed
✅ customer.subscription.created
✅ customer.subscription.updated
✅ customer.subscription.deleted
✅ invoice.payment_succeeded
✅ invoice.payment_failed
```

### Security Checks
- [ ] Webhook signature verification (send a forged POST to `/api/stripe/webhook` — should return 400)
- [ ] Checkout API requires authentication (POST to `/api/stripe/checkout` without auth — should return 401)
- [ ] Users cannot modify their own `tier` column via Supabase client (RLS blocks direct UPDATE of tier)
- [ ] Service role key is only used server-side (not exposed in client bundle)

---

## 7. Going Live

When ready to go to production:

### Keys to Update

| Variable | Current (Sandbox) | Production |
|----------|-------------------|------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (CLI) | `whsec_...` (Dashboard) |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_test_...` | `price_live_...` |
| `STRIPE_PRICE_PRO_YEARLY` | `price_test_...` | `price_live_...` |
| `STRIPE_PRICE_ANALYST_MONTHLY` | `price_test_...` | `price_live_...` |
| `STRIPE_PRICE_ANALYST_YEARLY` | `price_test_...` | `price_live_...` |
| `STRIPE_PRICE_ANGEL` | `price_test_...` | `price_live_...` |

### Production Checklist
- [ ] Create **live** Products & Prices in Stripe (identical structure to test)
- [ ] Set Angel product metadata `inventory: 100` on **live** product
- [ ] Register production webhook endpoint: `https://seraphi.me/api/stripe/webhook`
- [ ] Update all env vars in **Vercel** to live keys
- [ ] Configure Customer Portal return URL to `https://seraphi.me/account`
- [ ] Enable Stripe Radar for fraud protection
- [ ] Test one real transaction with a small amount before public launch
- [ ] Set up Stripe email notifications for failed payments

### Important: Test vs Live Products

Stripe test-mode products **do not carry over** to live mode. You must recreate all products, prices, and webhook endpoints in live mode. The metadata `inventory: 100` must also be set on the live Angel product.
