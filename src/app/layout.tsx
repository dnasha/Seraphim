import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display, Cinzel, Cinzel_Decorative } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-cinzel",
  display: "swap",
});

const cinzelDecorative = Cinzel_Decorative({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-cinzel-decorative",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://seraphi.me"),
  title: "Seraphim",
  description: "Real-time OSINT aggregator and mapper - know the world!",
  keywords: ["OSINT", "news", "aggregator", "intelligence", "world news", "map"],
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
      data-theme="dark" 
      suppressHydrationWarning 
      className={`${inter.variable} ${playfair.variable} ${cinzel.variable} ${cinzelDecorative.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
