import type { MetadataRoute } from "next";

// A self-hosted instance holds private health data: keep it out of search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
