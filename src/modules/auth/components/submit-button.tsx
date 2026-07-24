"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
};

export function SubmitButton({ idleLabel, pendingLabel }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
