import { createPageMetadata } from '@/lib/siteConfig';

export const metadata = createPageMetadata({
  title: 'Help & Info',
  description: 'Learn more about Seraphim, get support, and find our community links.',
  path: '/help',
});

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
