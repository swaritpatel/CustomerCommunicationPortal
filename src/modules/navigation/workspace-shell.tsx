"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Gauge,
  Inbox,
  LogOut,
  MessageCircleMore,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { logoutAction } from "@/modules/auth/actions";

type WorkspaceShellProps = {
  children: ReactNode;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  userEmail: string;
  unreadCount: number;
  unresolvedCount: number;
  chatUnreadCount: number;
  pendingInviteCount: number;
};

type WorkspaceBadgeCounts = {
  unreadCount: number;
  unresolvedCount: number;
  chatUnreadCount: number;
  pendingInviteCount: number;
};

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "unread" | "chat" | "invites";
};

const primaryNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Command center", icon: Gauge },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "unread" },
  { href: "/chat", label: "Live chat", icon: MessageCircleMore, badge: "chat" },
  { href: "/knowledge-base", label: "Knowledge", icon: BookOpen },
];

const manageNavigation: NavigationItem[] = [
  { href: "/policies", label: "AI policies", icon: ShieldCheck },
  { href: "/team", label: "Team", icon: Users, badge: "invites" },
  { href: "/overview", label: "Product overview", icon: BarChart3 },
];

function compactCount(value: number) {
  if (value > 99) {
    return "99+";
  }

  return String(value);
}

function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function WorkspaceShell({
  children,
  workspaceName,
  workspaceSlug,
  role,
  userEmail,
  unreadCount,
  unresolvedCount,
  chatUnreadCount,
  pendingInviteCount,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<WorkspaceBadgeCounts>({
    unreadCount,
    unresolvedCount,
    chatUnreadCount,
    pendingInviteCount,
  });

  const refreshBadgeCounts = useCallback(async () => {
    const response = await fetch("/api/inbox/badges", { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return;
    }

    const payload = (await response.json().catch(() => null)) as Partial<WorkspaceBadgeCounts> | null;
    if (!payload) {
      return;
    }

    setCounts((current) => ({
      unreadCount: typeof payload.unreadCount === "number" ? payload.unreadCount : current.unreadCount,
      unresolvedCount: typeof payload.unresolvedCount === "number" ? payload.unresolvedCount : current.unresolvedCount,
      chatUnreadCount: typeof payload.chatUnreadCount === "number" ? payload.chatUnreadCount : current.chatUnreadCount,
      pendingInviteCount: typeof payload.pendingInviteCount === "number" ? payload.pendingInviteCount : current.pendingInviteCount,
    }));
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshBadgeCounts();
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [pathname, refreshBadgeCounts]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshBadgeCounts();
      }
    };
    const refresh = () => {
      void refreshBadgeCounts();
    };
    const interval = window.setInterval(refresh, 15_000);

    window.addEventListener("focus", refresh);
    window.addEventListener("workspace-badges:refresh", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("workspace-badges:refresh", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBadgeCounts]);

  const badgeValues = {
    unread: counts.unreadCount,
    chat: counts.chatUnreadCount,
    invites: counts.pendingInviteCount,
  };

  const renderLink = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const count = item.badge ? badgeValues[item.badge] : 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`workspace-nav-link ${active ? "is-active" : ""}`}
      >
        <span className="workspace-nav-icon">
          <Icon size={19} strokeWidth={active ? 2.4 : 2} />
          {count > 0 ? <span className="workspace-icon-badge">{compactCount(count)}</span> : null}
        </span>
        <span className="workspace-nav-label">{item.label}</span>
        {count > 0 ? <span className="workspace-nav-count">{compactCount(count)}</span> : null}
        <ChevronRight className="workspace-nav-chevron" size={15} />
      </Link>
    );
  };

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand" aria-label="Cosmofeed CCP home">
          <span className="workspace-brand-mark">
            <Sparkles size={18} />
          </span>
          <span>
            <strong>Cosmofeed</strong>
            <small>Support OS</small>
          </span>
        </Link>

        <div className="workspace-status-card">
          <span className="workspace-agent-orbit" aria-hidden="true">
            <Image src="/brand/cosmofeed-support-female.png" alt="" width={36} height={36} />
          </span>
          <span>
            <small>AI copilot</small>
            <strong><i /> Ready to assist</strong>
          </span>
        </div>

        <nav className="workspace-nav" aria-label="Workspace">
          <p>Workspace</p>
          {primaryNavigation.map(renderLink)}
          <p className="workspace-nav-section">Manage</p>
          {manageNavigation.map(renderLink)}
        </nav>

        <div className="workspace-sidebar-footer">
          <div className="workspace-queue-pulse">
            <span>
              <Radio size={16} />
              Open queue
            </span>
            <strong>{compactCount(counts.unresolvedCount)}</strong>
          </div>
          <div className="workspace-profile">
            <span className="workspace-profile-avatar">{initials(userEmail) || "CF"}</span>
            <span className="workspace-profile-copy">
              <strong>{workspaceName}</strong>
              <small>{role.toLowerCase()} · {userEmail}</small>
            </span>
            <form action={logoutAction}>
              <button type="submit" className="workspace-icon-button" title="Log out" aria-label="Log out">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <header className="workspace-mobile-header">
        <Link href="/dashboard" className="workspace-brand">
          <span className="workspace-brand-mark"><Sparkles size={17} /></span>
          <span><strong>Cosmofeed</strong><small>Support OS</small></span>
        </Link>
        <div className="workspace-mobile-actions">
          <Link href="/inbox" className="workspace-mobile-inbox" aria-label={`${counts.unreadCount} unread messages`}>
            <Inbox size={20} />
            {counts.unreadCount > 0 ? <span>{compactCount(counts.unreadCount)}</span> : null}
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="workspace-icon-button" title="Log out" aria-label="Log out">
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </header>

      <nav className="workspace-mobile-nav" aria-label="Mobile workspace">
        {primaryNavigation.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const count = item.badge ? badgeValues[item.badge] : 0;
          return (
            <Link key={item.href} href={item.href} className={active ? "is-active" : ""}>
              <span>
                <Icon size={20} />
                {count > 0 ? <i>{compactCount(count)}</i> : null}
              </span>
              <small>{item.label.replace("Command center", "Home").replace("Live chat", "Chat")}</small>
            </Link>
          );
        })}
        <Link href="/team" className={pathname.startsWith("/team") ? "is-active" : ""}>
          <span><Settings2 size={20} /></span>
          <small>More</small>
        </Link>
      </nav>

      <div className="workspace-main">
        <div className="workspace-topbar">
          <div>
            <p className="eyebrow">Customer communication platform</p>
            <h1>{workspaceName}</h1>
          </div>
          <div className="workspace-topbar-actions">
            <span className="workspace-live-indicator"><i /> Systems live</span>
            <Link href={`/help/${workspaceSlug}`} className="workspace-icon-button" title="Help center" aria-label="Help center">
              <CircleHelp size={18} />
            </Link>
          </div>
        </div>
        <div className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
