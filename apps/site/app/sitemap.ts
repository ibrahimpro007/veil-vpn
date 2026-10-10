import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, "");
  const pages = [
    "",
    "/pricing",
    "/download",
    "/guides/windows",
    "/guides/android",
    "/guides/macos",
    "/faq",
    "/privacy",
    "/terms",
    "/acceptable-use",
  ];
  return pages.map((p) => ({
    url: `${base}${p || "/"}`,
    lastModified: new Date(),
    changeFrequency: p === "" ? "weekly" : "monthly",
    priority: p === "" ? 1 : 0.7,
  }));
}
