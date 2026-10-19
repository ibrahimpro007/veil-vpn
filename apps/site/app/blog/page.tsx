import Link from "next/link";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/config";
import { getAllPosts, readingMinutes } from "@/content/blog/posts";

export const metadata: Metadata = {
  title: "Blog",
  description: `Practical privacy guides from the ${APP_NAME} team: no-logs VPNs explained, online privacy checklists, and honest VPN comparisons.`,
  openGraph: {
    title: `Blog | ${APP_NAME}`,
    description:
      "Practical privacy guides: no-logs VPNs explained, online privacy checklists, and honest VPN comparisons.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `Blog | ${APP_NAME}`,
    description:
      "Practical privacy guides: no-logs VPNs explained, online privacy checklists, and honest VPN comparisons.",
  },
};

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const [featured, ...rest] = posts;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
        Blog
      </p>
      <h1 className="mt-3 text-center text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
        Privacy, explained plainly
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-slate-400">
        Practical guides to VPNs, online privacy, and staying safe — no jargon,
        no fear-mongering.
      </p>

      {/* Featured post */}
      <Link
        href={`/blog/${featured.slug}`}
        className="group mt-12 block overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-400/10 via-ink-900 to-ink-950 p-8 transition hover:border-emerald-400/40 sm:p-10"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
          Featured · {formatDate(featured.date)} · {readingMinutes(featured)}{" "}
          min read
        </p>
        <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white group-hover:text-emerald-200 sm:text-3xl">
          {featured.title}
        </h2>
        <p className="mt-3 max-w-3xl text-slate-300">{featured.description}</p>
        <span className="mt-5 inline-block font-bold text-emerald-300 group-hover:text-emerald-200">
          Read the guide →
        </span>
      </Link>

      {/* Rest of posts */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col rounded-3xl border border-white/10 bg-ink-900/60 p-7 transition hover:border-emerald-400/40"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {formatDate(post.date)} · {readingMinutes(post)} min read
            </p>
            <h2 className="mt-2 text-xl font-bold text-white group-hover:text-emerald-200">
              {post.title}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-400">
              {post.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400"
                >
                  {t}
                </span>
              ))}
            </div>
            <span className="mt-4 font-bold text-emerald-300 group-hover:text-emerald-200">
              Read →
            </span>
          </Link>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-16 rounded-3xl border border-emerald-400/30 bg-emerald-400/5 p-8 text-center sm:p-10">
        <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
          Put it into practice
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-300">
          Reading about privacy is step one. Step two takes about three minutes:
          download {APP_NAME}, start your free trial, and browse like
          nobody&apos;s watching — because nobody is.
        </p>
        <Link
          href="/download"
          className="mt-6 inline-block rounded-2xl bg-emerald-400 px-8 py-3.5 font-bold text-ink-950 transition hover:bg-emerald-300"
        >
          Get {APP_NAME} free for 7 days
        </Link>
      </div>
    </div>
  );
}
