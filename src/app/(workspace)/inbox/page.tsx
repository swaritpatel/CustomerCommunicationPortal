import { UnifiedInboxClient } from "@/modules/inbox/components/unified-inbox-client";
import { requireActiveMembership } from "@/modules/auth/guards";

export default async function InboxPage() {
  await requireActiveMembership();

  return <UnifiedInboxClient />;
}
