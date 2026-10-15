import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { APP_NAME, SITE_URL } from "@/lib/config";
import {
  getAllPosts,
  getPost,
  getRelated,
  readingMinutes,
} from "@/content/blog/posts";
import Markdown from "@/components/Markdown";
import JsonLd from "@/components/JsonLd";

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const post = getPost(params.slug);
  if (!post) return { title: "Post not found" };
  const url = `/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url,
      publishedTime: post.date,
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
    alternates: { canonical: url },
  };
}

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();
  const related = getRelated(post);
  const base = SITE_URL.replace(/\/$/, "");

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Organization", name: APP_NAME, url: base },
    publisher: { "@type": "Organization", name: APP_NAME, url: base },
    mainEntityOfPage: `${base}/blog/${post.slug}`,
    keywords: post.tags.join(", "),
  };

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <JsonLd data={articleJsonLd} />
      <Link
        href="/blog"
        className="font-medium text-emerald-300 hover:text-emerald-200"
      >
        ← All articles
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap gap-2">
          {post.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200"
            >
              {t}
            </span>
          ))}
        </div>
        <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
          {post.title}
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          {formatDate(post.date)} · {readingMinutes(post)} min read · By the{" "}
          {APP_NAME} team
        </p>
      </header>

      <div className="mt-8">
        <Markdown body={post.body} />
      </div>

      {/* CTA */}
      <div className="mt-12 rounded-3xl border border-emerald-400/30 bg-gradient-to-br from-emerald-400/10 to-transparent p-8 text-center">
        <h2 className="text-2xl font-extrabold text-white">
          Ready to be the only one who sees your traffic?
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-slate-300">
          {APP_NAME} is a no-logs WireGuard VPN with kill switch and DNS leak
          protection. Free 7-day trial — no credit card required.
        </p>
        <Link
          href="/download"
          className="mt-6 inline-block rounded-2xl bg-emerald-400 px-8 py-3.5 font-bold text-ink-950 transition hover:bg-emerald-300"
        >
          Download {APP_NAME}
        </Link>
      </div>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-extrabold text-white">Keep reading</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}`}
                className="group rounded-2xl border border-white/10 bg-ink-900/60 p-5 transition hover:border-emerald-400/40"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {readingMinutes(r)} min read
                </p>
                <h3 className="mt-2 font-bold text-white group-hover:text-emerald-200">
                  {r.title}
                </h3>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
