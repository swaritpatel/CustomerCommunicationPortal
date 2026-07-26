# Customer Communication Portal

A lightweight Intercom-style customer communication platform for handling website chat, email inboxes, support policies, AI-assisted replies, knowledge base articles, assignments, SLA tracking, and team workflows from one dashboard.

The product is built as a multi-workspace support system. Each workspace gets a unified inbox, an embeddable chat widget, an email channel, a public help center, internal support policies, team member invites, and AI assistance for summaries, drafts, acknowledgements, and auto-replies.

## Live Submission Links

| Item | URL / Value |
| --- | --- |
| Live product URL | `https://customer-communication-portal.vercel.app` |
| Dashboard / unified inbox | `https://customer-communication-portal.vercel.app/inbox` |
| Live chat bubble demo page | `https://customer-communication-portal.vercel.app/widget/embed?workspace=pinelabs` |
| Public help center | `https://customer-communication-portal.vercel.app/help/pinelabs` |
| Email inbox test address | `support.cosmofeed@gmail.com` |
| Realtime service | `https://customercommunicationportal.onrender.com` |
| Realtime health | `https://customercommunicationportal.onrender.com/health` |
| Queue worker service | `https://cosmofeed-help-ccp-worker.onrender.com` |
| Queue worker health | `https://cosmofeed-help-ccp-worker.onrender.com/health` |
| Inbound email webhook | `https://customer-communication-portal.vercel.app/api/email/inbound` |
| Gmail Pub/Sub push webhook | `https://customer-communication-portal.vercel.app/api/email/gmail/push?secret=<configured-secret>` |
| GitHub repository | `https://github.com/swaritpatel/CustomerCommunicationPortal` |

Note: `/widget/chat?workspace=pinelabs` is supported in the latest code as a compatibility route, but older deployments may only have `/widget/embed?workspace=pinelabs`.

## What Is Built

- Authentication with email/password, Google OAuth, and email-based password reset.
- Workspace creation and workspace-scoped access control.
- Team invites with signup/login acceptance flow.
- Unified inbox for live chat and email conversations.
- Embeddable JavaScript chat widget with one script tag.
- Visitor chat history persistence through local storage and database-backed conversations.
- Realtime chat updates through Socket.IO plus SSE/polling fallbacks.
- Typing states, online/offline presence, and read receipts.
- Ticket numbers generated after a real chat/email issue is captured.
- Email channel with Gmail OAuth, Gmail Pub/Sub push notifications, polling fallback, inbound parsing, SMTP replies, and Message-ID based threading.
- AI auto-acknowledgement for inbound email.
- AI chat auto-reply with policy-aware responses.
- AI provider fallback chain: OpenAI-compatible primary, Gemini, then Groq keys.
- Support policies editable from the admin portal.
- Knowledge base with published public help center.
- KB suggestions in chat and email responses.
- AI-generated draft replies and conversation summaries.
- Canned responses.
- SLA tracking for first response and resolution age.
- Dashboard analytics for volume, response time, resolution rate, busy hours, and agent workload.
- Assignment, reassignment, comments, and conversation status controls.
- Webhook dispatch hooks for email lifecycle events.

## What Is Skipped Or Simplified

- Production-grade custom-domain SSL provisioning is modeled but not fully automated.
- Gmail Pub/Sub push uses a shared webhook secret; Pub/Sub OIDC/JWT verification can be added as a harder production perimeter.
- Email sending uses SMTP provider credentials rather than a dedicated transactional email SDK.
- Advanced permissions are limited to `ADMIN` and `AGENT`.
- AI safety is prompt/policy based; there is no full moderation pipeline.
- Analytics are operational snapshots, not a warehouse-backed BI system.
- Realtime ordering depends on database timestamps and refetch-after-event rather than monotonic sequence IDs.

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | Next.js App Router, React 19, TypeScript | Product UI, dashboard, public pages, widget pages, API routes |
| Styling | CSS modules via `styled-jsx`, global CSS | Dashboard and widget styling without a separate design system dependency |
| Backend | Next.js Route Handlers | Auth, inbox, chat, email, KB, policies, team APIs |
| Database | PostgreSQL on Neon | Durable storage for users, workspaces, conversations, messages, policies, KB, sessions |
| ORM | Prisma 7 with `@prisma/adapter-pg` | Type-safe database access and schema management |
| Realtime | Socket.IO | Browser websocket channel for chat/inbox invalidation |
| Realtime scale | Socket.IO Redis adapter + Upstash Redis | Cross-instance room fanout for deployed realtime service |
| Background jobs | BullMQ | Email sends, auto-acks, queueable background tasks |
| Worker runtime | `tsx` Node worker | Long-lived queue worker on Render |
| Auth crypto | `jose`, `bcryptjs` | JWT/session token signing and password hashing |
| Password recovery | Hashed reset tokens + SMTP email | Time-limited account recovery without exposing account existence |
| Email sync | Gmail OAuth + Gmail API + Pub/Sub push + polling fallback | Pull support inbox messages into the unified inbox |
| Email send | Nodemailer + Brevo SMTP | Send support replies and acknowledgements |
| AI primary | OpenAI-compatible Chat Completions | Drafts, summaries, acknowledgements, chat replies |
| AI fallback 1 | Gemini API | Backup model if OpenAI-compatible provider fails |
| AI fallback 2 | Groq OpenAI-compatible API | Additional backup model pool using multiple free-tier keys |
| Validation | Zod | Environment parsing and runtime validation |
| Icons | Lucide React | UI iconography |
| Hosting | Vercel | Next.js app deployment |
| Long-running services | Render | Realtime server and queue worker |

## External Services And Purpose

| Service | Used For |
| --- | --- |
| Vercel | Hosts the Next.js product, API routes, dashboard, widget, help center |
| Render | Hosts long-lived realtime service and queue worker |
| Neon PostgreSQL | Primary relational database |
| Upstash Redis | Redis adapter for Socket.IO and BullMQ queue backing |
| Google Cloud OAuth | Connects `support.cosmofeed@gmail.com` through Gmail OAuth |
| Gmail API | Syncs inbound support email messages and thread metadata |
| Google Pub/Sub | Gmail push notification transport that triggers near-real-time sync |
| Brevo SMTP | Sends outbound support emails and acknowledgements |
| OpenAI API | Primary AI provider |
| Gemini API | First AI fallback provider |
| Groq API | Second AI fallback provider, with multiple keys tried in order |
| cron-job.org | Lightweight free-tier health checks for Render services during evaluation |

Important security note: real secret values are intentionally not committed in this README. The project uses `.env.local` locally and deployment environment variables in Vercel/Render. Never commit production `DATABASE_URL`, JWT secrets, API keys, OAuth secrets, SMTP passwords, Redis URLs, or webhook secrets.

## High-Level Architecture

The system is split into three runtime surfaces:

1. **Next.js product application** - serves the dashboard, public pages, widget iframe, and HTTP API routes.
2. **Realtime gateway** - a long-running Socket.IO service that broadcasts invalidation events to connected agents and visitors.
3. **Queue worker** - a long-running worker for email sends, auto-acknowledgements, Gmail watch renewal, polling fallback, and background jobs.

PostgreSQL is the durable source of truth. Redis is used only for realtime/queue coordination, not as the primary data store.

```mermaid
flowchart LR
  Visitor[Website visitor] --> Widget[Embeddable chat widget]
  CustomerEmail[Customer email] --> Gmail[Gmail inbox]
  Agent[Support agent/admin] --> Dashboard[Next.js dashboard]

  Widget --> NextAPI[Next.js API routes]
  Dashboard --> NextAPI
  Gmail --> PubSub[Google Pub/Sub notification]
  PubSub --> GmailPush[Next.js Gmail push webhook]
  GmailPush --> NextAPI
  NextAPI --> GmailAPI[Gmail API content fetch]
  GmailAPI --> Gmail

  NextAPI --> DB[(Neon PostgreSQL)]
  NextAPI --> Queue[BullMQ queue]
  Queue --> Worker[Render queue worker]
  Worker --> SMTP[Brevo SMTP]
  Worker --> WatchRenew[Gmail watch renewal + polling fallback]
  WatchRenew --> GmailAPI
  Worker --> DB

  NextAPI --> AI[AI provider chain]
  AI --> OpenAI[OpenAI-compatible]
  AI --> Gemini[Gemini fallback]
  AI --> Groq[Groq fallback keys]

  NextAPI --> Realtime[Render Socket.IO service]
  Realtime --> Redis[(Upstash Redis)]
  Realtime --> Widget
  Realtime --> Dashboard

  Dashboard --> HelpCenter[Knowledge base/help center]
  Widget --> HelpCenter
```

The database is the source of truth. Realtime events do not carry full message bodies; they tell clients that something changed. The clients then refetch the authenticated REST snapshot, which keeps tenant isolation and ordering logic on the server.

### HLD: System Context

```mermaid
flowchart TB
  subgraph Customers
    WebsiteVisitor[Website visitor]
    EmailCustomer[Email customer]
  end

  subgraph Product
    Widget[Chat widget iframe]
    Dashboard[Agent/admin dashboard]
    HelpCenter[Public help center]
    API[Next.js API boundary]
  end

  subgraph LongRunningServices
    RealtimeGateway[Socket.IO realtime gateway]
    QueueWorker[Queue worker]
  end

  subgraph DataStores
    Postgres[(PostgreSQL)]
    Redis[(Redis)]
  end

  subgraph ExternalProviders
    Gmail[Gmail API]
    PubSub[Google Pub/Sub]
    SMTP[Brevo SMTP]
    AIProviders[OpenAI / Gemini / Groq]
  end

  WebsiteVisitor --> Widget
  Widget --> API
  EmailCustomer --> Gmail
  Gmail --> PubSub
  PubSub --> API
  API --> Gmail
  Dashboard --> API
  HelpCenter --> API
  API --> Postgres
  API --> Redis
  API --> RealtimeGateway
  API --> QueueWorker
  QueueWorker --> SMTP
  QueueWorker --> Gmail
  QueueWorker --> Postgres
  API --> AIProviders
  RealtimeGateway --> Redis
  RealtimeGateway --> Dashboard
  RealtimeGateway --> Widget
```

### HLD: Deployment Topology

```mermaid
flowchart LR
  Browser[Browser clients] --> Vercel[Vercel: Next.js app]
  Vercel --> Neon[(Neon Postgres)]
  Vercel --> Upstash[(Upstash Redis)]
  Vercel --> RenderRealtime[Render: realtime service]
  Vercel --> RenderWorker[Render: queue worker]
  RenderRealtime --> Upstash
  RenderWorker --> Upstash
  RenderWorker --> Neon
  RenderWorker --> Brevo[Brevo SMTP]
  Vercel --> Google[Google OAuth/Gmail API]
  Google --> PubSub[Google Pub/Sub]
  PubSub --> Vercel
  RenderWorker --> Google
  Vercel --> AI[OpenAI/Gemini/Groq]
```

### HLD: Runtime Responsibilities

| Runtime | Responsibilities | Why It Exists |
| --- | --- | --- |
| Next.js app on Vercel | UI rendering, auth, REST APIs, widget iframe, public help center, Gmail OAuth, Gmail sync routes, Pub/Sub push webhook | Best fit for request/response product and API surface |
| Realtime service on Render | Socket.IO rooms, websocket/polling transport, `/emit` bridge, health endpoint | Vercel serverless functions are not ideal for long-lived websockets |
| Queue worker on Render | BullMQ processing, auto-ack email send, retries, Gmail watch renewal, polling fallback, health endpoint | Background work should not block user/API requests |
| PostgreSQL | Users, workspaces, messages, tickets, policies, KB, sessions, email refs | Relational data and tenant boundaries need strong consistency |
| Redis | Queue backend and Socket.IO adapter | Fanout and worker coordination |

### HLD: Design Principles

- **Workspace isolation first**: every operational table carries `workspaceId`; API handlers verify membership before returning data.
- **Database as source of truth**: realtime events trigger refetches instead of trusting socket payloads.
- **Channel abstraction**: chat and email both become `Conversation` + `ChatMessage` records, enabling one inbox UI.
- **Threading over subject matching**: email continuity uses `Message-ID`, `In-Reply-To`, and `References`.
- **Human handoff preserved**: AI can answer, draft, summarize, or auto-resolve only when policy allows; otherwise tickets stay open.
- **Graceful degradation**: if websocket fails, SSE/polling can still refresh; if all AI providers fail, a safe fallback reply is used.
- **Recoverable authentication**: password reset uses opaque, time-limited, hashed tokens and never exposes whether an email exists.
- **Secrets stay in environment**: no production secrets belong in source, README, commits, or screenshots.

## Low-Level Architecture

The low-level design follows a modular route-handler architecture. UI pages call route handlers. Route handlers call domain modules. Domain modules use Prisma for persistence, provider adapters for external calls, and broadcaster/queue helpers for side effects.

```mermaid
flowchart TB
  Page[React page/client component] --> Route[Next.js route handler]
  Route --> Guard[Session / visitor token guard]
  Route --> Domain[Domain module]
  Domain --> Prisma[Prisma client]
  Domain --> Provider[Provider adapter]
  Domain --> Queue[Queue enqueue]
  Domain --> Broadcast[Realtime broadcast]
  Prisma --> Postgres[(PostgreSQL)]
  Queue --> Worker[Queue worker]
  Broadcast --> Realtime[Socket.IO service]
```

### Next.js Application

- `src/app/page.tsx` - public landing/home page.
- `src/app/overview/page.tsx` - product overview.
- `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/forgot-password/page.tsx`, and `src/app/reset-password/page.tsx` - authentication entry points.
- `src/app/(workspace)/layout.tsx` - authenticated workspace shell and navigation.
- `src/app/(workspace)/inbox/page.tsx` - unified inbox UI.
- `src/app/(workspace)/dashboard/page.tsx` - analytics and SLA dashboard.
- `src/app/(workspace)/chat/page.tsx` - live chat operations view.
- `src/app/(workspace)/knowledge-base/page.tsx` - article/category/domain management.
- `src/app/(workspace)/policies/page.tsx` - support policy editor.
- `src/app/(workspace)/team/page.tsx` - members, invites, assignment operations.
- `src/app/widget/embed/page.tsx` - embeddable widget iframe page.
- `src/app/widget/chat/page.tsx` - compatibility route for direct widget access.
- `src/app/help/[workspaceSlug]/page.tsx` - public help center.
- `src/app/invites/[token]/page.tsx` - teammate invite acceptance.

### Core Modules

- `src/modules/auth/*` - signup, login, Google auth UI helpers, password reset, password hashing, session cookies, auth guards.
- `src/modules/chat/*` - visitor JWTs, widget chat, typing, auto-reply, AI policy logic, logs.
- `src/modules/email/*` - Gmail OAuth, Pub/Sub watch registration, sync, inbound normalization, threading, SMTP send, AI acknowledgements.
- `src/modules/inbox/*` - AI summaries and shared inbox behavior.
- `src/modules/kb/*` - help center search, article suggestions, article generation from resolved conversations.
- `src/modules/policies/*` - policy matching for AI replies and auto-resolve decisions.
- `src/modules/queue/*` - BullMQ connection, job enqueueing, queue worker.
- `src/modules/realtime/*` - client socket connection and server broadcast bridge.
- `src/modules/team/*` - invite creation, email invite, role policy.
- `src/modules/tickets/*` - unique ticket number generation.
- `src/modules/observability/*` - structured API and application logs.

### LLD: Module Responsibilities

| Module | Main Files | Responsibility |
| --- | --- | --- |
| Auth | `auth/actions.ts`, `auth/session.ts`, `auth/password.ts`, `auth/components/*`, `middleware.ts` | Signup/login, Google OAuth entry, password reset, password hashing, refresh sessions, cookies, workspace guards |
| Workspace shell | `navigation/workspace-shell.tsx`, `(workspace)/layout.tsx` | Authenticated navigation and current workspace framing |
| Chat widget | `chat/components/widget-chat-client.tsx`, `api/chat/*` | Visitor bootstrap, local persistence, send/read messages, typing, resolution feedback |
| Agent chat | `chat/components/agent-chat-client.tsx`, `api/chat/conversations` | Agent view of chat conversations and realtime updates |
| Unified inbox | `inbox/components/unified-inbox-client.tsx`, `api/inbox/*` | Shared operator queue for email and chat |
| Email channel | `email/process-inbound.ts`, `email/gmail.ts`, `email/send.ts`, `email/smtp.ts`, `api/email/gmail/push` | Gmail OAuth, Pub/Sub watch registration, push/poll sync, inbound normalization, threading, SMTP replies |
| AI reply engine | `chat/agent-reply.ts`, `email/ai-draft.ts`, `inbox/ai-summary.ts` | Provider calls, JSON parsing, fallback model chain |
| Policy engine | `policies/support-policies.ts`, `chat/agent-policy.ts` | Match support policies and control escalation/auto-resolve |
| KB | `kb/search.ts`, `kb/suggestions.ts`, `kb/from-conversation.ts` | Public search, suggested articles, article generation |
| Queue | `queue/enqueue.ts`, `queue/worker.ts`, `scripts/queue-worker.ts` | Background jobs, Gmail polling fallback, Gmail watch renewal, health endpoint |
| Realtime | `realtime/broadcast.ts`, `realtime/client.ts`, `scripts/realtime-server.mjs` | Room events and browser invalidation |
| Tickets | `tickets/ticket-number.ts` | Workspace-unique ticket numbers |

### LLD: Chat Message Write Path

```mermaid
sequenceDiagram
  participant Widget as Widget client
  participant ChatAPI as /api/chat/messages
  participant Auth as Visitor JWT
  participant DB as Prisma/Postgres
  participant AI as Auto-reply module
  participant RT as Realtime bridge

  Widget->>ChatAPI: POST message + Bearer visitor token
  ChatAPI->>Auth: verify visitor token
  Auth-->>ChatAPI: workspaceId + conversationId
  ChatAPI->>DB: insert ChatMessage(senderType=VISITOR)
  ChatAPI->>DB: update Conversation.updatedAt / visitorLastSeenAt
  ChatAPI->>AI: maybeGenerateAutoReply()
  AI->>DB: load recent messages + ticket + policies
  AI->>AI: OpenAI -> Gemini -> Groq fallback chain
  AI->>DB: insert AGENT reply or fallback message
  ChatAPI->>RT: broadcast message.created/conversation.updated
  ChatAPI-->>Widget: message JSON
```

### LLD: Agent Reply Path

```mermaid
sequenceDiagram
  participant Agent as Agent dashboard
  participant InboxAPI as /api/inbox/reply
  participant DB as Prisma/Postgres
  participant SMTP as SMTP provider
  participant RT as Realtime bridge

  Agent->>InboxAPI: POST conversationId + body
  InboxAPI->>DB: verify workspace membership
  InboxAPI->>DB: load conversation channel
  alt Chat channel
    InboxAPI->>DB: insert ChatMessage(senderType=AGENT)
  else Email channel
    InboxAPI->>SMTP: send email with threading headers
    SMTP-->>InboxAPI: outbound message id
    InboxAPI->>DB: insert ChatMessage(senderType=AGENT)
    InboxAPI->>DB: insert EmailMessageReference(source=OUTBOUND)
  end
  InboxAPI->>RT: broadcast conversation.updated
  InboxAPI-->>Agent: success
```

### LLD: Password Reset Flow

```mermaid
sequenceDiagram
  participant User as User
  participant Forgot as Forgot password page
  participant Auth as Auth server action
  participant DB as Prisma/Postgres
  participant SMTP as Brevo SMTP
  participant Reset as Reset password page

  User->>Forgot: enter account email
  Forgot->>Auth: requestPasswordResetAction(email)
  Auth->>DB: find user by normalized email
  alt User exists
    Auth->>Auth: generate opaque random token
    Auth->>DB: store hashed token + expiry
    Auth->>SMTP: send reset link using APP_URL
  else User missing
    Auth-->>Forgot: generic success response
  end
  Forgot-->>User: show neutral confirmation
  User->>Reset: open /reset-password?token=...
  Reset->>Auth: resetPasswordAction(token, newPassword)
  Auth->>DB: hash presented token and find unexpired unused token
  Auth->>DB: update password hash and mark token used
  Auth->>DB: invalidate existing refresh sessions
  Auth-->>Reset: redirect/login prompt
```

Security details:

1. The reset email uses an opaque random token; the database stores only a hash of that token.
2. The reset link is built from `APP_URL`, so production must set `APP_URL=https://customer-communication-portal.vercel.app`.
3. The request screen returns the same generic success message whether or not the email exists, preventing account enumeration.
4. Tokens expire after a short window and are single-use.
5. After a successful password reset, existing refresh sessions are invalidated so old sessions cannot continue silently.

### LLD: Gmail Push/Poll Sync And Threading

```mermaid
flowchart TD
  CustomerEmail[Customer emails support inbox] --> Gmail[Gmail inbox]
  Gmail --> PubSub[Pub/Sub notification]
  PubSub --> PushWebhook[/api/email/gmail/push]
  OAuthConnect[Gmail OAuth connect] --> Watch[Gmail users.watch]
  WorkerRenew[Queue worker watch renewal] --> Watch
  Watch --> PubSub
  WorkerPoll[Queue worker polling fallback] --> Sync[Sync Gmail messages]
  PushWebhook --> Sync
  Sync --> List[Gmail messages.list query]
  List --> Fetch[Gmail messages.get full payload]
  Fetch --> Normalize[Normalize sender, subject, text/html, headers]
  Normalize --> ExistingRef{Message-ID or references known?}
  ExistingRef -->|yes| ExistingConversation[Append to existing Conversation]
  ExistingRef -->|no| SubjectCustomer[Find by thread/customer fallback]
  SubjectCustomer --> Create[Create new email Conversation + ticket]
  ExistingConversation --> Store[Store ChatMessage + EmailMessageReference]
  Create --> Store
  Store --> Ack[Queue acknowledgement if inbound customer mail]
  Ack --> Broadcast[Broadcast inbox update]
```

Gmail Pub/Sub notifications are triggers, not message bodies. When a notification arrives, the app decodes the email address/history signal, finds the matching `GmailIntegration`, and runs the same bounded sync/import path used by manual sync and worker polling.

Thread matching priority:

1. Exact inbound `Message-ID` duplicate detection.
2. `In-Reply-To` header match.
3. `References` header match.
4. New conversation creation with a workspace-unique ticket number.

Duplicate protection is database-backed. `EmailMessageReference` has a workspace + `messageId` unique constraint, so Pub/Sub push and polling can safely race without creating duplicate messages or duplicate conversations for the same email.

Watch lifecycle:

1. Gmail OAuth callback stores/updates the integration.
2. The app calls `users.watch` when Pub/Sub settings are present.
3. The queue worker renews watches using `GMAIL_WATCH_RENEW_INTERVAL_MS`.
4. `GMAIL_SYNC_INTERVAL_MS` keeps polling active as a fallback for missed notifications, expired watches, or local testing.

### LLD: AI Decision Contract

AI providers are asked to return JSON:

```json
{
  "reply": "Customer-facing support response",
  "shouldResolve": false,
  "policyIds": ["matched-policy-id"]
}
```

The server validates this shape before using it. Auto-resolve is accepted only if:

1. `shouldResolve` is `true`.
2. At least one returned policy id matches a policy with `autoResolveEnabled=true`.
3. The channel flow supports resolution feedback.

If the provider returns invalid JSON, empty text, a provider error, or times out, the next provider is tried. If every provider fails, the app uses a deterministic fallback response and keeps the conversation open.

### LLD: Realtime Contract

Realtime messages are invalidation events:

```json
{
  "type": "conversation.updated",
  "workspaceId": "workspace-id",
  "conversationId": "conversation-id",
  "version": 1720000000000
}
```

The event does not include customer message bodies. After receiving an event:

1. Dashboard clients call `/api/inbox/conversations` or `/api/inbox/messages`.
2. Widget clients call `/api/chat/messages`.
3. API routes re-authenticate the user/visitor token.
4. Fresh data is returned from PostgreSQL.

### LLD: Status And Ticket Rules

- Email conversations receive a workspace-unique ticket number when imported.
- Chat conversations receive a workspace-unique ticket number after the visitor describes a substantive issue.
- `OPEN` means the team still needs to act or customer said the issue is not resolved.
- `SNOOZED` means temporarily deferred.
- `RESOLVED` means closed after agent action, AI policy auto-resolve, or visitor confirmation.
- In chat, the widget asks `Did this resolve your issue?` only after a substantive support answer, not after greetings or clarification prompts.
- If visitor clicks `No, keep open`, a visitor message is appended and the conversation status is set to `OPEN`.

### API Surface

| Area | Routes |
| --- | --- |
| Auth pages/actions | `/login`, `/signup`, `/forgot-password`, `/reset-password`, server actions in `src/modules/auth/actions.ts` |
| Google OAuth | `/api/auth/google/start`, `/api/auth/google/callback` |
| Widget script | `/api/widget.js` |
| Chat | `/api/chat/bootstrap`, `/api/chat/messages`, `/api/chat/conversations`, `/api/chat/typing`, `/api/chat/stream`, `/api/chat/resolution` |
| Email | `/api/email/inbound`, `/api/email/reply`, `/api/email/messages`, `/api/email/conversations`, `/api/email/status`, `/api/email/draft`, `/api/email/analytics`, `/api/email/contact-timeline`, `/api/email/health` |
| Gmail | `/api/email/gmail/status`, `/api/email/gmail/sync`, `/api/email/gmail/push` |
| Unified inbox | `/api/inbox/conversations`, `/api/inbox/messages`, `/api/inbox/reply`, `/api/inbox/status`, `/api/inbox/assignment`, `/api/inbox/comments`, `/api/inbox/canned-responses`, `/api/inbox/draft`, `/api/inbox/summary`, `/api/inbox/analytics` |
| Knowledge base | `/api/kb/manage`, `/api/kb/search`, `/api/kb/suggest`, `/api/kb/domain`, `/api/kb/from-conversation` |
| Policies | `/api/policies` |

## Main Data Model

```mermaid
erDiagram
  User ||--o{ WorkspaceMember : joins
  User ||--o{ Workspace : owns
  Workspace ||--o{ WorkspaceMember : has
  User ||--o{ PasswordResetToken : requests
  Workspace ||--o{ Conversation : has
  Workspace ||--o{ Invite : sends
  Workspace ||--o{ GmailIntegration : connects
  Conversation ||--o{ ChatMessage : contains
  Conversation ||--o{ EmailMessageReference : threads
  Conversation ||--o{ AssignmentEvent : tracks
  Conversation ||--o{ ConversationComment : notes
  Workspace ||--o{ SupportPolicy : defines
  Workspace ||--o{ KnowledgeBaseArticle : publishes
  KnowledgeBaseCategory ||--o{ KnowledgeBaseArticle : groups
  User ||--o{ Session : has
```

### Important Tables

| Table | Purpose |
| --- | --- |
| `User` | Platform users, agents, admins |
| `Workspace` | Tenant boundary for all support data |
| `WorkspaceMember` | Role and status of each user inside a workspace |
| `Invite` | Team invite tokens, roles, expiry, acceptance state |
| `Session` | Refresh-token-backed login sessions |
| `PasswordResetToken` | Hashed, expiring password reset tokens |
| `Conversation` | One customer issue across chat or email, with nullable ticket number and status |
| `ChatMessage` | Messages from visitor, agent, or system |
| `EmailMessageReference` | Message-ID, In-Reply-To, References tracking for email threading |
| `GmailIntegration` | OAuth tokens, `historyId`, and sync/watch state for connected Gmail inboxes |
| `ChatTypingState` | Short-lived typing state for visitor/agent |
| `AssignmentEvent` | Assignment/reassignment audit trail |
| `ConversationComment` | Internal notes on conversations |
| `CannedResponse` | Saved replies by tag |
| `SupportPolicy` | Editable policy guidance used by AI |
| `KnowledgeBaseCategory` | Help center categories |
| `KnowledgeBaseArticle` | Draft/published articles |
| `KnowledgeBaseDomain` | Custom help-center domain verification state |
| `AuditLog` | Account/workspace/assignment audit events |

### Schema Design Notes

The schema is intentionally centered on a small set of operational primitives:

- `Workspace` is the tenant boundary. Most product tables include `workspaceId`, and route handlers validate that the current user or visitor token belongs to that workspace before reading data.
- `Conversation` is the shared inbox unit. Both `EMAIL` and `CHAT_WIDGET` channels use the same status, assignee, comments, SLA, summary, and ticket-number behavior.
- `ChatMessage` is the shared message ledger. Email messages are stored here too, which keeps the inbox UI channel-agnostic.
- `EmailMessageReference` is the email threading and dedupe table. The unique `(workspaceId, messageId)` constraint prevents duplicate rows when Gmail Pub/Sub push and polling fallback both observe the same email.
- `Conversation.ticketNumber` is nullable because chat conversations can begin with a greeting. The number is created once a real support issue is detected; email conversations receive a ticket during import.
- `GmailIntegration` stores OAuth refresh/access tokens, `historyId`, and sync timestamps for each connected support inbox.
- `SupportPolicy` and `KnowledgeBaseArticle` are separate on purpose: policies guide support decisions, while KB articles are customer-facing content that can be suggested in replies.
- `AssignmentEvent`, `ConversationComment`, and `AuditLog` preserve the operational history needed by admins without overloading the message table.

Important indexes and constraints:

- `Workspace.slug` is unique for stable help-center and widget routing.
- `WorkspaceMember` is unique on `(workspaceId, userId)` so one user has one role per workspace.
- `Invite.token` is unique and expires independently of membership.
- `PasswordResetToken` stores a token hash, expiry, and consumed timestamp so reset links are opaque, expiring, and single-use.
- `Conversation` is unique on `(workspaceId, ticketNumber)` while allowing null ticket numbers during early chat.
- `EmailMessageReference` is unique on `(workspaceId, messageId)` and indexed by `inReplyTo` for thread matching.
- `KnowledgeBaseArticle` is unique on `(workspaceId, slug)` for clean public article URLs.

### Enums

- `WorkspaceRole`: `ADMIN`, `AGENT`
- `MemberStatus`: `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`
- `InviteStatus`: `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`
- `ConversationStatus`: `OPEN`, `SNOOZED`, `RESOLVED`
- `ConversationChannel`: `EMAIL`, `CHAT_WIDGET`
- `ChatSenderType`: `VISITOR`, `AGENT`, `SYSTEM`
- `EmailMessageSource`: `INBOUND`, `OUTBOUND`
- `KnowledgeBaseArticleStatus`: `DRAFT`, `PUBLISHED`
- `CustomDomainStatus`: `PENDING`, `VERIFIED`, `FAILED`

## Key Flows

### Live Chat Flow

```mermaid
sequenceDiagram
  participant V as Visitor widget
  participant API as Next.js chat API
  participant DB as PostgreSQL
  participant AI as AI provider chain
  participant RT as Realtime service
  participant A as Agent inbox

  V->>API: POST /api/chat/bootstrap
  API->>DB: create/reuse visitor conversation without public ticket
  API-->>V: visitor token, conversationId
  V->>API: POST /api/chat/messages
  API->>DB: store visitor message
  API->>DB: generate ticket only when message is a substantive issue
  API->>AI: generate policy-aware reply
  AI-->>API: reply or fallback
  API->>DB: store agent/system reply
  API->>RT: emit conversation.updated
  RT-->>A: invalidate inbox
  RT-->>V: invalidate widget
  A->>API: GET /api/inbox/messages
  V->>API: GET /api/chat/messages
```

The widget persists `conversationId`, `visitorToken`, and `customerKey` in local storage. A ticket number is created and shown only after the visitor describes a real issue, so greetings do not immediately become support tickets. Returning visitors in the same browser see previous chat history.

### Email Inbox Flow

```mermaid
sequenceDiagram
  participant C as Customer
  participant G as Gmail
  participant P as Pub/Sub
  participant API as Next.js API
  participant DB as PostgreSQL
  participant Q as BullMQ
  participant W as Queue worker
  participant SMTP as SMTP provider
  participant A as Agent inbox

  C->>G: email support.cosmofeed@gmail.com
  G->>P: publish inbox update
  P->>API: POST /api/email/gmail/push
  API->>G: fetch changed messages via Gmail OAuth
  API->>DB: normalize sender, subject, Message-ID
  API->>DB: find/create conversation by Message-ID headers
  API->>Q: enqueue auto acknowledgement
  W->>SMTP: send acknowledgement/reply
  W->>DB: append outbound system message and reference
  API->>A: conversation appears in unified inbox
```

Threading uses `Message-ID`, `In-Reply-To`, and `References`. If a reply references an existing message, it is appended to the same conversation. The worker can also poll Gmail on `GMAIL_SYNC_INTERVAL_MS`; both push and polling use the same duplicate-safe import path.

### AI Provider Fallback

```mermaid
flowchart TD
  Start[Need AI reply/draft/summary] --> Primary{OpenAI-compatible key available?}
  Primary -->|yes| OpenAI[Try primary provider]
  Primary -->|no| Gemini
  OpenAI -->|success| Done[Use response]
  OpenAI -->|failure| Gemini[Try Gemini]
  Gemini -->|success| Done
  Gemini -->|failure| Groq[Try Groq keys in order]
  Groq -->|success| Done
  Groq -->|all fail| SafeFallback[Use safe non-AI fallback response]
```

The chat auto-reply remains safe even if every provider fails. It posts a fallback acknowledgement and keeps the ticket open for human review.

## AI And Policy Behavior

The support agent reads:

- Recent conversation transcript.
- Matching `SupportPolicy` records.
- Suggested knowledge base articles.
- Current ticket/conversation context.

For chat:

- The bot always attempts a reply.
- If a visitor only greets the bot, it asks for the issue first.
- The widget shows `Did this resolve your issue?` only after a substantive answer, not after greetings or clarification questions.
- If the user clicks `No, keep open`, the conversation remains `OPEN`.
- If the user clicks `Yes`, the conversation becomes `RESOLVED`.

For email:

- New inbound messages receive an acknowledgement with ticket number.
- AI can include relevant policy guidance and help-center links.
- Duplicate auto-acks are suppressed within a recent window.
- Auto-resolve is allowed only when policy explicitly permits it.

## Embeddable Chat Widget

Install on any website with one script tag:

```html
<script
  src="https://customer-communication-portal.vercel.app/api/widget.js"
  data-workspace="pinelabs"
  defer
></script>
```

Direct demo page:

```text
https://customer-communication-portal.vercel.app/widget/embed?workspace=pinelabs
```

The script injects an iframe that loads the widget page. Widget state is persisted in browser local storage so a returning visitor continues the same conversation unless the conversation was resolved.

## Local Setup

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL database, preferably Neon for parity with deployment
- Redis URL, optional locally but required for scalable realtime/worker behavior
- Gmail OAuth credentials for Gmail sync
- Google Pub/Sub topic and push webhook secret for near-real-time Gmail notifications
- SMTP provider credentials for outbound email
- AI provider credentials for AI replies/drafts/summaries

### Install

```bash
npm install
npm run prisma:generate
npx prisma db push
```

### Environment Variables

Create `.env.local`. Use the following shape, but never commit real values:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
JWT_ACCESS_SECRET="replace-with-strong-random-secret"
JWT_REFRESH_SECRET="replace-with-strong-random-secret"
APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
COOKIE_DOMAIN="localhost"

AI_CHAT_MODE="autoreply"
AI_PROVIDER="openai"
AI_API_KEY="replace-with-openai-or-compatible-key"
AI_MODEL="gpt-4o-mini"
AI_BASE_URL="https://api.openai.com"
GEMINI_API_KEY="replace-with-gemini-key"
GEMINI_MODEL="gemini-1.5-flash"
GROQ_API_KEYS="replace-with-groq-key-1,replace-with-groq-key-2"
GROQ_MODEL="llama-3.1-8b-instant"

SMTP_HOST="smtp-relay.brevo.com"
SMTP_PORT="587"
SMTP_USER="replace-with-smtp-user"
SMTP_PASS="replace-with-smtp-password"
SMTP_SECURE="false"
SMTP_FROM_EMAIL="support@example.com"
SMTP_FROM_NAME="Support"

NEXT_PUBLIC_REALTIME_URL="http://localhost:3001"
REALTIME_SERVER_URL="http://127.0.0.1:3001"
REALTIME_INTERNAL_SECRET="replace-with-shared-secret"
REALTIME_PORT="3001"
REALTIME_ALLOWED_ORIGINS="http://localhost:3000"
REDIS_URL="redis://localhost:6379"

INBOUND_EMAIL_WEBHOOK_SECRET="replace-with-webhook-secret"
INBOUND_EMAIL_DOMAIN="gmail.com"

GOOGLE_CLIENT_ID="replace-with-google-client-id"
GOOGLE_CLIENT_SECRET="replace-with-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
GMAIL_SUPPORT_EMAIL="support@example.com"
GMAIL_SYNC_INTERVAL_MS="30000"
GMAIL_PUBSUB_TOPIC="projects/your-google-project-id/topics/gmail-inbox-updates"
GMAIL_PUSH_WEBHOOK_SECRET="replace-with-random-push-secret"
GMAIL_WATCH_RENEW_INTERVAL_MS="21600000"
```

Secret handling:

- `.env.local` is ignored by git.
- Rotate any key that has been pasted into chat, screenshots, or logs.
- Use separate production secrets in Vercel and Render.
- Do not place real keys in README, commits, issues, or PR descriptions.

### Gmail Push Notifications

Polling works with only Gmail OAuth. For lower latency, configure Gmail push notifications:

1. Enable **Gmail API** and **Pub/Sub API** in Google Cloud.
2. Create a Pub/Sub topic, for example:
   `projects/your-google-project-id/topics/gmail-inbox-updates`
3. Grant `gmail-api-push@system.gserviceaccount.com` the `Pub/Sub Publisher` role on that topic.
4. Create a Pub/Sub push subscription targeting:
   `https://customer-communication-portal.vercel.app/api/email/gmail/push?secret=<GMAIL_PUSH_WEBHOOK_SECRET>`
5. Set `GMAIL_PUBSUB_TOPIC` and `GMAIL_PUSH_WEBHOOK_SECRET` in Vercel and the worker environment.
6. Reconnect Gmail from the inbox page, or wait for the worker watch renewal. The app calls Gmail `users.watch` and then uses existing sync/import logic when Pub/Sub notifications arrive.

Polling remains enabled through `GMAIL_SYNC_INTERVAL_MS` as a fallback.

### Run Locally

Terminal 1:

```bash
npm run dev -- -H 0.0.0.0 -p 3000
```

Terminal 2:

```bash
npm run realtime
```

Terminal 3, optional for queue jobs:

```bash
npm run worker
```

Open:

```text
http://localhost:3000
http://localhost:3000/inbox
http://localhost:3000/widget/embed?workspace=pinelabs
http://localhost:3000/help/pinelabs
```

## Deployment Setup

### Vercel App

Deploy the Next.js app to Vercel.

Set environment variables:

- Database/JWT/app URL/cookie variables.
- AI variables.
- SMTP variables.
- Gmail OAuth variables.
- Gmail Pub/Sub variables:
  - `GMAIL_PUBSUB_TOPIC`
  - `GMAIL_PUSH_WEBHOOK_SECRET`
  - `GMAIL_SYNC_INTERVAL_MS`
- Realtime client/server URLs.
- Inbound email webhook secret.

Build command:

```bash
npm run build
```

### Render Realtime Service

Deploy the same repo as a Render Web Service.

Start command:

```bash
npm run realtime
```

Important env:

- `REALTIME_INTERNAL_SECRET`
- `REALTIME_ALLOWED_ORIGINS`
- `REDIS_URL`
- `PORT` is supplied by Render.

### Render Queue Worker

Deploy the same repo as a Render worker/web service.

Start command:

```bash
npm run worker
```

Important env:

- `DATABASE_URL`
- `REDIS_URL`
- SMTP variables
- AI variables
- `APP_URL`
- Gmail OAuth variables
- `GMAIL_PUBSUB_TOPIC`
- `GMAIL_PUSH_WEBHOOK_SECRET`
- `GMAIL_SYNC_INTERVAL_MS`
- `GMAIL_WATCH_RENEW_INTERVAL_MS`

### Render Free-Tier Keep-Alive

The realtime service and queue worker are hosted on Render. Render free-tier services can sleep after inactivity, which can slow down first websocket connections, background jobs, and email processing during evaluation.

To keep the demo responsive without adding paid infrastructure, I configured cron-job.org to ping the lightweight health endpoints on a fixed schedule:

```text
https://customercommunicationportal.onrender.com/health
https://cosmofeed-help-ccp-worker.onrender.com/health
```

These cronjobs do not mutate data. They only call health endpoints so the Render services stay warm for the submission review. In a production deployment, this would be replaced with always-on Render instances or a managed worker/runtime with no free-tier sleep behavior.

## Testing Guide

### 1. Signup And Workspace

1. Open `https://customer-communication-portal.vercel.app`.
2. Sign up with a new user.
3. Create or enter a workspace.
4. Confirm workspace navigation appears.

### 2. Live Chat Bubble

1. Open dashboard in one tab:

```text
https://customer-communication-portal.vercel.app/inbox
```

2. Open widget in incognito/another browser:

```text
https://customer-communication-portal.vercel.app/widget/embed?workspace=pinelabs
```

3. Send a visitor message.
4. Confirm a chat conversation appears in the unified inbox.
5. Reply from the inbox.
6. Confirm the visitor receives the reply without refresh.
7. Type on either side and confirm typing indicators.
8. Refresh visitor page and confirm chat history persists.
9. Confirm read receipts update from sent/read states.

### 3. AI Chat Agent

1. Send a greeting such as `hi`.
2. Bot should ask for the issue and should not show the resolution prompt.
3. Send an actual issue such as:

```text
I cancelled my order yesterday. When will I get my refund?
```

4. Bot should answer using support policies if matching policies exist.
5. Only after a real answer, the widget should show:

```text
Did this resolve your issue?
Yes
No, keep open
```

6. Click `No, keep open` and confirm inbox status remains `OPEN`.
7. Click `Yes` in another test and confirm status becomes `RESOLVED`.

### 4. Email Inbox Test

Test address:

```text
support.cosmofeed@gmail.com
```

Steps:

1. Send an email to `support.cosmofeed@gmail.com`.
2. Wait for Pub/Sub push to trigger sync, click **Sync**, or wait for polling fallback.
3. Open `/inbox`.
4. Confirm the email appears as an `EMAIL` conversation.
5. Reply to the thread from the unified inbox.
6. Send a customer reply to the same email thread.
7. Confirm the reply stays inside the same conversation via Message-ID threading.
8. Confirm duplicate push/poll imports do not create duplicate conversations for the same email.

Manual local verification:

```bash
npm run email:verify
```

### 5. Knowledge Base

1. Open `/knowledge-base`.
2. Create a category and article.
3. Publish it.
4. Open `/help/pinelabs`.
5. Search for article text.
6. Type a similar question in the widget and confirm suggestions appear.

### 6. Policies

1. Open `/policies`.
2. Add a policy such as refund timeline.
3. Enable auto-resolve only for safe, deterministic cases.
4. Send a matching chat/email message.
5. Confirm AI uses the policy wording.

### 7. Team Invites

1. Open `/team`.
2. Invite a teammate by email.
3. Open the invite link.
4. Sign up or log in.
5. Confirm membership is activated in the workspace.

## Review Submission Checklist

- Live product URL: `https://customer-communication-portal.vercel.app`
- Live chat bubble demo: `https://customer-communication-portal.vercel.app/widget/embed?workspace=pinelabs`
- Email inbox test address: `support.cosmofeed@gmail.com`
- GitHub repository: include clean commit history, not one giant commit.
- README: architecture overview, tech choices, setup instructions, known limitations.
- Message Aditya at `+91 9717115749` with the relevant links.
- Email submission to `aditya@superprofile.bio`, keeping `vp@superprofile.bio` in CC.

Suggested submission email:

```text
Subject: Customer Communication Portal Assignment Submission

Hi Aditya,

I have completed the customer communication portal assignment.

Live product:
https://customer-communication-portal.vercel.app

Live chat widget demo:
https://customer-communication-portal.vercel.app/widget/embed?workspace=pinelabs

Email inbox test:
support.cosmofeed@gmail.com

Realtime health:
https://customercommunicationportal.onrender.com/health

Queue worker health:
https://cosmofeed-help-ccp-worker.onrender.com/health

GitHub repository:
https://github.com/swaritpatel/CustomerCommunicationPortal

Thanks,
Swarit
```

## Known Limitations And Future Work

- Gmail Pub/Sub push notifications are implemented, but the push endpoint currently uses a shared secret query parameter instead of Pub/Sub authenticated push JWT verification.
- Gmail push notifications trigger a bounded Gmail API sync path; a future version can use Gmail history delta replay more deeply for very large inboxes.
- Add richer RBAC beyond admin/agent.
- Add audit log UI for all sensitive actions.
- Add production DNS verification for custom help center domains.
- Add attachment support for chat/email.
- Add per-conversation sequence IDs for stricter realtime replay.
- Add OpenTelemetry tracing for cross-service request flow.
- Add more robust duplicate detection for email provider retries.
- Add rate limiting for public widget and inbound email endpoints.
- Add AI evaluation tests for policies and auto-resolve behavior.

## Useful Commands

```bash
npm run dev
npm run realtime
npm run worker
npm run lint
npx tsc --noEmit --incremental false
npm run prisma:validate
npm run prisma:generate
npx prisma db push
npm run email:verify
```

## Repository Hygiene

- Keep `.env.local` untracked.
- Do not commit `.next`, logs, screenshots with secrets, or generated temp files.
- Commit feature work incrementally.
- Prefer commit messages like:
  - `Add Gmail OAuth inbox sync`
  - `Implement unified inbox assignment controls`
  - `Add policy-aware AI chat replies`
  - `Add ticket numbers and resolution feedback`
  - `Document architecture and setup`
