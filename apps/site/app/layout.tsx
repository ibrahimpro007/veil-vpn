import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { APP_NAME, SITE_URL } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME} — No-Logs WireGuard VPN`,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "VeilVPN is a no-logs WireGuard VPN with a kill switch, DNS leak protection, and split tunneling. Free 7-day trial, then $4.99/mo. Your traffic is yours — we keep no record of it.",
  keywords: [
    "VPN",
    "no-logs VPN",
    "WireGuard VPN",
    "private VPN",
    "kill switch VPN",
    "VeilVPN",
  ],
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} — No-Logs WireGuard VPN`,
    description:
      "A no-logs WireGuard VPN. Kill switch, DNS leak protection, split tunneling. Free 7-day trial.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: APP_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — No-Logs WireGuard VPN`,
    description:
      "A no-logs WireGuard VPN. Kill switch, DNS leak protection, split tunneling. Free 7-day trial.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
