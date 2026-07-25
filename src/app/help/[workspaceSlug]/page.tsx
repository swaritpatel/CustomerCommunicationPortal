import { HelpCenterClient } from "@/modules/kb/components/help-center-client";

export default async function HelpCenterPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <HelpCenterClient workspaceSlug={workspaceSlug} />;
}
