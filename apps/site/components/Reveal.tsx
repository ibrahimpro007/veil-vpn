"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Subtle scroll-reveal wrapper. Animates once when the element enters the
 * viewport. Content stays in the HTML for SEO; animation is progressive
 * enhancement (no layout shift — only opacity/transform).
 */
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
