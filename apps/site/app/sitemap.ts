import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { getAllPosts } from "@/content/blog/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, "");
  const pages: {
    url: string;
    changeFrequency: "weekly" | "monthly";
    priority: number;
  }[] = [
    { url: "/", changeFrequency: "weekly", priority: 1 },
    { url: "/pricing", changeFrequency: "monthly", priority: 0.8 },
    { url: "/download", changeFrequency: "weekly", priority: 0.9 },
    { url: "/blog", changeFrequency: "weekly", priority: 0.8 },
    { url: "/guides/windows", changeFrequency: "monthly", priority: 0.7 },
    { url: "/guides/android", changeFrequency: "monthly", priority: 0.7 },
    { url: "/guides/macos", changeFrequency: "monthly", priority: 0.7 },
    { url: "/faq", changeFrequency: "monthly", priority: 0.7 },
    { url: "/privacy", changeFrequency: "monthly", priority: 0.5 },
    { url: "/terms", changeFrequency: "monthly", priority: 0.5 },
    { url: "/acceptable-use", changeFrequency: "monthly", priority: 0.5 },
  ];
  const staticEntries: MetadataRoute.Sitemap = pages.map((p) => ({
    url: `${base}${p.url}`,
    lastModified: new Date(),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
  const blogEntries: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(post.date + "T12:00:00Z"),
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  return [...staticEntries, ...blogEntries];
}
