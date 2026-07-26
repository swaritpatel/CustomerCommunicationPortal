import Link from "next/link";

import { LoginForm } from "@/modules/auth/components/login-form";
import { PublicNavbar } from "@/modules/navigation/public-navbar";
import { findUsableInvite } from "@/modules/team/invites";

type LoginPageProps = {
  searchParams?: Promise<{
    invite?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const inviteToken = params?.invite?.trim() || "";
  const invite = inviteToken ? await findUsableInvite(inviteToken) : null;
  const usableInvite = invite && invite.status === "PENDING" && invite.expiresAt > new Date() ? invite : null;

  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-7xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card fade-up hidden rounded-[2rem] p-8 lg:flex lg:flex-col lg:justify-between">
          <div>
            <p className="eyebrow">CCP / Login</p>
            <h1 className="mt-4 max-w-xl text-5xl font-extrabold tracking-[-0.05em]">
              Keep the inbox secure without slowing the team down.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-8 text-[var(--color-muted)]">
              Production-ready authentication starts with clarity: verified users, recoverable accounts,
              and clean role boundaries.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Session rotation", "15 minute access, refresh-backed continuity."],
              ["Rate limiting", "Abuse protection on login and reset paths."],
              ["Audit trail", "Every auth transition prepared for traceability."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-[1.4rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.55)] p-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-soft)]">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card fade-up flex rounded-[2rem] p-6 sm:p-8 lg:p-10" style={{ animationDelay: "100ms" }}>
          <div className="m-auto w-full max-w-md">
            <p className="eyebrow">Welcome back</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em]">Log into your workspace</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
              {usableInvite
                ? `Log in to accept your invite to ${usableInvite.workspace.name}.`
                : "Use your work email and password. Full session hardening and verification will wire into this flow next."}
            </p>

            <LoginForm inviteToken={usableInvite?.token} inviteEmail={usableInvite?.email} />

            <div className="mt-6 flex items-center justify-between gap-4 text-sm text-[var(--color-muted)]">
              <Link href="/" className="font-semibold text-[var(--color-ink)]">
                Back to overview
              </Link>
              <span>Forgot password flow next</span>
            </div>
          </div>
        </section>
      </div>
      </main>
    </>
  );
}
