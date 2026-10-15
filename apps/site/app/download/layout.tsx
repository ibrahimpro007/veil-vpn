import type { Metadata } from "next";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download",
  description: `Download ${APP_NAME} for Windows, macOS, and Android. Free 7-day trial, no-logs WireGuard VPN with kill switch. Direct download — no app store needed.`,
  openGraph: {
    title: `Download ${APP_NAME}`,
    description:
      "Free 7-day trial. No-logs WireGuard VPN for Windows, macOS, and Android. Direct download, no app store needed.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `Download ${APP_NAME}`,
    description:
      "Free 7-day trial. No-logs WireGuard VPN for Windows, macOS, and Android.",
  },
};

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
