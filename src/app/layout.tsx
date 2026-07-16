/**
 * Root layout component for the Seraphim application.
 * 
 * Defines the core HTML structure, global font configurations, and essential 
 * metadata for SEO and PWA support. It integrates global providers and 
 * performance monitoring tools like Speed Insights and Vercel Analytics.
 */

import type { Metadata, Viewport } from "next";
import {
  Inter,
  Space_Grotesk,
  Merriweather,
} from "next/font/google";
import { Providers } from "@/components/layout/Providers";
import CookieConsent from "@/components/ui/CookieConsent";
import ConsentAwareAnalytics from "@/components/ui/ConsentAwareAnalytics";
import {
  getSiteOrigin,
  HOME_DESCRIPTION,
  HOME_TITLE,
  SHARED_SOCIAL_IMAGE,
  SITE_NAME,
} from "@/lib/siteConfig";

import "./globals.css";

// Application font configurations using Next.js font optimization
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
  weight: ["400", "700"],
  style: ["normal"],
  variable: "--font-merriweather",
  display: "swap",
});

// Viewport and device specific settings
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#6366f1",
};

// Global metadata for SEO, social sharing, and PWA capabilities
export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: HOME_DESCRIPTION,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Seraphim",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
  },
  openGraph: {
    title: `${SITE_NAME}: Know the world as it happens`,
    description: HOME_DESCRIPTION,
    url: getSiteOrigin(),
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [SHARED_SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: Know the world as it happens`,
    description: HOME_DESCRIPTION,
    images: [SHARED_SOCIAL_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
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
          <CookieConsent />
          <ConsentAwareAnalytics />
        </Providers>
      </body>
    </html>
  );
}
