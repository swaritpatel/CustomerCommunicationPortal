import Link from "next/link";

export default function Home() {
  const pillars = [
    {
      title: "Auth that respects operations",
      description:
        "Verified email flows, session rotation, and clear recovery paths instead of brittle demo auth.",
    },
    {
      title: "Teams with actual guardrails",
      description:
        "Admin and Agent roles, invite lifecycle, and last-admin protections built into the interaction model.",
    },
    {
      title: "Assignment-ready from the start",
      description:
        "Conversation ownership is treated as a first-class system boundary so inbox and chat can plug in later.",
    },
    {
      title: "Live chat widget channel",
      description:
        "Drop one script tag into any website to open real-time visitor chat with history and read receipts.",
    },
  ];

  return (
    <main className="grain min-h-screen overflow-hidden px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="fade-up flex flex-col gap-4 rounded-[2rem] border border-[var(--color-line)] bg-[rgba(255,253,248,0.72)] px-6 py-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow">Feature 01 / Authentication & Team Management</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-lg font-bold text-white">
                <span className="text-[10px] tracking-[0.08em]">CCP</span>
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-[-0.03em]">CCP</h1>
                <p className="text-sm text-[var(--color-muted)]">
                  Customer communication infrastructure with operator-grade workflow design.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="btn-secondary">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary">
              Create workspace
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="card fade-up rounded-[2rem] px-6 py-8 sm:px-8 lg:px-10">
            <div className="max-w-3xl">
              <p className="eyebrow">Ship the trust layer first</p>
              <h2 className="mt-4 max-w-4xl text-4xl font-extrabold tracking-[-0.05em] text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
                Build the part of Intercom most teams underestimate: identity, roles, and ownership.
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--color-muted)] sm:text-lg">
                This first implementation pass establishes the visual system and the core surfaces for
                secure signup, teammate invites, role management, and conversation assignment.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {pillars.map((pillar, index) => (
                <article
                  key={pillar.title}
                  className="rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-panel-strong)] p-5"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="eyebrow">0{index + 1}</div>
                  <h3 className="mt-3 text-lg font-bold tracking-[-0.03em]">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{pillar.description}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.62)] p-5">
              <p className="eyebrow">Widget install</p>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Add this script tag to any website and replace <strong>YOUR_WORKSPACE_SLUG</strong>.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-[rgba(32,29,25,0.95)] p-4 text-xs text-[#f4efe7]">
                {`<script src="${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/widget.js" data-workspace="YOUR_WORKSPACE_SLUG" defer></script>`}
              </pre>
            </div>
          </div>

          <aside className="card fade-up rounded-[2rem] px-6 py-7" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Launch checklist</p>
                <h3 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Feature 01 live build</h3>
              </div>
              <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--color-accent-strong)]">
                In progress
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {[
                "Email-password authentication flows",
                "Admin and Agent member management",
                "Invite acceptance for new and existing users",
                "Conversation assignment foundation",
                "Embeddable live chat widget channel",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-[1.25rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.45)] px-4 py-3"
                >
                  <span className="status-dot mt-1 bg-[var(--color-accent)]" />
                  <p className="text-sm leading-7 text-[var(--color-muted)]">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Link href="/chat" className="btn-primary">
                Open live chat inbox
              </Link>
              <Link href="/signup" className="btn-secondary">
                Preview signup
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
