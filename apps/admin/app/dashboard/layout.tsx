"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { can, useAuth, type AdminRole } from "@/lib/auth";
import { Badge } from "@/components/ui";

const NAV: {
  href: string;
  label: string;
  icon: string;
  minAction: Parameters<typeof can>[1];
}[] = [
  { href: "/dashboard", label: "Overview", icon: "◈", minAction: "users.view" },
  {
    href: "/dashboard/users",
    label: "Users",
    icon: "👥",
    minAction: "users.view",
  },
  {
    href: "/dashboard/subscriptions",
    label: "Subscriptions",
    icon: "💳",
    minAction: "users.view",
  },
  {
    href: "/dashboard/payments",
    label: "Payments",
    icon: "🧾",
    minAction: "users.view",
  },
  {
    href: "/dashboard/nodes",
    label: "Nodes",
    icon: "🌐",
    minAction: "nodes.manage",
  },
  {
    href: "/dashboard/announcements",
    label: "Announcements",
    icon: "📣",
    minAction: "announcements.create",
  },
  {
    href: "/dashboard/audit-logs",
    label: "Audit Logs",
    icon: "📜",
    minAction: "users.view",
  },
  {
    href: "/dashboard/export",
    label: "Export",
    icon: "⬇",
    minAction: "export.users",
  },
];

function RoleBadge({ role }: { role: AdminRole }) {
  return <Badge value={role} />;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { claims, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !claims) router.replace("/login");
  }, [loading, claims, router]);

  if (loading || !claims) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
      </div>
    );
  }

  const visibleNav = NAV.filter((item) => can(claims.role, item.minAction));

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600/20 text-xl">
            🛡️
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-50">VeilVPN</p>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Admin console
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {visibleNav.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-cyan-600/15 font-medium text-cyan-200"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                    }`}
                  >
                    <span className="w-5 text-center" aria-hidden>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-zinc-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="max-w-[9rem] truncate text-xs text-zinc-400">
              {claims.email}
            </p>
            <RoleBadge role={claims.role} />
          </div>
          <button onClick={logout} className="btn-ghost w-full py-1.5 text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <main className="ml-64 min-h-screen flex-1">
        <div className="mx-auto max-w-6xl p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
