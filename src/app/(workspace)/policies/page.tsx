import { requireActiveMembership } from "@/modules/auth/guards";
import { PoliciesAdminClient } from "@/modules/policies/components/policies-admin-client";

export default async function PoliciesPage() {
  const { membership } = await requireActiveMembership();

  return <PoliciesAdminClient workspaceName={membership.workspace.name} />;
}
