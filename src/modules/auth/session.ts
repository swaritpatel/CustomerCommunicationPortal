import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "@/modules/auth/constants";
import type { SessionClaims } from "@/modules/auth/types";

const accessSecret = new TextEncoder().encode(serverEnv.JWT_ACCESS_SECRET);

export async function getSessionClaims() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("relaydesk_access")?.value;

  if (accessToken) {
    try {
      const verified = await jwtVerify(accessToken, accessSecret);
      const claims = verified.payload;

      if (
        typeof claims.sub === "string" &&
        typeof claims.email === "string" &&
        typeof claims.workspaceId === "string" &&
        typeof claims.workspaceSlug === "string" &&
        (claims.role === "ADMIN" || claims.role === "AGENT")
      ) {
        return {
          sub: claims.sub,
          email: claims.email,
          workspaceId: claims.workspaceId,
          workspaceSlug: claims.workspaceSlug,
          role: claims.role,
        } satisfies SessionClaims;
      }
    } catch {
      // Fall through to refresh-cookie lookup below.
    }
  }

  const refreshToken = cookieStore.get("relaydesk_refresh")?.value;
  if (!refreshToken) {
    return null;
  }

  const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
  const session = await db.session.findFirst({
    where: {
      refreshTokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          memberships: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              role: true,
              workspace: {
                select: {
                  id: true,
                  slug: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const membership = session?.user.memberships[0];
  if (!session || !membership) {
    return null;
  }

  return {
    sub: session.user.id,
    email: session.user.email,
    workspaceId: membership.workspace.id,
    workspaceSlug: membership.workspace.slug,
    role: membership.role,
  } satisfies SessionClaims;
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
    ...(serverEnv.COOKIE_DOMAIN === "localhost"
      ? {}
      : {
          domain: serverEnv.COOKIE_DOMAIN,
        }),
  };
}

export async function issueSession(input: SessionClaims) {
  const accessToken = await new SignJWT({
    email: input.email,
    workspaceId: input.workspaceId,
    workspaceSlug: input.workspaceSlug,
    role: input.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret);

  const refreshToken = randomBytes(32).toString("hex");
  const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");

  await db.session.create({
    data: {
      userId: input.sub,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });

  const cookieStore = await cookies();

  cookieStore.set("relaydesk_access", accessToken, sessionCookieOptions(ACCESS_TOKEN_TTL_SECONDS));
  cookieStore.set("relaydesk_refresh", refreshToken, sessionCookieOptions(REFRESH_TOKEN_TTL_SECONDS));
}

export async function clearSession() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("relaydesk_refresh")?.value;

  if (refreshToken) {
    const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");

    await db.session.deleteMany({
      where: { refreshTokenHash },
    });
  }

  cookieStore.set("relaydesk_access", "", sessionCookieOptions(0));
  cookieStore.set("relaydesk_refresh", "", sessionCookieOptions(0));
}
