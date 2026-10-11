import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminAuditLogList,
  AdminConfig,
  AdminOverview,
} from "@workspace/api-zod";
import {
  ADMIN_PERMISSIONS,
  type AdminActor,
  type AdminPermission,
  type AuthorizationResolution,
  isValidOwnerEmail,
  normalizeEmail,
  type VerifiedIdentity,
} from "./admin-access";

const MODERATOR_TABLE = "bixgram_admin_moderators";
const AUDIT_TABLE = "bixgram_admin_audit_logs";

type SchemaStatus = AdminConfig["moderatorSchema"];

export interface SecurityEventInput {
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  affectedRecordId?: string | null;
  outcome: "success" | "denied" | "error";
}

export interface AdminService {
  getConfig(): Promise<AdminConfig>;
  resolveAuthorization(token: string): Promise<AuthorizationResolution>;
  recordSecurityEvent(event: SecurityEventInput): Promise<void>;
  getOverview(): Promise<AdminOverview>;
  getAuditLogs(): Promise<AdminAuditLogList>;
}

function environment() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const ownerEmail = process.env.BIXGRAM_OWNER_EMAIL?.trim() ?? "";

  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    ownerEmail,
    authConfigured: Boolean(supabaseUrl && anonKey),
    serviceRoleConfigured: Boolean(serviceRoleKey),
    ownerConfigured: isValidOwnerEmail(ownerEmail),
  };
}

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function getAuthClient(): SupabaseClient | null {
  const config = environment();
  if (!config.authConfigured) return null;
  return createClient(config.supabaseUrl, config.anonKey, clientOptions());
}

function getServiceClient(): SupabaseClient | null {
  const config = environment();
  if (!config.supabaseUrl || !config.serviceRoleKey) return null;
  return createClient(
    config.supabaseUrl,
    config.serviceRoleKey,
    clientOptions(),
  );
}

function isMissingSchemaError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /relation .* does not exist|could not find the table|column .* does not exist/i.test(
      error.message ?? "",
    )
  );
}

async function inspectTable(
  table: typeof MODERATOR_TABLE | typeof AUDIT_TABLE,
): Promise<SchemaStatus> {
  const client = getServiceClient();
  if (!client) return "not_connected";

  const columns =
    table === MODERATOR_TABLE
      ? "user_id,status,permissions"
      : "id,actor_user_id,actor_email,action,affected_record_id,outcome,created_at";

  try {
    const { error } = await client
      .from(table)
      .select(columns, { head: true })
      .limit(0);
    if (!error) return "ready";
    return isMissingSchemaError(error) ? "missing" : "unavailable";
  } catch {
    return "unavailable";
  }
}

function identityFromUser(user: {
  id: string;
  email?: string;
  email_confirmed_at?: string;
}): VerifiedIdentity {
  return {
    userId: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
  };
}

function toAllowedPermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (permission): permission is AdminPermission =>
      typeof permission === "string" &&
      (ADMIN_PERMISSIONS as readonly string[]).includes(permission),
  );
}

function noPlatformMetrics(): AdminOverview {
  const unavailable = (key: string, label: string, message: string) => ({
    key,
    label,
    status: "not_connected" as const,
    message,
  });

  return {
    integrations: [
      unavailable(
        "base44",
        "Bixgram platform API",
        "No authorized Base44 administration API is connected.",
      ),
      unavailable(
        "users",
        "User Management",
        "Connect an authorized user-management API and confirm its schema.",
      ),
      unavailable(
        "reports",
        "Reports and Moderation",
        "No reports API or connected report data is available.",
      ),
      unavailable(
        "public-content",
        "Public Content Moderation",
        "No public-content moderation API is connected.",
      ),
      unavailable(
        "channels",
        "Channel Management",
        "No authorized Channel management API is connected.",
      ),
      unavailable(
        "live",
        "Live Management",
        "No authorized Live management API is connected.",
      ),
      unavailable(
        "verification",
        "Verification Requests",
        "No verification-request API is connected.",
      ),
      unavailable(
        "premium",
        "Premium and Monetization",
        "No monetization integration or platform data is connected.",
      ),
      unavailable(
        "analytics",
        "Platform Analytics",
        "No real analytics source is connected.",
      ),
    ],
    metrics: {
      users: null,
      openReports: null,
      pendingVerification: null,
    },
  };
}

export function createAdminService(): AdminService {
  return {
    async getConfig() {
      const config = environment();
      const [moderatorSchema, auditSchema] = await Promise.all([
        inspectTable(MODERATOR_TABLE),
        inspectTable(AUDIT_TABLE),
      ]);

      return {
        authConfigured: config.authConfigured,
        ownerConfigured: config.ownerConfigured,
        serviceRoleConfigured: config.serviceRoleConfigured,
        moderatorSchema,
        auditSchema,
        base44Api: "not_connected",
        // Supabase URL and anon key are public client configuration. The
        // service-role key and owner email are deliberately never returned.
        supabaseUrl: config.authConfigured ? config.supabaseUrl : null,
        supabaseAnonKey: config.authConfigured ? config.anonKey : null,
      };
    },

    async resolveAuthorization(token) {
      const config = environment();
      const authClient = getAuthClient();
      if (!authClient) return { kind: "auth_not_configured" };

      try {
        const { data, error } = await authClient.auth.getUser(token);
        if (error || !data.user) return { kind: "invalid_token" };

        const identity = identityFromUser(data.user);
        if (!identity.emailVerified) return { kind: "unverified", identity };
        if (!config.ownerConfigured) {
          return { kind: "owner_not_configured", identity };
        }

        if (
          identity.email &&
          normalizeEmail(identity.email) === normalizeEmail(config.ownerEmail)
        ) {
          return {
            kind: "authorized",
            actor: {
              userId: identity.userId,
              email: identity.email,
              role: "OWNER",
              permissions: [...ADMIN_PERMISSIONS],
              emailVerified: true,
            },
          };
        }

        const serviceClient = getServiceClient();
        if (!serviceClient || (await inspectTable(MODERATOR_TABLE)) !== "ready") {
          return { kind: "unauthorized", identity };
        }

        const { data: moderator, error: moderatorError } = await serviceClient
          .from(MODERATOR_TABLE)
          .select("permissions")
          .eq("user_id", identity.userId)
          .eq("status", "approved")
          .maybeSingle();

        if (moderatorError || !moderator) {
          return { kind: "unauthorized", identity };
        }

        return {
          kind: "authorized",
          actor: {
            userId: identity.userId,
            email: identity.email ?? "",
            role: "MODERATOR",
            permissions: toAllowedPermissions(moderator.permissions),
            emailVerified: true,
          },
        };
      } catch {
        // Provider error details may contain request metadata. Return only a
        // fixed status and never log the token or raw provider error.
        return { kind: "invalid_token" };
      }
    },

    async recordSecurityEvent(event) {
      const client = getServiceClient();
      if (!client || (await inspectTable(AUDIT_TABLE)) !== "ready") return;

      try {
        await client.from(AUDIT_TABLE).insert({
          actor_user_id: event.actorUserId,
          actor_email: event.actorEmail,
          action: event.action,
          affected_record_id: event.affectedRecordId ?? null,
          outcome: event.outcome,
        });
      } catch {
        // Audit failures must not expose credentials or break an auth check.
      }
    },

    async getOverview() {
      return noPlatformMetrics();
    },

    async getAuditLogs() {
      const status = await inspectTable(AUDIT_TABLE);
      if (status !== "ready") {
        const apiStatus =
          status === "missing"
            ? "missing_schema"
            : status === "unavailable"
              ? "unavailable"
              : "not_connected";
        return {
          status: apiStatus,
          message:
            status === "missing"
              ? "The required audit-log table is missing. Review and apply the documented schema only after inspecting the target database."
              : status === "unavailable"
                ? "The audit-log table could not be read with the configured server connection."
                : "Audit-log storage is not connected.",
          entries: [],
        };
      }

      const client = getServiceClient();
      if (!client) {
        return {
          status: "not_connected",
          message: "Audit-log storage is not connected.",
          entries: [],
        };
      }

      try {
        const { data, error } = await client
          .from(AUDIT_TABLE)
          .select(
            "id,actor_user_id,actor_email,action,affected_record_id,outcome,created_at",
          )
          .order("created_at", { ascending: false })
          .limit(100);

        if (error || !data) {
          return {
            status: "unavailable",
            message: "Audit records could not be read.",
            entries: [],
          };
        }

        return {
          status: "connected",
          message:
            data.length === 0
              ? "No audit events have been recorded yet."
              : "Showing the latest audit events.",
          entries: data.map((entry) => ({
            id: String(entry.id),
            actorUserId: entry.actor_user_id
              ? String(entry.actor_user_id)
              : null,
            actorEmail: entry.actor_email ?? null,
            action: String(entry.action),
            affectedRecordId: entry.affected_record_id
              ? String(entry.affected_record_id)
              : null,
            outcome: entry.outcome as "success" | "denied" | "error",
            createdAt: new Date(String(entry.created_at)),
          })),
        };
      } catch {
        return {
          status: "unavailable",
          message: "Audit records could not be read.",
          entries: [],
        };
      }
    },
  };
}

export function identityFromAuthorization(
  resolution: AuthorizationResolution,
): VerifiedIdentity | null {
  return resolution.kind === "unverified" ||
    resolution.kind === "unauthorized" ||
    resolution.kind === "owner_not_configured"
    ? resolution.identity
    : null;
}

export function actorFromAuthorization(
  resolution: AuthorizationResolution,
): AdminActor | null {
  return resolution.kind === "authorized" ? resolution.actor : null;
}
