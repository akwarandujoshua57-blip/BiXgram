export const ADMIN_PERMISSIONS = [
  "overview:read",
  "users:read",
  "reports:read",
  "content:read",
  "channels:read",
  "live:read",
  "verification:read",
  "premium:read",
  "analytics:read",
  "audit:read",
  "moderators:read",
  "health:read",
  "settings:read",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminRole = "OWNER" | "MODERATOR";

export interface AdminActor {
  userId: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
  emailVerified: true;
}

export interface VerifiedIdentity {
  userId: string;
  email: string | null;
  emailVerified: boolean;
}

export type AuthorizationResolution =
  | { kind: "authorized"; actor: AdminActor }
  | { kind: "invalid_token" }
  | { kind: "unverified"; identity: VerifiedIdentity }
  | { kind: "unauthorized"; identity: VerifiedIdentity }
  | { kind: "owner_not_configured"; identity: VerifiedIdentity }
  | { kind: "auth_not_configured" };

export function hasPermission(
  actor: AdminActor,
  permission: AdminPermission,
): boolean {
  return actor.role === "OWNER" || actor.permissions.includes(permission);
}

export function canReviewAuditLogs(actor: AdminActor): boolean {
  return actor.role === "OWNER";
}

export function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

export function isValidOwnerEmail(value: string | null | undefined): boolean {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
