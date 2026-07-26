import Link from "next/link";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { logoutAction } from "@/modules/auth/actions";
import { getSessionClaims } from "@/modules/auth/session";
import { HelpCenterClient } from "@/modules/kb/components/help-center-client";

function normalizeHost(host: string | null) {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

const featureTiles = [
  ["Unified Inbox", "Chat and email in one operator queue with assignment, status, and SLA context."],
  ["AI Summaries", "Long threads collapse into user intent, tried fixes, status, and key details."],
  ["Knowledge Base", "Publish help articles, add custom domains, and suggest answers inside chat."],
  ["Live Widget", "A polished visitor chat bubble with typing, read states, and article suggestions."],
];

const workflow = [
  ["Capture", "Bring website chat and inbound email into one customer thread."],
  ["Understand", "Use AI summaries, contact history, and SLA signals before replying."],
  ["Resolve", "Reply, assign, snooze, publish help content, and close the loop faster."],
];

export default async function Home() {
  const host = normalizeHost((await headers()).get("host"));
  const customDomain =
    host && !host.includes("localhost") && !host.startsWith("127.0.0.1")
      ? await db.knowledgeBaseDomain.findFirst({
          where: {
            hostname: host,
            status: "VERIFIED",
            sslStatus: "ACTIVE",
          },
          select: {
            workspace: {
              select: { slug: true },
            },
          },
        })
      : null;

  if (customDomain) {
    return <HelpCenterClient workspaceSlug={customDomain.workspace.slug} />;
  }

  const previewWorkspace = await db.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  const claims = await getSessionClaims();
  const previewWidgetHref = previewWorkspace ? `/widget/chat?workspace=${previewWorkspace.slug}` : "/signup";

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5f7fb] text-[var(--color-ink)]">
      <section
        className="relative mx-auto mt-3 flex min-h-[84vh] w-[calc(100%-1.5rem)] max-w-[1500px] overflow-hidden rounded-[2rem] bg-black px-5 py-5 text-white sm:mt-5 sm:w-[calc(100%-2.5rem)] sm:rounded-[2.4rem] sm:px-8 lg:px-10"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(0,0,0,0.93) 0%, rgba(0,0,0,0.82) 34%, rgba(0,0,0,0.32) 68%, rgba(0,0,0,0.08) 100%), url('/brand/ccp-cosmic-dashboard-hero.png')",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="relative z-10 flex w-full flex-col">
          <header className="flex items-center justify-between gap-4 rounded-full border border-white/12 bg-white/8 px-4 py-3 backdrop-blur-md">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-black text-black">
                C
              </span>
              <span>
                <strong className="block text-sm tracking-[0.02em]">Cosmofeed CCP</strong>
                <span className="hidden text-xs text-white/58 sm:block">Built for modern support teams</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-bold text-white/72 lg:flex">
              <Link href="/overview">Overview</Link>
              <a href="#platform">Platform</a>
              <a href="#workflow">Workflow</a>
              <a href="#features">Features</a>
            </nav>
            {claims ? (
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10">
                  Dashboard
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="min-w-[104px] rounded-full bg-white px-5 py-2.5 text-center text-sm font-black text-black transition hover:scale-[1.02]"
                  >
                    Logout
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login" className="rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10">
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="min-w-[104px] rounded-full bg-gradient-to-r from-[#b943ff] via-[#ec3d99] to-[#37c8f3] px-5 py-2.5 text-center text-sm font-black text-white shadow-[0_12px_34px_rgba(236,61,153,0.36)] transition hover:scale-[1.02]"
                >
                  Sign up
                </Link>
              </div>
            )}
          </header>

          <div className="grid flex-1 items-center py-12 sm:py-16 lg:grid-cols-[0.78fr_1fr]">
            <div className="max-w-3xl">
              <p className="inline-flex rounded-full border border-white/14 bg-white/8 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/72">
                Built in India for customer conversations
              </p>
              <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
                Cosmofeed Customer Communication Platform
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-white/72 sm:text-lg">
                A cleaner Intercom-style command center for chat, email, help articles, AI summaries, custom domains, and support operations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className="btn-primary px-6 py-4">
                  Create workspace
                </Link>
                <Link href={previewWidgetHref} className="rounded-full border border-white/18 bg-white/10 px-6 py-4 text-center font-black text-white backdrop-blur transition hover:bg-white/15">
                  Preview chat widget
                </Link>
              </div>
            </div>
          </div>

        </div>
      </section>

      <section id="platform" className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="eyebrow">Product surface</p>
          <h2 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-[-0.045em] sm:text-5xl">
            More focused than a CRM, more complete than a chat widget.
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {featureTiles.map(([title, description]) => (
            <article key={title} className="card rounded-[1.25rem] p-5">
              <div className="mb-5 h-2 w-16 rounded-full bg-gradient-to-r from-[#ec3d99] via-[#7b4dff] to-[#37c8f3]" />
              <h3 className="text-xl font-black tracking-[-0.03em]">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="bg-white px-5 py-14 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="rounded-[2rem] bg-[#0d0f18] p-5 text-white shadow-[0_24px_70px_rgba(13,15,24,0.22)]">
            <div className="rounded-[1.5rem] border border-white/10 bg-white p-4 text-[#11121a]">
              <div className="flex items-center justify-between border-b border-black/8 pb-3">
                <strong>Unified Inbox</strong>
                <span className="rounded-full bg-[#ec3d99]/10 px-3 py-1 text-xs font-black text-[#ec3d99]">Live</span>
              </div>
              <div className="mt-4 grid gap-3">
                {["Email customer needs billing help", "Website visitor is comparing plans", "AI summary ready for long thread"].map((item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-black/8 bg-[#f8fafc] p-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#ec3d99] to-[#37c8f3] text-sm font-black text-white">
                      {index + 1}
                    </span>
                    <span className="text-sm font-bold text-[#343846]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <p className="eyebrow">How it works</p>
            <h2 className="mt-3 text-4xl font-black leading-tight tracking-[-0.045em] sm:text-5xl">
              Designed for operators who need context before speed.
            </h2>
            <div className="mt-8 grid gap-4">
              {workflow.map(([title, description], index) => (
                <div key={title} className="flex gap-4 rounded-[1.25rem] border border-[var(--color-line)] bg-[#f8fafc] p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-sm font-black text-white">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="font-black">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-7xl gap-6 px-5 py-14 sm:px-8 lg:grid-cols-[1fr_0.7fr]">
        <div className="rounded-[2rem] bg-gradient-to-br from-[#11121a] via-[#1e1533] to-[#071d2a] p-8 text-white">
          <p className="eyebrow text-white/54">Submission edge</p>
          <h2 className="mt-3 max-w-2xl text-4xl font-black leading-tight tracking-[-0.045em]">
            AI, knowledge base, custom domains, and email engineering in one cohesive product.
          </h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {["SMTP replies", "Threading", "SLA tracking", "Canned responses", "Article suggestions", "Domain verification"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm font-bold text-white/78">
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="card rounded-[2rem] p-8">
          <p className="eyebrow">Ready to test</p>
          <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">Open the app and run the actual flows.</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--color-muted)]">
            Create a workspace, send chat messages, ingest email, publish help articles, and connect a custom help domain.
          </p>
          <div className="mt-6 grid gap-3">
            <Link href="/signup" className="btn-primary">
              Create workspace
            </Link>
            <Link href="/login" className="btn-secondary">
              Log in
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
