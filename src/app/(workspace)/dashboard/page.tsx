const milestones = [
  {
    title: "Authentication lifecycle",
    detail: "Signup, login, verification, and reset flows are the next backend integration target.",
  },
  {
    title: "Team provisioning",
    detail: "Invites, role changes, and last-admin protection sit behind one policy layer.",
  },
  {
    title: "Assignment integrity",
    detail: "Manual conversation ownership will use optimistic concurrency via ownership versioning.",
  },
];

export default function WorkspaceDashboardPage() {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="card rounded-[2rem] p-6 sm:p-8">
        <p className="eyebrow">Workspace status</p>
        <h2 className="mt-3 text-4xl font-extrabold tracking-[-0.05em]">Feature 01 foundation is now structured for live wiring.</h2>
        <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--color-muted)]">
          The UI shell is in place, the data model is defined, and the app is ready for authenticated actions and database-backed member flows.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {milestones.map((milestone, index) => (
            <div key={milestone.title} className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5">
              <div className="eyebrow">0{index + 1}</div>
              <h3 className="mt-3 text-lg font-bold tracking-[-0.03em]">{milestone.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{milestone.detail}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="card rounded-[2rem] p-6">
        <p className="eyebrow">Implementation next</p>
        <div className="mt-4 space-y-4">
          {[
            "Generate Prisma client and connect to Postgres.",
            "Implement server-safe env loading for runtime entry points.",
            "Wire signup and login actions against validated schemas.",
            "Replace static team data with workspace-scoped queries.",
          ].map((item) => (
            <div key={item} className="rounded-[1.25rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] px-4 py-3 text-sm leading-7 text-[var(--color-muted)]">
              {item}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}