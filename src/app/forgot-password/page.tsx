import Link from "next/link";

import { ForgotPasswordForm } from "@/modules/auth/components/forgot-password-form";
import { PublicNavbar } from "@/modules/navigation/public-navbar";

export default function ForgotPasswordPage() {
  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-7xl gap-6 lg:grid-cols-[0.94fr_1.06fr]">
          <section className="card fade-up flex rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <div className="m-auto w-full max-w-md">
              <p className="eyebrow">Account recovery</p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em]">
                Reset your workspace password.
              </h1>
              <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                Enter your account email and we will send a time-limited reset link if the account exists.
              </p>

              <ForgotPasswordForm />

              <div className="mt-6 flex items-center justify-between gap-4 text-sm text-[var(--color-muted)]">
                <span>Reset links expire after 30 minutes.</span>
                <Link href="/login" className="font-semibold text-[var(--color-accent-strong)]">
                  Back to login
                </Link>
              </div>
            </div>
          </section>

          <section className="card fade-up hidden rounded-[2rem] p-8 lg:block" style={{ animationDelay: "100ms" }}>
            <p className="eyebrow">Security posture</p>
            <h2 className="mt-4 max-w-xl text-5xl font-extrabold tracking-[-0.05em]">
              Recovery without exposing who has an account.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-8 text-[var(--color-muted)]">
              The flow stores only hashed reset tokens, revokes existing sessions after password changes,
              and always returns a neutral response from the request screen.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
