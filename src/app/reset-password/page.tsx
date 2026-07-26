import Link from "next/link";

import { ResetPasswordForm } from "@/modules/auth/components/reset-password-form";
import { PublicNavbar } from "@/modules/navigation/public-navbar";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params?.token?.trim() || "";

  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-7xl gap-6 lg:grid-cols-[0.94fr_1.06fr]">
          <section className="card fade-up flex rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <div className="m-auto w-full max-w-md">
              <p className="eyebrow">Password reset</p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em]">
                Create a new password.
              </h1>
              <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                Choose a strong password. After reset, old sessions are revoked and you will be signed in again.
              </p>

              {token ? (
                <ResetPasswordForm token={token} />
              ) : (
                <div className="mt-8 rounded-[1.25rem] border border-[rgba(170,61,49,0.2)] bg-[rgba(170,61,49,0.08)] px-4 py-3 text-sm text-[var(--color-danger)]">
                  This reset link is missing a token. Please request a new reset link.
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-4 text-sm text-[var(--color-muted)]">
                <Link href="/forgot-password" className="font-semibold text-[var(--color-accent-strong)]">
                  Request a new link
                </Link>
                <Link href="/login" className="font-semibold text-[var(--color-ink)]">
                  Back to login
                </Link>
              </div>
            </div>
          </section>

          <section className="card fade-up hidden rounded-[2rem] p-8 lg:block" style={{ animationDelay: "100ms" }}>
            <p className="eyebrow">Session protection</p>
            <h2 className="mt-4 max-w-xl text-5xl font-extrabold tracking-[-0.05em]">
              A clean reset closes stale access.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-8 text-[var(--color-muted)]">
              Existing sessions are revoked when the password changes, and unused reset links for the same user are invalidated.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
