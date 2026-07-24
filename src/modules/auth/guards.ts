import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getSessionClaims } from "@/modules/auth/session";

export async function requireActiveMembership() {
  const claims = await getSessionClaims();

  if (!claims) {
    redirect("/login");
  }

  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: claims.workspaceId,
        userId: claims.sub,
      },
    },
    include: {
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
  });

  if (!membership || membership.status !== "ACTIVE") {
    redirect("/login");
  }

  return {
    claims,
    membership,
  };
}
