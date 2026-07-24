export type AuthActionState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialAuthActionState: AuthActionState = {
  status: "idle",
};
