import type { MetadataRoute } from "next";

/**
 * Generates the robots.txt file for the Seraphim application.
 * Blocks search crawlers from accessing private or administrative paths (auth, account, API endpoints)
 * while allowing full indexing of public marketing, legal, and support documentation.
 *
 * @returns {MetadataRoute.Robots} The robots configuration object.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://seraphi.me";

  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/pricing",
        "/help",
        "/terms",
        "/privacy",
      ],
      disallow: [
        "/api/",
        "/auth/",
        "/account/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
