import Link from "next/link";

import { logoutAction } from "@/modules/auth/actions";
import { getSessionClaims } from "@/modules/auth/session";

export async function PublicNavbar() {
  const claims = await getSessionClaims();

  return (
    <header className="mx-auto mt-4 w-[calc(100%-1.5rem)] max-w-7xl rounded-[2rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.74)] px-5 py-4 shadow-[0_20px_70px_rgba(31,41,55,0.08)] backdrop-blur sm:w-[calc(100%-2.5rem)] sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-[10px] font-black tracking-[0.08em] text-white">
            CCP
          </span>
          <span>
            <strong className="block text-lg font-extrabold tracking-[-0.03em] text-[var(--color-ink)]">
              Cosmofeed CCP
            </strong>
            <span className="text-sm text-[var(--color-muted)]">Customer communication platform</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[var(--color-muted)]">
          <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/">
            Home
          </Link>
          <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/overview">
            Overview
          </Link>
          <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/widget/embed?workspace=pinelabs">
            Widget
          </Link>
          {claims ? (
            <>
              <Link className="btn-secondary" href="/dashboard">
                Dashboard
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="btn-secondary">
                  Logout
                </button>
              </form>
            </>
          ) : (
            <>
              <Link className="btn-secondary" href="/login">
                Login
              </Link>
              <Link className="btn-primary" href="/signup">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
