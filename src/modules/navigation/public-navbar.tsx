import Link from "next/link";
import { ArrowRight, LayoutDashboard, LogOut, MessageCircleMore, Sparkles } from "lucide-react";

import { logoutAction } from "@/modules/auth/actions";
import { getSessionClaims } from "@/modules/auth/session";

export async function PublicNavbar() {
  const claims = await getSessionClaims();

  return (
    <header className="mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-7xl rounded-lg border border-white/10 bg-[#141620] px-4 py-3 text-white shadow-[0_16px_45px_rgba(20,22,32,0.18)] sm:w-[calc(100%-2.5rem)] sm:px-5">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-accent)] via-[var(--color-violet)] to-[var(--color-cyan)] text-white">
            <Sparkles size={18} />
          </span>
          <span className="hidden sm:block">
            <strong className="block text-sm font-extrabold">Cosmofeed</strong>
            <span className="hidden text-xs text-white/50 sm:block">Customer communication platform</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm font-semibold text-white/68">
          <Link className="hidden rounded-md px-3 py-2 transition hover:bg-white/8 hover:text-white md:block" href="/">
            Home
          </Link>
          <Link className="hidden rounded-md px-3 py-2 transition hover:bg-white/8 hover:text-white md:block" href="/overview">
            Overview
          </Link>
          <Link className="hidden items-center gap-2 rounded-md px-3 py-2 transition hover:bg-white/8 hover:text-white lg:flex" href="/widget/chat?workspace=pinelabs">
            <MessageCircleMore size={15} />
            Widget
          </Link>
          {claims ? (
            <>
              <Link className="ml-1 inline-flex min-w-[118px] items-center justify-center gap-2 rounded-md bg-white px-3 py-2 font-bold !text-[#141620]" href="/dashboard">
                <LayoutDashboard size={15} />
                Dashboard
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="grid h-9 w-9 place-items-center rounded-md border border-white/12 bg-white/6 text-white/72" title="Log out" aria-label="Log out">
                  <LogOut size={16} />
                </button>
              </form>
            </>
          ) : (
            <>
              <Link className="rounded-md px-2.5 py-2 text-white/76 hover:bg-white/8 hover:text-white sm:px-3" href="/login">
                Login
              </Link>
              <Link className="ml-1 inline-flex min-w-[98px] items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-2 font-bold !text-white shadow-[0_8px_22px_rgba(230,47,137,0.28)]" href="/signup">
                Sign up
                <ArrowRight size={15} />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
