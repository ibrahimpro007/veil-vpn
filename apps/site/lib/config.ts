/**
 * Site-wide configuration. All values come from NEXT_PUBLIC_* env vars so
 * they are safe to embed in the static build. Never put secrets here.
 */

export const APP_NAME = "VeilVPN";

export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION || "v0.1.0";

export const GITHUB_REPO: string =
  process.env.NEXT_PUBLIC_GITHUB_REPO || "ibrahimpro007/veil-vpn";

/** True when GITHUB_REPO still holds the placeholder value. */
export const GITHUB_REPO_IS_PLACEHOLDER =
  GITHUB_REPO.includes("YOUR_GITHUB_ORG");

export const API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.veil-vpn.example";

export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL || "https://veil-vpn.example";

/**
 * Optional hosted web portal for signup/billing. When unset, the site directs
 * users to create their account and subscribe inside the app.
 */
export const APP_URL: string = process.env.NEXT_PUBLIC_APP_URL || "";

/** Release asset file names. These MUST match the assets attached to the
 *  GitHub release tagged APP_VERSION in GITHUB_REPO. */
export const RELEASE_ASSETS = {
  windowsExe: "VeilVPN-Setup.exe",
  windowsMsix: "VeilVPN.msix",
  androidApk: "VeilVPN.apk",
  macosDmg: "VeilVPN.dmg",
} as const;

export function releaseDownloadUrl(asset: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/latest/download/${asset}`;
}

export type PlanId = "trial" | "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  priceNote: string;
  devices: number;
  cta: string;
  highlight?: boolean;
  features: string[];
}

/** Matches the seeded plans in infra/d1/seed.sql. */
export const PLANS: Plan[] = [
  {
    id: "trial",
    name: "Free Trial",
    price: "$0",
    priceNote: "7 days, no card required",
    devices: 1,
    cta: "Start free trial",
    features: [
      "7 days of full VPN access",
      "1 device",
      "WireGuard protocol",
      "Kill switch",
      "DNS leak protection",
      "No credit card required",
    ],
  },
  {
    id: "monthly",
    name: "Monthly",
    price: "$4.99",
    priceNote: "per month, cancel anytime",
    devices: 5,
    cta: "Choose Monthly",
    highlight: true,
    features: [
      "Everything in the trial",
      "Up to 5 devices",
      "All server regions",
      "Split tunneling",
      "Priority support",
    ],
  },
  {
    id: "yearly",
    name: "Yearly",
    price: "$49.99",
    priceNote: "per year — 2 months free",
    devices: 5,
    cta: "Choose Yearly",
    features: [
      "Everything in Monthly",
      "Up to 5 devices",
      "Save ~17% vs monthly",
      "Priority support",
    ],
  },
];
