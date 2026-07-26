import Link from "next/link";

import { db } from "@/lib/db";
import { requireActiveMembership } from "@/modules/auth/guards";

const FIRST_RESPONSE_TARGET_MINUTES = 15;
const RESOLUTION_TARGET_HOURS = 24;
const FIRST_RESPONSE_WARNING_MINUTES = 10;
const RESOLUTION_WARNING_HOURS = 18;

type ConversationRow = {
  id: string;
  subject: string;
  channel: "EMAIL" | "CHAT_WIDGET";
  status: "OPEN" | "SNOOZED" | "RESOLVED";
  customerName: string | null;
  customerEmail: string | null;
  currentAssigneeId: string | null;
  currentAssignee: { fullName: string; email: string } | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ senderType: string; senderUserId: string | null; createdAt: Date; body: string }>;
};

type MemberRow = {
  userId: string;
  user: { fullName: string; email: string };
};

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function formatMinutes(value: number | null) {
  if (value === null) {
    return "No customer message";
  }

  if (value < 60) {
    return `${Math.max(0, Math.round(value))}m`;
  }

  const hours = value / 60;
  return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
}

function formatHours(value: number) {
  if (value < 1) {
    return `${Math.round(value * 60)}m`;
  }

  if (value < 48) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
  }

  return `${Math.round(value / 24)}d`;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function customerLabel(conversation: ConversationRow) {
  return conversation.customerName || conversation.customerEmail || "Unknown customer";
}

function channelLabel(channel: ConversationRow["channel"]) {
  return channel === "EMAIL" ? "Email" : "Live chat";
}

function buildSla(conversation: ConversationRow, now: number) {
  const firstVisitor = conversation.messages.find((message) => message.senderType === "VISITOR");
  const firstResponder = conversation.messages.find((message) =>
    message.senderType === "AGENT" || message.senderType === "SYSTEM"
  );

  const firstResponseMinutes =
    firstVisitor && firstResponder
      ? (firstResponder.createdAt.getTime() - firstVisitor.createdAt.getTime()) / 60_000
      : firstVisitor
        ? (now - firstVisitor.createdAt.getTime()) / 60_000
        : null;

  const resolutionHours =
    conversation.status === "RESOLVED"
      ? (conversation.updatedAt.getTime() - conversation.createdAt.getTime()) / 3_600_000
      : (now - conversation.createdAt.getTime()) / 3_600_000;

  const firstResponseBreached =
    conversation.status !== "RESOLVED" &&
    firstResponseMinutes !== null &&
    firstResponseMinutes > FIRST_RESPONSE_TARGET_MINUTES &&
    !firstResponder;
  const firstResponseWarning =
    conversation.status !== "RESOLVED" &&
    firstResponseMinutes !== null &&
    firstResponseMinutes >= FIRST_RESPONSE_WARNING_MINUTES &&
    firstResponseMinutes <= FIRST_RESPONSE_TARGET_MINUTES &&
    !firstResponder;
  const resolutionBreached = conversation.status !== "RESOLVED" && resolutionHours > RESOLUTION_TARGET_HOURS;
  const resolutionWarning =
    conversation.status !== "RESOLVED" &&
    resolutionHours >= RESOLUTION_WARNING_HOURS &&
    resolutionHours <= RESOLUTION_TARGET_HOURS;

  return {
    firstResponseMinutes,
    firstResponseBreached,
    firstResponseWarning,
    resolutionHours,
    resolutionBreached,
    resolutionWarning,
    hasResponder: Boolean(firstResponder),
  };
}

function latestPreview(conversation: ConversationRow) {
  const latest = conversation.messages[conversation.messages.length - 1];
  return latest?.body || conversation.subject;
}

function inboxHref(conversation: ConversationRow) {
  const params = new URLSearchParams({
    status: "ALL",
    channel: conversation.channel,
    conversation: conversation.id,
  });

  return `/inbox?${params.toString()}`;
}

function getDashboardTimestamp() {
  return Date.now();
}

export default async function WorkspaceDashboardPage() {
  const { membership } = await requireActiveMembership();
  const now = getDashboardTimestamp();

  const [conversations, members]: [ConversationRow[], MemberRow[]] = await Promise.all([
    db.conversation.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: { updatedAt: "desc" },
      take: 250,
      select: {
        id: true,
        subject: true,
        channel: true,
        status: true,
        customerName: true,
        customerEmail: true,
        currentAssigneeId: true,
        currentAssignee: {
          select: {
            fullName: true,
            email: true,
          },
        },
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: 100,
          select: {
            senderType: true,
            senderUserId: true,
            createdAt: true,
            body: true,
          },
        },
      },
    }),
    db.workspaceMember.findMany({
      where: {
        workspaceId: membership.workspaceId,
        status: "ACTIVE",
      },
      select: {
        userId: true,
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const enriched = conversations.map((conversation) => ({
    ...conversation,
    sla: buildSla(conversation, now),
  }));

  const active = enriched.filter((conversation) => conversation.status !== "RESOLVED");
  const resolved = enriched.filter((conversation) => conversation.status === "RESOLVED");
  const firstResponseMeasured = enriched
    .filter((conversation) => conversation.sla.hasResponder && conversation.sla.firstResponseMinutes !== null)
    .map((conversation) => conversation.sla.firstResponseMinutes as number);
  const resolutionMeasured = resolved.map((conversation) => conversation.sla.resolutionHours);
  const firstResponseBreached = active.filter((conversation) => conversation.sla.firstResponseBreached);
  const firstResponseWarning = active.filter((conversation) => conversation.sla.firstResponseWarning);
  const resolutionBreached = active.filter((conversation) => conversation.sla.resolutionBreached);
  const resolutionWarning = active.filter((conversation) => conversation.sla.resolutionWarning);
  const riskQueue = [...firstResponseBreached, ...resolutionBreached, ...firstResponseWarning, ...resolutionWarning]
    .filter((conversation, index, list) => list.findIndex((item) => item.id === conversation.id) === index)
    .sort((left, right) => {
      const leftScore =
        (left.sla.firstResponseBreached ? 4 : 0) +
        (left.sla.resolutionBreached ? 3 : 0) +
        left.sla.resolutionHours;
      const rightScore =
        (right.sla.firstResponseBreached ? 4 : 0) +
        (right.sla.resolutionBreached ? 3 : 0) +
        right.sla.resolutionHours;
      return rightScore - leftScore;
    })
    .slice(0, 8);

  const byChannel = {
    EMAIL: enriched.filter((conversation) => conversation.channel === "EMAIL").length,
    CHAT_WIDGET: enriched.filter((conversation) => conversation.channel === "CHAT_WIDGET").length,
  };
  const byStatus = {
    OPEN: enriched.filter((conversation) => conversation.status === "OPEN").length,
    SNOOZED: enriched.filter((conversation) => conversation.status === "SNOOZED").length,
    RESOLVED: resolved.length,
  };
  const busiestHours = [...enriched.reduce((map, conversation) => {
    const firstVisitor = conversation.messages.find((message) => message.senderType === "VISITOR");
    if (firstVisitor) {
      const hour = firstVisitor.createdAt.getHours();
      map.set(hour, (map.get(hour) ?? 0) + 1);
    }
    return map;
  }, new Map<number, number>()).entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  const agentRows = members.map((member) => {
    const assignedActive = active.filter((conversation) => conversation.currentAssigneeId === member.userId);
    const repliesSent = enriched.reduce(
      (count, conversation) =>
        count +
        conversation.messages.filter(
          (message) => message.senderType === "AGENT" && message.senderUserId === member.userId,
        ).length,
      0,
    );

    return {
      id: member.userId,
      name: member.user.fullName,
      email: member.user.email,
      assignedActive: assignedActive.length,
      breached: assignedActive.filter(
        (conversation) => conversation.sla.firstResponseBreached || conversation.sla.resolutionBreached,
      ).length,
      repliesSent,
    };
  }).sort((left, right) => right.breached - left.breached || right.assignedActive - left.assignedActive);

  const resolutionRate = enriched.length > 0 ? resolved.length / enriched.length : 0;
  const firstResponseCompliance =
    firstResponseMeasured.length > 0
      ? 1 - firstResponseMeasured.filter((value) => value > FIRST_RESPONSE_TARGET_MINUTES).length / firstResponseMeasured.length
      : 1;
  const resolutionCompliance =
    enriched.length > 0
      ? 1 - resolutionBreached.length / Math.max(active.length, 1)
      : 1;

  return (
    <main className="grid gap-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">SLA Command Center</p>
          <h2 className="mt-2 text-3xl font-extrabold">Response and resolution health</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            Track first-response and resolution targets, jump into breached conversations, and keep the active queue moving.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href="/inbox?status=OPEN">
            Open queue
          </Link>
          <Link className="btn-primary" href="/inbox?status=ALL">
            Unified inbox
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "First-response target",
            value: `${FIRST_RESPONSE_TARGET_MINUTES}m`,
            detail: `${firstResponseBreached.length} breached · ${firstResponseWarning.length} due soon`,
            state: firstResponseBreached.length > 0 ? "danger" : firstResponseWarning.length > 0 ? "warn" : "ok",
          },
          {
            label: "Resolution target",
            value: `${RESOLUTION_TARGET_HOURS}h`,
            detail: `${resolutionBreached.length} breached · ${resolutionWarning.length} due soon`,
            state: resolutionBreached.length > 0 ? "danger" : resolutionWarning.length > 0 ? "warn" : "ok",
          },
          {
            label: "Resolution rate",
            value: percent(resolutionRate),
            detail: `${resolved.length} resolved of ${enriched.length} conversations`,
            state: resolutionRate >= 0.8 ? "ok" : "warn",
          },
          {
            label: "Active workload",
            value: String(active.length),
            detail: `${byStatus.OPEN} open · ${byStatus.SNOOZED} snoozed`,
            state: active.length > 20 ? "warn" : "ok",
          },
        ].map((metric) => (
          <article
            key={metric.label}
            className={`rounded-[1.5rem] border bg-white/75 p-5 shadow-[0_12px_40px_rgba(42,37,31,0.06)] ${
              metric.state === "danger"
                ? "border-[rgba(224,75,54,0.32)]"
                : metric.state === "warn"
                  ? "border-[rgba(218,156,47,0.38)]"
                  : "border-[var(--color-line)]"
            }`}
          >
            <p className="eyebrow">{metric.label}</p>
            <strong className="mt-2 block text-3xl">{metric.value}</strong>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <article className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="eyebrow">Action queue</p>
              <h3 className="mt-1 text-xl font-bold">Breached and due-soon conversations</h3>
            </div>
            <span className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs font-bold text-[var(--color-muted)]">
              {riskQueue.length} needs attention
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-[1rem] border border-[var(--color-line)]">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr] gap-3 bg-[rgba(250,247,241,0.9)] px-4 py-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-soft)]">
              <span>Conversation</span>
              <span>Owner</span>
              <span>First response</span>
              <span>Resolution</span>
            </div>
            {riskQueue.length > 0 ? (
              riskQueue.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={inboxHref(conversation)}
                  className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr] gap-3 border-t border-[var(--color-line)] px-4 py-3 text-sm transition hover:bg-[rgba(255,255,255,0.75)]"
                >
                  <span className="min-w-0">
                    <strong className="block truncate">{conversation.subject}</strong>
                    <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">
                      {customerLabel(conversation)} · {channelLabel(conversation.channel)}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-[var(--color-muted)]">
                    {conversation.currentAssignee?.fullName ?? "Unassigned"}
                  </span>
                  <span
                    className={
                      conversation.sla.firstResponseBreached
                        ? "font-bold text-[#a63926]"
                        : conversation.sla.firstResponseWarning
                          ? "font-bold text-[#9a6a12]"
                          : "text-[var(--color-muted)]"
                    }
                  >
                    {formatMinutes(conversation.sla.firstResponseMinutes)}
                  </span>
                  <span
                    className={
                      conversation.sla.resolutionBreached
                        ? "font-bold text-[#a63926]"
                        : conversation.sla.resolutionWarning
                          ? "font-bold text-[#9a6a12]"
                          : "text-[var(--color-muted)]"
                    }
                  >
                    {formatHours(conversation.sla.resolutionHours)}
                  </span>
                </Link>
              ))
            ) : (
              <div className="border-t border-[var(--color-line)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                No SLA risks right now.
              </div>
            )}
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
          <p className="eyebrow">SLA performance</p>
          <h3 className="mt-1 text-xl font-bold">Targets vs actuals</h3>
          <div className="mt-5 grid gap-4">
            {[
              {
                label: "First response compliance",
                value: firstResponseCompliance,
                detail: `Median ${formatMinutes(median(firstResponseMeasured))}`,
              },
              {
                label: "Resolution compliance",
                value: resolutionCompliance,
                detail: `Median ${formatHours(median(resolutionMeasured))}`,
              },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <strong>{item.label}</strong>
                  <span className="font-bold">{percent(item.value)}</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-[rgba(42,37,31,0.08)]">
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: percent(item.value) }} />
                </div>
                <p className="mt-2 text-xs text-[var(--color-muted)]">{item.detail}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <article className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
          <p className="eyebrow">Channels</p>
          <h3 className="mt-1 text-xl font-bold">Conversation mix</h3>
          <div className="mt-4 grid gap-3">
            {[
              ["Email", byChannel.EMAIL, "/inbox?status=ALL&channel=EMAIL"],
              ["Live chat", byChannel.CHAT_WIDGET, "/inbox?status=ALL&channel=CHAT_WIDGET"],
            ].map(([label, count, href]) => (
              <Link key={label} href={String(href)} className="flex items-center justify-between rounded-2xl border border-[var(--color-line)] px-4 py-3 text-sm">
                <span className="font-bold">{label}</span>
                <span className="text-[var(--color-muted)]">{count}</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
          <p className="eyebrow">Busiest hours</p>
          <h3 className="mt-1 text-xl font-bold">Inbound pattern</h3>
          <div className="mt-4 grid gap-3">
            {busiestHours.length > 0 ? busiestHours.map(([hour, count]) => (
              <div key={hour} className="flex items-center justify-between rounded-2xl border border-[var(--color-line)] px-4 py-3 text-sm">
                <span className="font-bold">{String(hour).padStart(2, "0")}:00</span>
                <span className="text-[var(--color-muted)]">{count} conversations</span>
              </div>
            )) : (
              <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
                No inbound activity yet.
              </p>
            )}
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
          <p className="eyebrow">Agent workload</p>
          <h3 className="mt-1 text-xl font-bold">Assignments at risk</h3>
          <div className="mt-4 grid gap-3">
            {agentRows.length > 0 ? agentRows.map((agent) => (
              <Link
                key={agent.id}
                href={`/inbox?status=OPEN&assignee=${agent.id}`}
                className="rounded-2xl border border-[var(--color-line)] px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="truncate">{agent.name}</strong>
                  <span className={agent.breached > 0 ? "font-bold text-[#a63926]" : "text-[var(--color-muted)]"}>
                    {agent.breached} breached
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
                  {agent.assignedActive} active assigned · {agent.repliesSent} replies
                </p>
              </Link>
            )) : (
              <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
                No active agents found.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--color-line)] bg-white/78 p-5 shadow-[0_18px_50px_rgba(42,37,31,0.07)]">
        <p className="eyebrow">Recent workload</p>
        <h3 className="mt-1 text-xl font-bold">Latest active conversations</h3>
        <div className="mt-4 grid gap-2">
          {active.slice(0, 10).map((conversation) => (
            <Link
              key={conversation.id}
              href={inboxHref(conversation)}
              className="grid gap-3 rounded-2xl border border-[var(--color-line)] px-4 py-3 text-sm transition hover:bg-white sm:grid-cols-[1fr_160px_120px_120px]"
            >
              <span className="min-w-0">
                <strong className="block truncate">{conversation.subject}</strong>
                <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">{latestPreview(conversation)}</span>
              </span>
              <span className="truncate text-[var(--color-muted)]">{conversation.currentAssignee?.fullName ?? "Unassigned"}</span>
              <span className="font-semibold">{channelLabel(conversation.channel)}</span>
              <span className="text-[var(--color-muted)]">{formatHours(conversation.sla.resolutionHours)} old</span>
            </Link>
          ))}
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
              No active conversations. The queue is clear.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
