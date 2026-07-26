import Link from "next/link";

import { PublicNavbar } from "@/modules/navigation/public-navbar";

const capabilities = [
  ["Unified inbox", "Email and live chat conversations appear in one operator queue with assignment, status, and threading."],
  ["AI policy replies", "Support policies guide draft replies, auto-acknowledgements, and safe auto-resolve decisions."],
  ["Knowledge base", "Publish help articles and reuse them inside email and chat responses."],
  ["Live chat widget", "Install the customer chat bubble on any website with one script tag."],
  ["Team operations", "Invite teammates, assign owners, and manage admin/agent roles."],
  ["Analytics", "Track first response, resolution health, channel mix, and agent workload."],
];

const flow = [
  ["1", "Customer contacts you", "A visitor sends a website chat or emails the support address."],
  ["2", "CCP creates a ticket", "The conversation gets a ticket number, status, assignee, SLA state, and full message history."],
  ["3", "AI helps the team", "Policies and knowledge articles are used to suggest or send the right response."],
  ["4", "Team resolves faster", "Agents can reply, assign, comment, resolve, and publish learnings back to the knowledge base."],
];

export default function OverviewPage() {
  return (
    <>
      <PublicNavbar />
      <main className="px-6 py-8 sm:px-8 lg:px-10">
        <section className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
          <article className="card fade-up rounded-[2rem] p-6 sm:p-8 lg:p-10">
            <p className="eyebrow">Product overview</p>
            <h1 className="mt-3 text-5xl font-extrabold leading-tight tracking-[-0.055em]">
              Cosmofeed Customer Communication Platform
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--color-muted)]">
              A support command center for inbound email, live chat, policies, knowledge base, SLA tracking, and AI-assisted replies.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link className="btn-primary text-center" href="/signup">
                Create workspace
              </Link>
              <Link className="btn-secondary text-center" href="/login">
                Login
              </Link>
              <Link className="btn-secondary text-center" href="/dashboard">
                Dashboard
              </Link>
            </div>
          </article>

          <article className="card fade-up rounded-[2rem] p-6 sm:p-8" style={{ animationDelay: "80ms" }}>
            <p className="eyebrow">How it works</p>
            <div className="mt-5 grid gap-4">
              {flow.map(([step, title, description]) => (
                <div
                  key={step}
                  className="grid gap-4 rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.55)] p-5 sm:grid-cols-[auto_1fr]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-sm font-black text-white">
                    {step}
                  </span>
                  <span>
                    <strong className="block text-lg font-extrabold tracking-[-0.03em]">{title}</strong>
                    <span className="mt-2 block text-sm leading-7 text-[var(--color-muted)]">{description}</span>
                  </span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mx-auto mt-6 grid w-full max-w-7xl gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {capabilities.map(([title, description], index) => (
            <article
              key={title}
              className="card fade-up rounded-[1.5rem] p-5"
              style={{ animationDelay: `${120 + index * 35}ms` }}
            >
              <p className="eyebrow">0{index + 1}</p>
              <h2 className="mt-3 text-xl font-extrabold tracking-[-0.035em]">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{description}</p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
