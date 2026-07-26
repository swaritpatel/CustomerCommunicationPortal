# Deployment: Vercel + Render + Hosted Redis

This project uses Vercel for the Next.js app, Render for the long-lived Socket.IO realtime gateway, and a Render worker for Redis-backed background jobs.

## 1. Create Hosted Redis

Use Upstash Redis or Redis Cloud.

Copy the Redis TCP URL, not the REST URL. It should look like:

```text
rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
```

Use `rediss://` for hosted TLS Redis.

## 2. Deploy Realtime Gateway On Render

Create a Render Web Service from this repo.

```text
Build Command: npm install
Start Command: npm run realtime
Health Check Path: /health
```

Render environment variables:

```env
NODE_ENV=production
REALTIME_INTERNAL_SECRET=replace-with-one-long-random-secret
REALTIME_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
APP_URL=https://your-vercel-app.vercel.app
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
```

Do not set `PORT` manually. Render injects it automatically. The realtime server binds to `0.0.0.0` and reads `REALTIME_PORT`, then `PORT`, then `3001`.

After deployment, open:

```text
https://your-render-realtime.onrender.com/health
```

Expected:

```json
{"ok":true,"service":"ccp-realtime","adapter":"redis"}
```

If `adapter` is `memory`, the Redis URL is missing, wrong, or unreachable.

## 3. Deploy Queue Worker On Render

Create a second Render service from the same repo.

Use a Background Worker if your Render plan supports it. If not, a Web Service can also run the worker command, but it does not need a public URL.

```text
Build Command: npm install
Start Command: npm run worker
```

Worker environment variables:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
APP_URL=https://your-vercel-app.vercel.app
COOKIE_DOMAIN=your-vercel-app.vercel.app
JWT_ACCESS_SECRET=replace-with-at-least-32-characters
JWT_REFRESH_SECRET=replace-with-at-least-32-characters
REALTIME_SERVER_URL=https://your-render-realtime.onrender.com
REALTIME_INTERNAL_SECRET=same-value-as-realtime-and-vercel
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
QUEUE_CONCURRENCY=4
```

Add SMTP and AI variables to the worker too, because it processes outbound email and AI auto-replies:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
SMTP_SECURE=false
SMTP_FROM_EMAIL=support@yourdomain.com
SMTP_FROM_NAME=Cosmofeed Support
AI_CHAT_MODE=autoreply
AI_PROVIDER=openai
AI_API_KEY=your-openai-key
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com
```

The queue worker handles:

- outbound SMTP email delivery
- webhook dispatch with retries
- AI chat auto-replies

Realtime socket broadcasts stay direct so chat remains fast.

## 4. Deploy Next.js App On Vercel

Deploy the same repo to Vercel.

Vercel environment variables:

```env
DATABASE_URL=postgresql://...
JWT_ACCESS_SECRET=replace-with-at-least-32-characters
JWT_REFRESH_SECRET=replace-with-at-least-32-characters
APP_URL=https://your-vercel-app.vercel.app
COOKIE_DOMAIN=your-vercel-app.vercel.app
NEXT_PUBLIC_APP_URL=https://your-vercel-app.vercel.app

NEXT_PUBLIC_REALTIME_URL=https://your-render-realtime.onrender.com
REALTIME_SERVER_URL=https://your-render-realtime.onrender.com
REALTIME_INTERNAL_SECRET=same-value-as-render
REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
QUEUE_CONCURRENCY=4
```

Email values, if using Brevo:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
SMTP_SECURE=false
SMTP_FROM_EMAIL=support@yourdomain.com
SMTP_FROM_NAME=Cosmofeed Support
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-random-shared-secret
INBOUND_EMAIL_DOMAIN=yourdomain.com
```

Redeploy after changing Vercel environment variables.

## 5. Sync Database

Before testing production flows, run Prisma schema sync against the production database:

```bash
npx prisma db push
```

Use the same `DATABASE_URL` as Vercel.

## 6. Verify Production

Realtime:

```bash
curl https://your-render-realtime.onrender.com/health
```

Expected `adapter` is `redis`.

Widget:

```text
https://your-vercel-app.vercel.app/widget/embed?workspace=your-workspace-slug
```

Send a chat message and confirm it appears in:

```text
https://your-vercel-app.vercel.app/inbox
```

## Common Mistakes

- Using Upstash REST URL instead of Redis URL.
- Using `https://` instead of `rediss://` for Redis.
- Setting different `REALTIME_INTERNAL_SECRET` values on Vercel and Render.
- Forgetting to redeploy Vercel after env changes.
- Setting `COOKIE_DOMAIN` with `https://`; use only the hostname.
- Render health shows `memory`; Redis did not connect.
- Queue worker is not deployed; SMTP replies and AI auto-replies will stay queued until it starts.
