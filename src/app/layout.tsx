/*
  Root layout component.
  Defines the core structure of the application, including typography, global styles,
  metadata for SEO, and viewport settings. Integrates providers and performance analytics.
*/

import type { Metadata, Viewport } from "next";
import {
  Inter,
  Space_Grotesk,
  Merriweather,
} from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

import { Providers } from "@/components/Providers";

import "./globals.css";

// Font configurations for the application
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-merriweather",
  display: "swap",
});

// Viewport and device-specific settings
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Global metadata for SEO and social sharing
export const metadata: Metadata = {
  metadataBase: new URL("https://seraphi.me"),
  title: "Seraphim",
  description: "Real-time OSINT aggregator and mapper - know the world!",
  keywords: [
    "OSINT",
    "news",
    "aggregator",
    "intelligence",
    "world news",
    "map",
  ],
  icons: {
    icon: "/logo.webp",
    apple: "/logo.webp",
  },
  openGraph: {
    title: "Seraphim",
    description: "Real-time OSINT aggregator and mapper - know the world!",
    url: "https://seraphi.me",
    siteName: "Seraphim",
    images: [
      {
        url: "/logo.webp",
        width: 562,
        height: 562,
        alt: "Seraphim - Real-time OSINT aggregator and mapper",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Seraphim",
    description: "Real-time OSINT aggregator and mapper - know the world!",
    images: ["/logo.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${merriweather.variable}`}
    >
      <body suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

