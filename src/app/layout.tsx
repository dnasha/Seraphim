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
  themeColor: "#6366f1",
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
    apple: [
      { url: "/apple-touch-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Seraphim",
    description: "Real-time OSINT aggregator and mapper - know the world!",
    url: "https://seraphi.me",
    siteName: "Seraphim",
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
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
    images: ["/icon-512x512.png"],
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
