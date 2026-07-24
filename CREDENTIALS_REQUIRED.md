# RelayDesk Credentials Required

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

Inbound webhook route:

- POST /api/email/inbound
  - Expected JSON fields: workspaceSlug (or recipient with +slug), from, subject, text/html, messageId, inReplyTo, references.

## Optional Debug

- CHAT_DEBUG
  - Set to true to print chat info logs in server terminal.
  - Warnings and errors are always logged.

## Optional UI

- NEXT_PUBLIC_APP_URL
  - Used by the landing page install snippet.
  - If not set, the snippet falls back to APP_URL and then http://localhost:3000.

## Why chat may look "not working"

- Agent inbox (/chat) requires login session cookies.
- Without login, /chat redirects to /login and cannot receive or send agent messages.
- Widget embed can still initialize, but two-way chat needs an authenticated agent online.
