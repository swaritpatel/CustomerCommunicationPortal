import { z } from "zod";

const emailSchema = z.email().trim().toLowerCase();

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.");

const roleSchema = z.enum(["ADMIN", "AGENT"]);

export const signupSchema = z.object({
  workspaceName: z.string().trim().min(2, "Workspace name must be at least 2 characters.").max(80),
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters.").max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required."),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm the password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});

export const updateMemberRoleSchema = z.object({
  role: roleSchema,
});

export const assignmentSchema = z.object({
  conversationId: z.string().min(1, "Conversation id is required."),
  assigneeId: z.string().min(1, "Assignee id is required.").nullable(),
  reason: z.string().trim().max(240).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
