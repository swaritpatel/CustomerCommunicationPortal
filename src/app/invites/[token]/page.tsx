import Link from "next/link";

import { PublicNavbar } from "@/modules/navigation/public-navbar";
import { findUsableInvite } from "@/modules/team/invites";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await findUsableInvite(token);
  const isUsable = invite && invite.status === "PENDING" && invite.expiresAt > new Date();
  const signupHref = `/signup?invite=${encodeURIComponent(token)}`;
  const loginHref = `/login?invite=${encodeURIComponent(token)}`;

  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-3xl items-center">
          <section className="card fade-up w-full rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-wrap items-center gap-3 text-sm font-semibold text-[var(--color-muted)]">
              <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/">
                Home
              </Link>
              <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/overview">
                Overview
              </Link>
              <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/login">
                Login
              </Link>
              <Link className="rounded-full border border-[var(--color-line)] px-4 py-2 transition hover:bg-white" href="/signup">
                Sign up
              </Link>
            </div>

            <p className="eyebrow">Team invite</p>
            {isUsable ? (
              <>
                <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em]">
                  Join {invite.workspace.name}
                </h1>
                <p className="mt-4 text-base leading-8 text-[var(--color-muted)]">
                  You have been invited as {invite.role.toLowerCase()} using {invite.email}. Create an account or log in with this email to activate your seat.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link className="btn-primary text-center" href={signupHref}>
                    Create account
                  </Link>
                  <Link className="btn-secondary text-center" href={loginHref}>
                    Log in instead
                  </Link>
                </div>
                <p className="mt-6 text-sm leading-7 text-[var(--color-muted)]">
                  This invite expires on {invite.expiresAt.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em]">
                  This invite is no longer active
                </h1>
                <p className="mt-4 text-base leading-8 text-[var(--color-muted)]">
                  Ask a workspace Admin to send a new invite from the Team page.
                </p>
                <Link className="btn-secondary mt-8 inline-flex" href="/login">
                  Back to login
                </Link>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
