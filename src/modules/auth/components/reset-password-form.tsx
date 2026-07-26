"use client";

import { useActionState } from "react";

import { resetPasswordAction } from "@/modules/auth/actions";
import { SubmitButton } from "@/modules/auth/components/submit-button";
import {
  initialAuthActionState,
  type AuthActionState,
} from "@/modules/auth/form-state";

function FieldError({ state, field }: { state: AuthActionState; field: string }) {
  const message = state.fieldErrors?.[field]?.[0];

  if (!message) {
    return null;
  }

  return <p className="mt-2 text-sm text-[var(--color-danger)]">{message}</p>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, initialAuthActionState);
  const isSuccess = state.status === "success";

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--color-ink)]" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="At least 12 characters"
          className="input"
          autoComplete="new-password"
        />
        <FieldError state={state} field="password" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--color-ink)]" htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          placeholder="Repeat your new password"
          className="input"
          autoComplete="new-password"
        />
        <FieldError state={state} field="confirmPassword" />
      </div>

      {state.message ? (
        <div
          aria-live="polite"
          className={`rounded-[1.25rem] border px-4 py-3 text-sm ${
            isSuccess
              ? "border-[rgba(40,143,94,0.22)] bg-[rgba(40,143,94,0.08)] text-[var(--color-success)]"
              : "border-[rgba(170,61,49,0.2)] bg-[rgba(170,61,49,0.08)] text-[var(--color-danger)]"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      <SubmitButton idleLabel="Reset password" pendingLabel="Resetting..." />
    </form>
  );
}
