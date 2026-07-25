# CCP (Customer Communication Platform) Credentials Required

This project needs these environment variables to run correctly.

## Required

- DATABASE_URL
  - Neon Postgres connection string.
- JWT_ACCESS_SECRET
  - At least 32 characters.
- JWT_REFRESH_SECRET
  - At least 32 characters.
- APP_URL
  - Public base URL, for example http://localhost:3000 in dev.
- COOKIE_DOMAIN
  - Use localhost for local dev.

## Email Channel

- SMTP_HOST
  - SMTP server hostname.
- SMTP_PORT
  - SMTP port, usually 587 (TLS) or 465 (SSL).
- SMTP_USER
  - SMTP username.
- SMTP_PASS
  - SMTP password or app token.
- SMTP_SECURE
  - true for SSL (usually 465), false for STARTTLS (usually 587).
- SMTP_FROM_EMAIL
  - Sender email used for agent replies.
- SMTP_FROM_NAME
  - Optional display name for sender.
- INBOUND_EMAIL_WEBHOOK_SECRET
  - Secret expected in x-relaydesk-email-secret for inbound email webhook calls.
- INBOUND_EMAIL_DOMAIN
  - Optional fallback domain for generated Message-ID values.
- EMAIL_WEBHOOK_URLS
  - Optional comma-separated webhook URLs for email event delivery (inbound received, reply sent, SLA events).

Inbound webhook route:

- POST /api/email/inbound
  - Expected JSON fields: workspaceSlug (or recipient with +slug), from, subject, text/html, messageId, inReplyTo, references.

Email verification tooling:

- GET /api/email/health
  - Requires active login session.
  - Returns SMTP + inbound readiness flags.
- npm run email:verify
  - Runs inbound parsing + threading validation.
  - Runs real SMTP outbound check when SMTP vars are fully configured.

## Optional Debug

- CHAT_DEBUG
  - Set to true to print chat info logs in server terminal.
  - Warnings and errors are always logged.

## Optional UI

- NEXT_PUBLIC_APP_URL
  - Used by the landing page install snippet.
  - If not set, the snippet falls back to APP_URL and then http://localhost:3000.

## Optional Realtime WebSockets

- NEXT_PUBLIC_REALTIME_URL
  - Browser-facing Socket.IO gateway URL, for example http://localhost:3001.
- REALTIME_SERVER_URL
  - Server-facing realtime gateway URL, for example http://127.0.0.1:3001.
- REALTIME_INTERNAL_SECRET
  - Shared secret used by Next.js API routes when posting to the realtime gateway /emit bridge.
- REALTIME_PORT
  - Port for `npm run realtime`, default 3001.

If these are missing or the realtime gateway is offline, chat still works through SSE and fallback polling.

## Optional AI Chat Agent

- AI_CHAT_MODE
  - off, assist, or autoreply.
  - Use autoreply to let the system post policy-aware agent replies automatically.
- AI_PROVIDER
  - Provider name label for observability (for example, openai).
- AI_API_KEY
  - API key used by the chat completion provider.
- AI_MODEL
  - Model name (for example, gpt-4o-mini).
- AI_BASE_URL
  - Provider base URL (default is https://api.openai.com).
- AI_TEMPERATURE
  - Sampling temperature from 0 to 2 (recommended: 0.5 to 0.8 for human tone).
- AI_MAX_TOKENS
  - Max completion tokens for the AI reply.
- AI_POLICY_NAME
  - Policy profile name for logging and policy selection.

Auto-reply behavior:

- Only runs for live chat widget conversations.
- Automatically skips when an active human agent is online.
- Uses policy-driven escalation triggers to hand off sensitive cases.

## Why chat may look "not working"

- Agent inbox (/chat) requires login session cookies.
- Without login, /chat redirects to /login and cannot receive or send agent messages.
- Widget embed can still initialize, but two-way chat needs an authenticated agent online.
