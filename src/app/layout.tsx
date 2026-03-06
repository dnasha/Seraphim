import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seraphim",
  description: "Real-time intelligence aggregator — news events mapped worldwide",
  keywords: ["OSINT", "news", "aggregator", "intelligence", "world news", "map"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&family=Cinzel:wght@700&family=Cinzel+Decorative:wght@700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
