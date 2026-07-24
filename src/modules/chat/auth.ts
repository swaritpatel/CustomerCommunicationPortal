import { SignJWT, jwtVerify } from "jose";

const visitorSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET ?? "");

type VisitorTokenInput = {
  workspaceId: string;
  conversationId: string;
  customerKey: string;
};

export async function issueVisitorToken(input: VisitorTokenInput) {
  return new SignJWT({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    customerKey: input.customerKey,
    actor: "VISITOR",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.conversationId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(visitorSecret);
}

export async function verifyVisitorToken(token: string) {
  try {
    const verified = await jwtVerify(token, visitorSecret);
    const payload = verified.payload;

    if (
      payload.actor !== "VISITOR" ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.conversationId !== "string" ||
      typeof payload.customerKey !== "string"
    ) {
      return null;
    }

    return {
      workspaceId: payload.workspaceId,
      conversationId: payload.conversationId,
      customerKey: payload.customerKey,
    };
  } catch {
    return null;
  }
}

export function readBearerToken(headerValue: string | null) {
  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    return null;
  }

  return headerValue.slice(7).trim();
}
