import { randomBytes } from "node:crypto";

import { db, type DbTransactionClient } from "@/lib/db";

function ticketSuffix() {
  return Array.from(randomBytes(4))
    .map((byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 8);
}

export async function generateUniqueTicketNumber(input: {
  workspaceId: string;
  tx?: DbTransactionClient;
}) {
  const client = input.tx ?? db;
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `CCP-${datePart}-${ticketSuffix()}`;
    const existing = await client.conversation.findUnique({
      where: {
        workspaceId_ticketNumber: {
          workspaceId: input.workspaceId,
          ticketNumber: candidate,
        },
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return `CCP-${datePart}-${randomBytes(4).toString("hex").toUpperCase()}`;
}
