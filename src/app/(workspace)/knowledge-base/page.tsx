import { KbAdminClient } from "@/modules/kb/components/kb-admin-client";
import { requireActiveMembership } from "@/modules/auth/guards";

export default async function KnowledgeBasePage() {
  const { membership } = await requireActiveMembership();

  return (
    <KbAdminClient
      workspaceName={membership.workspace.name}
      workspaceSlug={membership.workspace.slug}
    />
  );
}
