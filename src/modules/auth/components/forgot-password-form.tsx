"use client";

import { useActionState } from "react";

import { forgotPasswordAction } from "@/modules/auth/actions";
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

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initialAuthActionState);
  const isSuccess = state.status === "success";

  return (
    <form action={action} className="mt-8 space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--color-ink)]" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="ops@company.com"
          className="input"
          autoComplete="email"
        />
        <FieldError state={state} field="email" />
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

      <SubmitButton idleLabel="Send reset link" pendingLabel="Sending..." />
    </form>
  );
}
