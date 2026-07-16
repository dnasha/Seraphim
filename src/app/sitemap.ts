import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/lib/siteConfig";

/**
 * Generates the sitemap.xml file for the Seraphim application.
 * Exposes core public pages to search engines for proper SEO indexing.
 *
 * @returns {MetadataRoute.Sitemap} The sitemap configuration object.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/pricing", "/help", "/terms", "/privacy"].map((path) => ({
    url: absoluteSiteUrl(path),
  }));
}
