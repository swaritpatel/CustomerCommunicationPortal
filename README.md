This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Project Credentials

See [CREDENTIALS_REQUIRED.md](CREDENTIALS_REQUIRED.md) for all required environment variables and chat prerequisites.

## Unified Inbox (Feature 04)

/inbox is the primary operator dashboard. It combines live chat and email conversations into one queue.

### Unified inbox capabilities

- Single conversation list for CHAT_WIDGET and EMAIL channels
- Filters for channel, assignee, and status
- Admin assignment/reassignment controls
- Open, snooze, and resolve controls for every conversation
- Channel-aware reply composer: chat replies stay in chat, email replies send through SMTP
- WebSocket realtime invalidation with SSE and polling fallback
- Canned responses stored locally in the browser
- AI draft helper based on recent conversation context
- AI issue summaries for long threads, including user intent, attempted fixes, current status, and key details
- Contact timeline for customers with email history
- SLA breach indicators for first response and resolution age
- Analytics snapshot for volume, channel mix, response time, resolution rate, busiest hours, and agent load

### Unified inbox API

- GET /api/inbox/conversations - workspace-scoped conversation list with filters.
- GET /api/inbox/messages?conversationId=... - read thread messages and contact timeline.
- POST /api/inbox/reply - reply to chat or email from the same composer.
- POST /api/inbox/status - update OPEN, SNOOZED, or RESOLVED status.
- POST /api/inbox/assignment - assign, reassign, or unassign conversations. Admin only.
- POST /api/inbox/draft - generate a draft from recent conversation context and canned responses.
- POST /api/inbox/summary - generate or refresh a concise issue summary for the active thread.
- GET /api/inbox/analytics - unified response, resolution, channel, and workload metrics.

## Realtime Architecture

The app supports a free self-hosted WebSocket gateway using Socket.IO.

### Local realtime run

Run these in two terminals:

```bash
npm run dev
npm run realtime
```

Optional env values:

```text
NEXT_PUBLIC_REALTIME_URL=http://localhost:3001
REALTIME_SERVER_URL=http://127.0.0.1:3001
REALTIME_INTERNAL_SECRET=dev-realtime-secret
REALTIME_PORT=3001
```

### How it works

- Browser clients join `conversation:{conversationId}` rooms over WebSockets.
- Next.js API routes keep the database as the source of truth.
- After message, reply, or typing changes, the API calls the realtime gateway `/emit` bridge.
- Socket payloads are invalidation events only, not message bodies.
- Clients fetch the authenticated REST snapshot after each event, preserving tenant isolation and server ordering.
- Existing SSE streams and stale-connection polling remain as graceful fallback.

### Production scale path

For multiple realtime gateway instances, add Redis pub/sub or the Socket.IO Redis adapter. Use rooms like `workspace:{workspaceId}` and `conversation:{conversationId}`, store messages with monotonic per-conversation sequence numbers, and on reconnect fetch anything after the last seen sequence.

## Knowledge Base (Feature 05)

/knowledge-base lets workspace agents create customer help content. Published articles are available publicly at /help/[workspaceSlug] and are suggested inside the chat widget when a visitor types a matching question.

### Knowledge base capabilities

- Create and edit rich text help articles.
- Save drafts or publish articles.
- Organize articles into categories and sections.
- Public help center with article search.
- Chat widget auto-suggestions from published articles.
- Custom domain records for public help centers, including DNS verification state and SSL provisioning state.

### Knowledge base API

- GET /api/kb/manage - authenticated workspace categories and articles.
- POST /api/kb/manage - saveCategory or saveArticle for the active workspace.
- GET /api/kb/search?workspace=...&q=... - public published article search.
- GET /api/kb/suggest?workspace=...&q=... - public top article suggestions for chat.
- GET /api/kb/domain - authenticated custom domain configuration for the workspace.
- POST /api/kb/domain - connectDomain or verifyDomain for a help-center hostname.

### Agent workflow

1. Open /knowledge-base while logged in.
2. Add categories for common support areas.
3. Write article content in the editor.
4. Save as draft while editing or publish when ready.
5. Open /help/[workspaceSlug] to verify customer-facing search.
6. Type a related question in the chat widget to confirm suggestions appear.

## Custom Domains (Feature 07)

Workspaces can connect a help-center hostname such as help.customer.com. The local implementation stores the domain, returns DNS instructions, and verifies ownership with a stubbed TXT-token match.

### Current implementation

- Admins add a hostname from /knowledge-base.
- The app creates a unique verification token.
- The UI shows required records:
  - CNAME help.customer.com -> [workspaceSlug].ccp-help.local
  - TXT _ccp-help.help.customer.com -> ccp-domain-verify=...
- The Verify button simulates DNS by submitting the expected TXT token.
- Verified domains are marked SSL active for local/demo routing.
- Requests to the app root with a verified custom Host render that workspace's public help center.

### Production SSL approach

In production, the verify endpoint should query authoritative DNS for the TXT record and CNAME target. Once verified, enqueue an SSL provisioning job:

1. If using Cloudflare for SaaS, create a custom hostname via Cloudflare API, let Cloudflare issue and renew the certificate, and poll hostname status.
2. If self-hosting, use ACME HTTP-01 or DNS-01 with Let's Encrypt, store certificate metadata outside the app database, and terminate TLS at the edge/proxy.
3. Keep the database statuses as the source of truth for UI: PENDING, VERIFIED, PROVISIONING, ACTIVE, FAILED.
4. Route by Host header only after ownership is verified and SSL is active.

## Email Channel (Feature 03)

This project includes an email channel with:

- Inbound webhook ingestion
- Message-ID based thread continuity
- Unified inbox integration at /inbox
- SMTP outbound replies
- AI draft generation
- Canned responses stored locally in the browser
- Contact timeline and SLA analytics
- Open, snoozed, and resolved conversation states

### Routes

- GET /api/email/conversations - list workspace email conversations.
- GET /api/email/messages?conversationId=... - read a thread and mark visitor email messages as read by the agent.
- POST /api/email/inbound - receive provider/webhook inbound email JSON.
- POST /api/email/reply - send an SMTP reply and append it to the thread.
- POST /api/email/status - update an email conversation to OPEN, SNOOZED, or RESOLVED.
- POST /api/email/draft - generate a local draft from the recent thread and canned response text.
- GET /api/email/contact-timeline?conversationId=... - show other conversations for the same customer email.
- GET /api/email/analytics - return email volume, first-response, and resolution metrics.
- GET /api/email/health - authenticated SMTP/inbound readiness check.

### Inbound webhook payload (JSON)

Send this shape to /api/email/inbound:

```json
{
	"workspaceSlug": "acme-support",
	"recipient": "support+acme-support@example.com",
	"from": "Customer Name <customer@example.com>",
	"subject": "Need help with billing",
	"text": "My invoice is incorrect...",
	"html": "<p>My invoice is incorrect...</p>",
	"messageId": "<msg-123@example.com>",
	"inReplyTo": "<msg-122@example.com>",
	"references": "<msg-120@example.com> <msg-122@example.com>"
}
```

If INBOUND_EMAIL_WEBHOOK_SECRET is set, include header:

```text
x-relaydesk-email-secret: <INBOUND_EMAIL_WEBHOOK_SECRET>
```

### Agent workflow

1. Open /inbox while logged in.
2. Filter to Email or select an email conversation from the unified queue.
3. Use AI draft or canned responses to prepare a reply.
4. Send reply through SMTP.
5. Mark the thread as Snoozed or Resolved when appropriate.
6. Reopen resolved/snoozed threads when a customer replies or when follow-up is needed.

### Local verification flow

1. Run app and log in at /login.
2. Open /inbox.
3. Send inbound JSON to /api/email/inbound.
4. Confirm conversation appears in /inbox.
5. Change the conversation status from /inbox.
6. Reply from /inbox (requires SMTP_* env vars).

## Live Chat AI Agent (Policy-Aware)

This project can auto-reply in the chat widget with policy-aware responses.

	- Reads recent transcript context
	- Applies policy constraints and escalation triggers
	- Replies only for widget chat conversations
	- Skips auto-reply when a human agent is currently online

Required settings for live AI replies:


## Real Email Provider Setup

Use any SMTP provider (SendGrid, Mailgun, SES, Gmail workspace SMTP) by filling SMTP_* variables.

Recommended baseline:

- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- SMTP_SECURE
- SMTP_FROM_EMAIL
- SMTP_FROM_NAME
- INBOUND_EMAIL_WEBHOOK_SECRET
- INBOUND_EMAIL_DOMAIN

### Suggested values (SendGrid SMTP)

- SMTP_HOST=smtp.sendgrid.net
- SMTP_PORT=587
- SMTP_USER=apikey
- SMTP_PASS=<your-sendgrid-api-key>
- SMTP_SECURE=false

### Health and verification

- Health route (requires login session): GET /api/email/health
- End-to-end verifier: npm run email:verify

The verifier checks:

1. Inbound parsing route
2. Threading consistency using In-Reply-To and References
3. Optional real SMTP outbound send (if SMTP vars are configured)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# CustomerCommunicationPortal
