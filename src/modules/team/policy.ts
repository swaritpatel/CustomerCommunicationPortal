import type { WorkspaceRole } from "@/modules/auth/types";

export function canManageMembers(role: WorkspaceRole) {
  return role === "ADMIN";
}

export function canChangeAssignment(role: WorkspaceRole) {
  return role === "ADMIN";
}

export function canBeAssigned(role: WorkspaceRole) {
  return role === "ADMIN" || role === "AGENT";
}
