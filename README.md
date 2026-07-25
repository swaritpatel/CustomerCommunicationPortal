This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Project Credentials

See [CREDENTIALS_REQUIRED.md](CREDENTIALS_REQUIRED.md) for all required environment variables and chat prerequisites.

## Email Channel (Feature 03)

This project includes an email channel with:

- Inbound email webhook ingestion
- Threading via Message-ID, In-Reply-To, and References
- Agent replies from dashboard via SMTP
- AI-assisted reply drafts in inbox
- Canned responses (tag + quick insert)
- Contact timeline for customer history
- SLA indicators + analytics API
- Configurable outgoing webhooks for email events

### Routes

- Inbound webhook: POST /api/email/inbound
- Email conversation list: GET /api/email/conversations
- Email thread messages: GET /api/email/messages?conversationId=...
- Agent reply: POST /api/email/reply
- AI draft: POST /api/email/draft
- Contact timeline: GET /api/email/contact-timeline?conversationId=...
- Analytics: GET /api/email/analytics
- Agent UI: /inbox

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

- x-relaydesk-email-secret: your_secret

### Local verification flow

1. Run app and log in at /login.
2. Open /inbox.
3. Send inbound JSON to /api/email/inbound.
4. Confirm conversation appears in /inbox.
5. Reply from /inbox (requires SMTP_* env vars).

## Live Chat AI Agent (Policy-Aware)

This project can auto-reply in the chat widget with policy-aware responses.

- Mode is controlled by AI_CHAT_MODE: off, assist, autoreply
- In autoreply mode, the system:
	- Reads recent transcript context
	- Applies policy constraints and escalation triggers
	- Replies only for widget chat conversations
	- Skips auto-reply when a human agent is currently online

Required settings for live AI replies:

- AI_CHAT_MODE=autoreply
- AI_API_KEY
- AI_MODEL (example: gpt-4o-mini)
- Optional: AI_BASE_URL, AI_TEMPERATURE, AI_MAX_TOKENS, AI_POLICY_NAME

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
