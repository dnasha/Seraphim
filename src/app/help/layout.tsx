import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help & Info | Seraphim',
  description: 'Learn more about Seraphim, get support, and find our community links.',
};

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
