import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/lib/siteConfig";

/**
 * Generates the robots.txt file for the Seraphim application.
 * Blocks search crawlers from accessing private or administrative paths (auth, account, API endpoints)
 * while allowing full indexing of public marketing, legal, and support documentation.
 *
 * @returns {MetadataRoute.Robots} The robots configuration object.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/og/",
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
    sitemap: absoluteSiteUrl("/sitemap.xml"),
  };
}
