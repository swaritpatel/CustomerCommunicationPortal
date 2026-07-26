import {
  assignConversationAction,
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "@/modules/team/actions";
import { requireActiveMembership } from "@/modules/auth/guards";
import { db } from "@/lib/db";
import { buildInviteUrl } from "@/modules/team/invites";

type TeamMemberItem = {
  id: string;
  userId: string;
  role: string;
  lastSeenAt: Date | null;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
};

type PendingInviteItem = {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
};

type TeamConversationItem = {
  id: string;
  subject: string;
  channel: string;
  status: string;
  currentAssigneeId: string | null;
  currentAssignee: {
    id: string;
    fullName: string;
  } | null;
};

type AssignmentLoadItem = {
  currentAssigneeId: string | null;
  _count: {
    _all: number;
  };
};

function toPresenceLabel(lastSeenAt: Date | null) {
  if (!lastSeenAt) {
    return "Away";
  }

  return Date.now() - lastSeenAt.getTime() <= 45_000 ? "Online" : "Away";
}

export default async function TeamPage() {
  const { claims } = await requireActiveMembership();

  const [members, pendingInvites, openConversations, assignmentLoad, dbNowRows]: [
    TeamMemberItem[],
    PendingInviteItem[],
    TeamConversationItem[],
    AssignmentLoadItem[],
    { now: Date }[],
  ] = await Promise.all([
    db.workspaceMember.findMany({
      where: {
        workspaceId: claims.workspaceId,
        status: "ACTIVE",
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [
        {
          role: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    }),
    db.invite.findMany({
      where: {
        workspaceId: claims.workspaceId,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    }),
    db.conversation.findMany({
      where: {
        workspaceId: claims.workspaceId,
        messages: { some: {} },
        status: {
          in: ["OPEN", "SNOOZED"],
        },
      },
      select: {
        id: true,
        subject: true,
        channel: true,
        status: true,
        currentAssigneeId: true,
        currentAssignee: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 40,
    }),
    db.conversation.groupBy({
      by: ["currentAssigneeId"],
      where: {
        workspaceId: claims.workspaceId,
        messages: { some: {} },
        status: {
          in: ["OPEN", "SNOOZED"],
        },
      },
      _count: {
        _all: true,
      },
    }),
    db.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`,
  ]);

  const nowMs = dbNowRows[0]?.now?.getTime() ?? 0;

  const loadByUserId = new Map<string, number>();
  for (const bucket of assignmentLoad) {
    if (bucket.currentAssigneeId) {
      loadByUserId.set(bucket.currentAssigneeId, bucket._count._all);
    }
  }

  const unassignedCount = openConversations.filter(
    (conversation: TeamConversationItem) => !conversation.currentAssigneeId,
  ).length;

  return (
    <main className="min-h-screen px-6 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="card fade-up rounded-[2rem] px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow">Team operations</p>
              <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em]">Authentication and team operations</h1>
              <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--color-muted)]">
                This is the first operational surface for feature 01: member controls, pending invites, and manual ownership management.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Members", String(members.length)],
                ["Pending invites", String(pendingInvites.length)],
                ["Unassigned", String(unassignedCount)],
              ].map(([label, value]: string[]) => (
                <div key={label} className="rounded-[1.4rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] px-4 py-3">
                  <div className="eyebrow">{label}</div>
                  <div className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <article id="members" className="card fade-up rounded-[2rem] p-6" style={{ animationDelay: "80ms" }}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="eyebrow">Members</p>
                  <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Workspace access</h2>
                </div>

                {claims.role === "ADMIN" ? (
                  <form action={inviteMemberAction} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      name="email"
                      type="email"
                      required
                      className="input min-w-[220px]"
                      placeholder="teammate@company.com"
                    />
                    <select name="role" className="input" defaultValue="AGENT">
                      <option value="AGENT">Agent</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <button className="btn-primary" type="submit">Invite teammate</button>
                  </form>
                ) : (
                  <span className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-muted)]">
                    Admin controls only
                  </span>
                )}
              </div>

              <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)]">
                <div className="hidden grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_1.2fr] gap-4 border-b border-[var(--color-line)] px-5 py-4 text-sm font-semibold text-[var(--color-soft)] md:grid">
                  <span>Member</span>
                  <span>Role</span>
                  <span>Status</span>
                  <span>Assigned load</span>
                  <span>Action</span>
                </div>

                <div className="divide-y divide-[var(--color-line)]">
                  {members.map((member: TeamMemberItem) => {
                    const presence = toPresenceLabel(member.lastSeenAt);
                    const load = loadByUserId.get(member.userId) ?? 0;

                    return (
                      <div key={member.id} className="grid gap-4 px-5 py-5 md:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_1.2fr] md:items-center">
                        <div>
                          <p className="font-bold tracking-[-0.02em]">{member.user.fullName}</p>
                          <p className="mt-1 text-sm text-[var(--color-muted)]">{member.user.email}</p>
                        </div>
                        <div>
                          <span className="inline-flex rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm font-semibold text-[var(--color-accent-strong)]">
                            {member.role}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                          <span className={`status-dot ${presence === "Online" ? "bg-[var(--color-success)]" : "bg-[var(--color-warning)]"}`} />
                          {presence}
                        </div>
                        <div className="text-sm text-[var(--color-muted)]">{load} open</div>
                        {claims.role === "ADMIN" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <form action={updateMemberRoleAction} className="flex items-center gap-2">
                              <input type="hidden" name="memberId" value={member.id} />
                              <select name="role" defaultValue={member.role} className="input py-2">
                                <option value="ADMIN">Admin</option>
                                <option value="AGENT">Agent</option>
                              </select>
                              <button className="btn-secondary" type="submit">Update</button>
                            </form>
                            <form action={removeMemberAction}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <button className="btn-secondary" type="submit">Remove</button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--color-muted)]">View only</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>

            <article id="assignment" className="card fade-up rounded-[2rem] p-6" style={{ animationDelay: "140ms" }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="eyebrow">Assignment</p>
                  <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Conversation ownership</h2>
                </div>
                <span className="rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-sm font-semibold text-[var(--color-muted)]">
                  Manual routing in v1
                </span>
              </div>

              <div className="mt-6 grid gap-4">
                {openConversations.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5 text-sm text-[var(--color-muted)]">
                    No open conversations yet. Install the website widget and start chatting to populate this queue.
                  </div>
                ) : (
                  openConversations.map((conversation: TeamConversationItem) => (
                    <div key={conversation.id} className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="font-bold tracking-[-0.03em]">{conversation.subject}</p>
                          <p className="mt-2 text-sm text-[var(--color-muted)]">
                            {conversation.channel === "CHAT_WIDGET" ? "Chat" : "Email"} · {conversation.status}
                          </p>
                        </div>
                        <div className="rounded-full bg-[rgba(255,255,255,0.72)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)]">
                          {conversation.currentAssignee?.fullName ?? "Unassigned"}
                        </div>
                      </div>

                      {claims.role === "ADMIN" ? (
                        <form action={assignConversationAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <input type="hidden" name="conversationId" value={conversation.id} />
                          <select name="assigneeId" defaultValue={conversation.currentAssigneeId ?? ""} className="input">
                            <option value="">Unassigned</option>
                            {members.map((member: TeamMemberItem) => (
                              <option key={member.id} value={member.id}>
                                {member.user.fullName} ({member.role})
                              </option>
                            ))}
                          </select>
                          <input
                            name="reason"
                            className="input"
                            placeholder="Reason (optional)"
                            maxLength={240}
                          />
                          <button className="btn-secondary" type="submit">Apply</button>
                        </form>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>

          <aside className="space-y-6">
            <article id="invites" className="card fade-up rounded-[2rem] p-6" style={{ animationDelay: "120ms" }}>
              <p className="eyebrow">Pending invites</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Seats waiting to activate</h2>
              <div className="mt-6 space-y-4">
                {pendingInvites.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5 text-sm text-[var(--color-muted)]">
                    No pending invites.
                  </div>
                ) : (
                  pendingInvites.map((invite: PendingInviteItem) => {
                    const daysLeft = Math.max(
                      0,
                      Math.ceil((invite.expiresAt.getTime() - nowMs) / (24 * 60 * 60 * 1000)),
                    );

                    return (
                      <div key={invite.id} className="rounded-[1.5rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold tracking-[-0.03em]">{invite.email}</p>
                            <p className="mt-2 text-sm text-[var(--color-muted)]">
                              {invite.role} · Expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}
                            </p>
                            <p className="mt-3 break-all text-xs leading-6 text-[var(--color-muted)]">
                              {buildInviteUrl(invite.token)}
                            </p>
                          </div>
                          <span className="rounded-full bg-[rgba(230,47,137,0.09)] px-3 py-1 text-sm font-semibold text-[var(--color-accent-strong)]">
                            Pending
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>

            <article className="card fade-up rounded-[2rem] p-6" style={{ animationDelay: "180ms" }}>
              <p className="eyebrow">Guardrails</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Server-enforced protections</h2>
              <div className="mt-6 space-y-3">
                {[
                  "Only Admins can invite, revoke, remove, or change roles.",
                  "The final Admin cannot be removed or demoted.",
                  "Assignments can only target active members in the same workspace.",
                  "Auth actions, membership changes, and assignment updates are audited.",
                ].map((item: string) => (
                  <div key={item} className="rounded-[1.25rem] border border-[var(--color-line)] bg-[rgba(255,255,255,0.52)] px-4 py-3 text-sm leading-7 text-[var(--color-muted)]">
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </aside>
        </section>
      </div>
    </main>
  );
}
