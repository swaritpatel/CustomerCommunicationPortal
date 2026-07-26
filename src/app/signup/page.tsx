import Link from "next/link";

import { SignupForm } from "@/modules/auth/components/signup-form";
import { PublicNavbar } from "@/modules/navigation/public-navbar";
import { findUsableInvite } from "@/modules/team/invites";

type SignupPageProps = {
  searchParams?: Promise<{
    invite?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const inviteToken = params?.invite?.trim() || "";
  const invite = inviteToken ? await findUsableInvite(inviteToken) : null;
  const usableInvite = invite && invite.status === "PENDING" && invite.expiresAt > new Date() ? invite : null;

  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-7xl gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="card fade-up flex rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <div className="m-auto w-full max-w-md">
            <p className="eyebrow">Workspace bootstrap</p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em]">
              Create the first admin account.
            </h1>
            <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
              {usableInvite
                ? `Create your account to join ${usableInvite.workspace.name}.`
                : "This flow will create the workspace, attach the first Admin membership, and start verification."}
            </p>

            <SignupForm inviteToken={usableInvite?.token} inviteEmail={usableInvite?.email} />

            <div className="mt-6 flex items-center justify-between gap-4 text-sm text-[var(--color-muted)]">
              <span>Verification and reset flows follow the same trust model.</span>
              <Link
                href={usableInvite ? `/login?invite=${encodeURIComponent(usableInvite.token)}` : "/login"}
                className="font-semibold text-[var(--color-accent-strong)]"
              >
                Already have access?
              </Link>
            </div>
          </div>
        </section>

        <section className="card fade-up rounded-[2rem] p-8" style={{ animationDelay: "100ms" }}>
          <p className="eyebrow">What this creates</p>
          <div className="mt-4 max-w-2xl">
            <h2 className="text-5xl font-extrabold tracking-[-0.05em]">One clean origin for your support team.</h2>
            <p className="mt-5 text-base leading-8 text-[var(--color-muted)]">
              The first user becomes the workspace Admin, receives verification, and gets dropped into the team setup flow.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {[
              ["Workspace created", "Tenant boundary and default settings are established immediately."],
              ["Admin membership", "The creator gets full team-management access with last-admin protections."],
              ["Invite-ready state", "The next action is teammate invitation, not a dead-end welcome page."],
              ["Assignment foundation", "Conversation ownership can reference the member model without rework."],
            ].map(([title, description], index) => (
              <article key={title} className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5">
                <div className="eyebrow">0{index + 1}</div>
                <h3 className="mt-3 text-lg font-bold tracking-[-0.03em]">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
      </main>
    </>
  );
}
