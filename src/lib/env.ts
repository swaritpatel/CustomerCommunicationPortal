import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters."),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters."),
  APP_URL: z.url(),
  COOKIE_DOMAIN: z.string().min(1, "COOKIE_DOMAIN is required."),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
  SMTP_FROM_EMAIL: z.email().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),
  INBOUND_EMAIL_DOMAIN: z.string().optional(),
  EMAIL_WEBHOOK_URLS: z.string().optional(),
  AI_CHAT_MODE: z
    .union([z.literal("off"), z.literal("assist"), z.literal("autoreply")])
    .optional()
    .transform((value) => value ?? "off"),
  AI_PROVIDER: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.url().optional(),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  AI_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  AI_POLICY_NAME: z.string().optional(),
});

export const serverEnv = serverEnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  APP_URL: process.env.APP_URL,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME,
  INBOUND_EMAIL_WEBHOOK_SECRET: process.env.INBOUND_EMAIL_WEBHOOK_SECRET,
  INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN,
  EMAIL_WEBHOOK_URLS: process.env.EMAIL_WEBHOOK_URLS,
  AI_CHAT_MODE: process.env.AI_CHAT_MODE,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_TEMPERATURE: process.env.AI_TEMPERATURE,
  AI_MAX_TOKENS: process.env.AI_MAX_TOKENS,
  AI_POLICY_NAME: process.env.AI_POLICY_NAME,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
