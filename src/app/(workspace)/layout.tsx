import type { ReactNode } from "react";
import Link from "next/link";

import { requireActiveMembership } from "@/modules/auth/guards";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Live Chat" },
  { href: "/inbox", label: "Email Inbox" },
  { href: "/team", label: "Team" },
  { href: "/team#invites", label: "Invites" },
  { href: "/team#assignment", label: "Assignment" },
];

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { membership } = await requireActiveMembership();

  return (
    <div className="min-h-screen px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="card rounded-[2rem] px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="eyebrow">CCP Workspace</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-accent)] font-bold text-white">
                  <span className="text-[10px] tracking-[0.08em]">CCP</span>
                </div>
                <div>
                  <h1 className="text-xl font-extrabold tracking-[-0.03em]">{membership.workspace.name}</h1>
                  <p className="text-sm text-[var(--color-muted)]">
                    {membership.role} workspace · {membership.user.email}
                  </p>
                </div>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[var(--color-muted)]">
              <Link href="/" className="btn-secondary">
                Overview
              </Link>
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:border-[rgba(182,90,52,0.32)] hover:bg-[rgba(255,255,255,0.72)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}