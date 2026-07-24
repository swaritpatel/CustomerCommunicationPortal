"use client";

import { useActionState } from "react";

import { signupAction } from "@/modules/auth/actions";
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

export function SignupForm() {
  const [state, action] = useActionState(signupAction, initialAuthActionState);

  return (
    <form action={action} className="mt-8 space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="workspaceName">
          Workspace name
        </label>
        <input id="workspaceName" name="workspaceName" className="input" placeholder="Northstar Support" />
        <FieldError state={state} field="workspaceName" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="fullName">
          Full name
        </label>
        <input id="fullName" name="fullName" className="input" placeholder="Aarav Mehta" />
        <FieldError state={state} field="fullName" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="email">
          Work email
        </label>
        <input id="email" name="email" type="email" className="input" placeholder="aarav@northstar.io" />
        <FieldError state={state} field="email" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" className="input" placeholder="At least 12 characters" />
        <FieldError state={state} field="password" />
      </div>

      {state.message ? (
        <div aria-live="polite" className="rounded-[1.25rem] border border-[rgba(170,61,49,0.2)] bg-[rgba(170,61,49,0.08)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {state.message}
        </div>
      ) : null}

      <SubmitButton idleLabel="Create workspace" pendingLabel="Creating workspace..." />
    </form>
  );
}
