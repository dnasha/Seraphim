import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('launch legal content', () => {
  const terms = source('src/app/terms/page.tsx');
  const privacy = source('src/app/privacy/page.tsx');
  const authModal = source('src/components/auth/AuthModal.tsx');
  const pricing = source('src/app/pricing/PricingPageClient.tsx');
  const faq = source('src/app/pricing/FaqSection.tsx');

  it('uses fixed policy versions and the approved public identity', () => {
    expect(terms).toContain("const EFFECTIVE_DATE = 'July 17, 2026'");
    expect(terms).toContain("const POLICY_VERSION = '2026-07-17'");
    expect(privacy).toContain("const EFFECTIVE_DATE = 'July 26, 2026'");
    expect(privacy).toContain("const POLICY_VERSION = '2026-07-26'");
    for (const policy of [terms, privacy]) {
      expect(policy).toContain('Washington, USA');
      expect(policy).toContain('legal@seraphi.me');
      expect(policy).not.toMatch(/new Date|physical address|mailing address|legal operator/i);
    }
  });

  it('contains the required payment, Angel, risk, and dispute provisions', () => {
    expect(terms).toMatch(/Link acts as merchant of record/i);
    expect(terms).toMatch(/including a partial refund, permanently ends Angel/i);
    expect(terms).toMatch(/operational lifetime of the hosted Seraphim Service/i);
    expect(terms).toMatch(/greater of US\$100 or the amount you paid/i);
    expect(terms).toMatch(/American Arbitration Association/i);
    expect(terms).toMatch(/opt out of arbitration/i);
    expect(terms).toMatch(/at least 18 years old/i);
    expect(terms).toMatch(/does not represent that Seraphim has registered a formal DMCA/i);
  });

  it('accurately identifies data, providers, retention, and regional rights', () => {
    for (const provider of ['Stripe', 'Link', 'Supabase', 'Vercel', 'Cloudflare Turnstile', 'Upstash', 'MapTiler']) {
      expect(privacy).toContain(provider);
    }
    expect(privacy).toMatch(/does not request your device’s precise geolocation/i);
    expect(privacy).toMatch(/does not sell personal information or share it for cross-context behavioral advertising/i);
    expect(privacy).toMatch(/keyed pseudonymous value/i);
    expect(privacy).toMatch(/California residents/i);
    expect(privacy).toMatch(/California notice at collection/i);
    expect(privacy).toMatch(/will not discriminate/i);
    expect(privacy).toMatch(/at least 18/i);
    expect(privacy).toMatch(/Vercel Web Analytics runs on each visit/i);
    expect(privacy).toMatch(/Speed Insights.+load only after you choose/i);
  });

  it('keeps generic signup links concise and centralizes Angel detail', () => {
    expect(authModal).toContain('Terms of Service');
    expect(authModal).toContain('Privacy Policy');
    expect(authModal).not.toMatch(/merchant of record|partial refund|arbitration|Angel lifetime/i);
    expect(pricing).toContain('Refund and lifetime terms');
    expect(faq).toContain('<Link href="/terms" title="Read the Terms of Service">Terms</Link>');
  });
});
