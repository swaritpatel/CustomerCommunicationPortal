import type { ReactNode } from "react";

import { db } from "@/lib/db";
import { requireActiveMembership } from "@/modules/auth/guards";
import { WorkspaceShell } from "@/modules/navigation/workspace-shell";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { membership } = await requireActiveMembership();
  const [unresolvedCount, unreadCount, chatUnreadCount, pendingInviteCount] = await Promise.all([
    db.conversation.count({
      where: {
        workspaceId: membership.workspaceId,
        status: { in: ["OPEN", "SNOOZED"] },
        messages: { some: {} },
      },
    }),
    db.chatMessage.count({
      where: {
        workspaceId: membership.workspaceId,
        senderType: "VISITOR",
        readByAgentAt: null,
      },
    }),
    db.chatMessage.count({
      where: {
        workspaceId: membership.workspaceId,
        senderType: "VISITOR",
        readByAgentAt: null,
        conversation: { channel: "CHAT_WIDGET" },
      },
    }),
    db.invite.count({
      where: {
        workspaceId: membership.workspaceId,
        status: "PENDING",
      },
    }),
  ]);

  return (
    <WorkspaceShell
      workspaceName={membership.workspace.name}
      workspaceSlug={membership.workspace.slug}
      role={membership.role}
      userEmail={membership.user.email}
      unreadCount={unreadCount}
      unresolvedCount={unresolvedCount}
      chatUnreadCount={chatUnreadCount}
      pendingInviteCount={pendingInviteCount}
    >
      {children}
    </WorkspaceShell>
  );
}
