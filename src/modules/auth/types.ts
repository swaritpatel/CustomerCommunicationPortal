export const workspaceRoles = ["ADMIN", "AGENT"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const memberStatuses = ["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string;
};

export type WorkspaceContext = {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
};

export type SessionClaims = {
  sub: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
};
