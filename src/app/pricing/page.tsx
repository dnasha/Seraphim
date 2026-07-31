import { PricingPageClient } from './PricingPageClient';
import { TIERS } from './pricingConstants';
import { parsePricingSearchParams } from './pricingSeo';
import {
  buildSoftwareApplicationJsonLd,
  createPageMetadata,
  serializeJsonLd,
} from '@/lib/siteConfig';
import { AuthProvider } from '@/components/auth/AuthProvider';

const PRICING_DESCRIPTION =
  'Compare Seraphim plans for live global event monitoring, deeper history, advanced filters, intelligence overlays, and investigation tools.';

export const metadata = createPageMetadata({
  title: 'Pricing & Plans',
  description: PRICING_DESCRIPTION,
  path: '/pricing',
});

interface PricingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const pricingParams = parsePricingSearchParams(await searchParams);
  const softwareJsonLd = serializeJsonLd(buildSoftwareApplicationJsonLd(TIERS));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: softwareJsonLd }}
      />
      <AuthProvider>
        <PricingPageClient {...pricingParams} />
      </AuthProvider>
    </>
  );
}
