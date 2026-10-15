"use client";

import { useEffect, useRef } from "react";

/**
 * ONE GSAP scroll effect for the homepage hero: gentle parallax on the
 * decorative background glow. GSAP + ScrollTrigger are imported lazily so
 * they never touch the initial bundle. The target is absolutely positioned
 * decoration, so there is zero layout shift (CLS-safe).
 */
export default function HeroParallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled || !ref.current) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        gsap.to(ref.current, {
          yPercent: 28,
          ease: "none",
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden>
      {children}
    </div>
  );
}
