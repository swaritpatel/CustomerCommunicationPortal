"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/modules/auth/actions";
import {
  initialAuthActionState,
  type AuthActionState,
} from "@/modules/auth/form-state";
import { SubmitButton } from "@/modules/auth/components/submit-button";

function FieldError({ state, field }: { state: AuthActionState; field: string }) {
  const message = state.fieldErrors?.[field]?.[0];

  if (!message) {
    return null;
  }

  return <p className="mt-2 text-sm text-[var(--color-danger)]">{message}</p>;
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initialAuthActionState);

  return (
    <div className="mt-8 space-y-4">
      <a
        className="flex w-full items-center justify-center rounded-[1.25rem] border border-[var(--color-line)] bg-white px-5 py-3 text-sm font-bold text-[var(--color-ink)] transition hover:border-[var(--color-line-strong)]"
        href="/api/auth/google/account/start?mode=login"
      >
        Continue with Google
      </a>

      <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        or
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>

      <form action={action} className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--color-ink)]" htmlFor="email">
          Work email
        </label>
        <input id="email" name="email" type="email" placeholder="ops@ccp.app" className="input" />
        <FieldError state={state} field="email" />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="block text-sm font-semibold text-[var(--color-ink)]" htmlFor="password">
            Password
          </label>
          <Link href="/signup" className="text-sm font-semibold text-[var(--color-accent-strong)]">
            Need an account?
          </Link>
        </div>
        <input id="password" name="password" type="password" placeholder="Enter your password" className="input" />
        <FieldError state={state} field="password" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] px-4 py-3 text-sm text-[var(--color-muted)]">
        <span>Protected by signed sessions, server validation, and database-backed workspace context.</span>
        <span className="eyebrow">live</span>
      </div>

      {state.message ? (
        <div aria-live="polite" className="rounded-[1.25rem] border border-[rgba(170,61,49,0.2)] bg-[rgba(170,61,49,0.08)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {state.message}
        </div>
      ) : null}

      <SubmitButton idleLabel="Log in" pendingLabel="Logging in..." />
      </form>
    </div>
  );
}
