import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminAuditLogList,
  AdminConfig,
  AdminDataList,
  AdminDataSource,
  AdminModerationList,
  AdminOverview,
  AdminReportList,
  AdminUserList,
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
import { logger } from "./logger";

const MODERATOR_TABLE = "bixgram_admin_moderators";
const AUDIT_TABLE = "bixgram_admin_audit_logs";
const PLATFORM_TABLES = [
  "profiles",
  "users",
  "reports",
  "moderation",
  "audit_logs",
  "verification_requests",
  "channel_approvals",
  "report_reasons",
  "featured_items",
  "daily_prizes",
] as const;
type PlatformTable = (typeof PLATFORM_TABLES)[number];
type RestSchemaDocument = {
  definitions?: Record<string, { properties?: Record<string, unknown> }>;
  components?: {
    schemas?: Record<string, { properties?: Record<string, unknown> }>;
  };
  paths?: Record<string, {
    get?: {
      responses?: Record<string, {
        schema?: { $ref?: string; items?: { $ref?: string } };
      }>;
    };
  }>;
};

type SchemaStatus = AdminConfig["moderatorSchema"];
type DataListStatus = AdminUserList["status"];
type InspectableTable =
  | typeof MODERATOR_TABLE
  | typeof AUDIT_TABLE
  | PlatformTable;

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
  getOverview(actor: AdminActor): Promise<AdminOverview>;
  getUsers(search: string): Promise<AdminUserList>;
  getReports(): Promise<AdminReportList>;
  getModeration(): Promise<AdminModerationList>;
  getDataset(source: AdminDataSource): Promise<AdminDataList>;
  getAuditLogs(): Promise<AdminAuditLogList>;
}

let restSchemaCache:
  | { expiresAt: number; document: RestSchemaDocument | null }
  | undefined;

async function getRestSchema(): Promise<RestSchemaDocument | null> {
  if (restSchemaCache && restSchemaCache.expiresAt > Date.now()) {
    return restSchemaCache.document;
  }

  const config = environment();
  if (!config.supabaseUrl || !config.serviceRoleKey) return null;

  try {
    const endpoint = new URL("/rest/v1/", config.supabaseUrl);
    const response = await fetch(endpoint, {
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        accept: "application/openapi+json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      restSchemaCache = { expiresAt: Date.now() + 30_000, document: null };
      return null;
    }

    const document = (await response.json()) as RestSchemaDocument;
    restSchemaCache = { expiresAt: Date.now() + 30_000, document };
    return document;
  } catch {
    restSchemaCache = { expiresAt: Date.now() + 30_000, document: null };
    return null;
  }
}

async function getTableColumns(table: PlatformTable): Promise<Set<string> | null> {
  const document = await getRestSchema();
  if (!document) return null;

  const schemas = {
    ...document.definitions,
    ...document.components?.schemas,
  };
  let definition = schemas[table];
  if (!definition) {
    const schema = document.paths?.[`/${table}`]?.get?.responses?.["200"]
      ?.schema;
    const reference = schema?.items?.$ref ?? schema?.$ref;
    const referenceName = reference?.split("/").at(-1);
    if (referenceName) definition = schemas[referenceName];
  }
  if (!definition?.properties) return null;
  return new Set(Object.keys(definition.properties));
}

function toDataListStatus(status: SchemaStatus): DataListStatus {
  if (status === "ready") return "connected";
  if (status === "missing") return "missing_schema";
  return status;
}

function schemaMessage(label: string, status: SchemaStatus): string {
  if (status === "ready") return `${label} is reachable through the server-side Supabase connection.`;
  if (status === "missing") return `The Supabase ${label} table is missing from the exposed schema.`;
  if (status === "not_connected") return `The server-side Supabase connection is not configured.`;
  return `The Supabase ${label} table could not be verified.`;
}

function nullableString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function nullableDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function listFailure(
  status: DataListStatus,
  message: string,
): { status: DataListStatus; message: string; entries: [] } {
  return { status, message, entries: [] };
}

async function countRows(table: PlatformTable): Promise<number | null> {
  const client = getServiceClient();
  if (!client) return null;

  try {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true });
    return error || count === null ? null : count;
  } catch {
    return null;
  }
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
  table: InspectableTable,
): Promise<SchemaStatus> {
  const client = getServiceClient();
  if (!client) return "not_connected";

  const columns = table === MODERATOR_TABLE
    ? "user_id,status,permissions"
    : table === AUDIT_TABLE
      ? "id,actor_user_id,actor_email,action,affected_record_id,outcome,created_at"
      : "*";

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

export function createAdminService(): AdminService {
  return {
    async getConfig() {
      const config = environment();
      const [
        moderatorSchema,
        auditSchema,
        profilesSchema,
        usersSchema,
        reportsSchema,
        moderationSchema,
        platformAuditSchema,
        verificationRequestsSchema,
        channelApprovalsSchema,
        reportReasonsSchema,
        featuredItemsSchema,
        dailyPrizesSchema,
      ] = await Promise.all([
        inspectTable(MODERATOR_TABLE),
        inspectTable(AUDIT_TABLE),
        inspectTable("profiles"),
        inspectTable("users"),
        inspectTable("reports"),
        inspectTable("moderation"),
        inspectTable("audit_logs"),
        inspectTable("verification_requests"),
        inspectTable("channel_approvals"),
        inspectTable("report_reasons"),
        inspectTable("featured_items"),
        inspectTable("daily_prizes"),
      ]);

      return {
        authConfigured: config.authConfigured,
        ownerConfigured: config.ownerConfigured,
        serviceRoleConfigured: config.serviceRoleConfigured,
        moderatorSchema,
        auditSchema,
        profilesSchema,
        usersSchema,
        reportsSchema,
        moderationSchema,
        platformAuditSchema,
        verificationRequestsSchema,
        channelApprovalsSchema,
        reportReasonsSchema,
        featuredItemsSchema,
        dailyPrizesSchema,
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
        const { error } = await client.from(AUDIT_TABLE).insert({
          actor_user_id: event.actorUserId,
          actor_email: event.actorEmail,
          action: event.action,
          affected_record_id: event.affectedRecordId ?? null,
          outcome: event.outcome,
        });
        if (error) {
          logger.warn({ action: event.action }, "Admin audit event could not be persisted");
        }
      } catch {
        logger.warn({ action: event.action }, "Admin audit event could not be persisted");
      }
    },

    async getOverview(actor) {
      const config = environment();
      const [
        profilesSchema,
        usersSchema,
        reportsSchema,
        moderationSchema,
        auditSchema,
        platformAuditSchema,
        verificationRequestsSchema,
        channelApprovalsSchema,
        reportReasonsSchema,
        featuredItemsSchema,
        dailyPrizesSchema,
      ] = await Promise.all([
        inspectTable("profiles"),
        inspectTable("users"),
        inspectTable("reports"),
        inspectTable("moderation"),
        inspectTable(AUDIT_TABLE),
        inspectTable("audit_logs"),
        inspectTable("verification_requests"),
        inspectTable("channel_approvals"),
        inspectTable("report_reasons"),
        inspectTable("featured_items"),
        inspectTable("daily_prizes"),
      ]);
      const userTable = profilesSchema === "ready"
        ? "profiles"
        : usersSchema === "ready"
          ? "users"
          : null;
      const [
        users,
        reports,
        moderationItems,
        verificationRequests,
        channelApprovals,
        featuredItems,
        dailyPrizes,
      ] = await Promise.all([
        userTable ? countRows(userTable) : Promise.resolve(null),
        countRows("reports"),
        countRows("moderation"),
        countRows("verification_requests"),
        countRows("channel_approvals"),
        countRows("featured_items"),
        countRows("daily_prizes"),
      ]);

      const integration = (
        key: string,
        label: string,
        status: AdminOverview["integrations"][number]["status"],
        message: string,
      ) => ({ key, label, status, message });
      const platformStatus = (tableStatus: SchemaStatus) =>
        tableStatus === "ready"
          ? "connected" as const
          : tableStatus === "missing"
            ? "missing_schema" as const
            : tableStatus;

      return {
        integrations: [
          integration(
            "supabase-auth",
            "Supabase Auth",
            config.authConfigured ? "connected" : "not_connected",
            "This protected request was verified against Supabase Auth.",
          ),
          integration(
            "owner-console",
            "Owner Console",
            actor.role === "OWNER" && config.ownerConfigured
              ? "connected"
              : "not_connected",
            actor.role === "OWNER"
              ? "The API verified the configured owner identity for this session."
              : "Owner-only controls require the configured owner identity.",
          ),
          integration(
            "profiles",
            "Supabase profiles",
            platformStatus(profilesSchema === "ready" ? profilesSchema : usersSchema),
            profilesSchema === "ready"
              ? schemaMessage("profiles", profilesSchema)
              : schemaMessage("users", usersSchema),
          ),
          integration(
            "reports",
            "Supabase reports",
            platformStatus(reportsSchema),
            schemaMessage("reports", reportsSchema),
          ),
          integration(
            "moderation",
            "Supabase moderation",
            platformStatus(moderationSchema),
            schemaMessage("moderation", moderationSchema),
          ),
          integration(
            "verification-requests",
            "Supabase verification_requests",
            platformStatus(verificationRequestsSchema),
            schemaMessage("verification_requests", verificationRequestsSchema),
          ),
          integration(
            "channel-approvals",
            "Supabase channel_approvals",
            platformStatus(channelApprovalsSchema),
            schemaMessage("channel_approvals", channelApprovalsSchema),
          ),
          integration(
            "report-reasons",
            "Supabase report_reasons",
            platformStatus(reportReasonsSchema),
            schemaMessage("report_reasons", reportReasonsSchema),
          ),
          integration(
            "featured-items",
            "Supabase featured_items",
            platformStatus(featuredItemsSchema),
            schemaMessage("featured_items", featuredItemsSchema),
          ),
          integration(
            "daily-prizes",
            "Supabase daily_prizes",
            platformStatus(dailyPrizesSchema),
            schemaMessage("daily_prizes", dailyPrizesSchema),
          ),
          integration(
            "platform-audit",
            "Supabase audit_logs",
            platformStatus(platformAuditSchema),
            schemaMessage("audit_logs", platformAuditSchema),
          ),
          integration(
            "audit",
            "Admin Studio audit store",
            platformStatus(auditSchema),
            schemaMessage("admin audit-log", auditSchema),
          ),
          integration(
            "base44",
            "Bixgram Platform API",
            "not_connected",
            "Base44 is a separate system; no authorized API or backend function is configured.",
          ),
          integration(
            "channels",
            "Channel Management API",
            "not_connected",
            "No authorized channel-management API is configured.",
          ),
          integration(
            "live",
            "Live Management API",
            "not_connected",
            "No authorized live-management API is configured.",
          ),
        ],
        metrics: {
          users,
          reports,
          moderationItems,
          verificationRequests,
          channelApprovals,
          featuredItems,
          dailyPrizes,
        },
      };
    },

    async getUsers(search) {
      const profilesStatus = await inspectTable("profiles");
      const usersStatus = profilesStatus === "ready"
        ? "missing"
        : await inspectTable("users");
      const table = profilesStatus === "ready"
        ? "profiles"
        : usersStatus === "ready"
          ? "users"
          : null;
      const status = table
        ? "ready"
        : profilesStatus === "unavailable"
          ? profilesStatus
          : usersStatus;
      if (status !== "ready") {
        return listFailure(
          toDataListStatus(status),
          schemaMessage("profiles or users", status),
        );
      }

      const client = getServiceClient();
      const columns = await getTableColumns(table!);
      if (!client || !columns) {
        return listFailure(
          "unavailable",
          "The user table is reachable, but its searchable fields could not be safely verified.",
        );
      }

      const idColumn = columns.has("id")
        ? "id"
        : columns.has("user_id")
          ? "user_id"
          : null;
      if (!idColumn) {
        return listFailure(
          "unavailable",
          "The profiles table has no recognized account identifier; no user records were returned.",
        );
      }

      const selected = [
        idColumn,
        "email",
        "username",
        "display_name",
        "full_name",
        "status",
        "created_at",
      ].filter((column, index, list) =>
        columns.has(column) && list.indexOf(column) === index,
      );
      const queryText = search.trim();
      const searchColumn = ["email", "username", "display_name", "full_name"]
        .find((column) => columns.has(column));
      if (queryText && !searchColumn) {
        return listFailure(
          "unavailable",
          "The profiles table has no verified email, username, or display-name field for search.",
        );
      }

      try {
        let query = client.from(table!).select(selected.join(","));
        if (queryText && searchColumn) {
          query = query.ilike(searchColumn, `%${escapeLikeTerm(queryText)}%`);
        }
        if (columns.has("created_at")) {
          query = query.order("created_at", { ascending: false });
        }
        const { data, error } = await query.limit(100);
        if (error || !data) {
          return listFailure(
            "unavailable",
            "User profiles could not be read using the verified field allowlist.",
          );
        }

        return {
          status: "connected",
          message: data.length
            ? `Showing ${data.length} profile${data.length === 1 ? "" : "s"} (maximum 100 per request).`
            : queryText
              ? "No profiles match this search."
              : "No registered user profiles are present yet.",
          entries: data.map((value) => {
            const row = value as unknown as Record<string, unknown>;
            return {
              id: String(row[idColumn]),
              username: nullableString(row.username),
              displayName: nullableString(row.display_name ?? row.full_name),
              email: nullableString(row.email),
              status: nullableString(row.status),
              createdAt: nullableDate(row.created_at),
            };
          }),
        };
      } catch {
        return listFailure("unavailable", "User profiles could not be read.");
      }
    },

    async getReports() {
      const status = await inspectTable("reports");
      if (status !== "ready") {
        return listFailure(
          toDataListStatus(status),
          schemaMessage("reports", status),
        );
      }

      const client = getServiceClient();
      const columns = await getTableColumns("reports");
      if (!client || !columns) {
        return listFailure(
          "unavailable",
          "The reports table is reachable, but its safe metadata fields could not be verified.",
        );
      }

      const idColumn = columns.has("id") ? "id" : null;
      if (!idColumn) {
        return listFailure(
          "unavailable",
          "The reports table has no recognized report identifier; no report records were returned.",
        );
      }
      const selected = [
        idColumn,
        "status",
        "target_type",
        "target_id",
        "reporter_id",
        "reporter_user_id",
        "reported_user_id",
        "created_at",
      ].filter((column, index, list) =>
        columns.has(column) && list.indexOf(column) === index,
      );

      try {
        let query = client.from("reports").select(selected.join(","));
        if (columns.has("created_at")) {
          query = query.order("created_at", { ascending: false });
        }
        const { data, error } = await query.limit(100);
        if (error || !data) {
          return listFailure("unavailable", "Report metadata could not be read.");
        }
        return {
          status: "connected",
          message: data.length
            ? `Showing ${data.length} report${data.length === 1 ? "" : "s"} (maximum 100 per request). Report text, attachments, and message content are not queried.`
            : "No report records are present yet. Report text, attachments, and message content are not queried.",
          entries: data.map((value) => {
            const row = value as unknown as Record<string, unknown>;
            return {
              id: String(row[idColumn]),
              status: nullableString(row.status),
              targetType: nullableString(row.target_type),
              targetId: nullableString(row.target_id),
              reporterId: nullableString(row.reporter_id ?? row.reporter_user_id),
              reportedUserId: nullableString(row.reported_user_id),
              createdAt: nullableDate(row.created_at),
            };
          }),
        };
      } catch {
        return listFailure("unavailable", "Report metadata could not be read.");
      }
    },

    async getModeration() {
      const status = await inspectTable("moderation");
      if (status !== "ready") {
        return listFailure(
          toDataListStatus(status),
          schemaMessage("moderation", status),
        );
      }

      const client = getServiceClient();
      const columns = await getTableColumns("moderation");
      if (!client || !columns) {
        return listFailure(
          "unavailable",
          "The moderation table is reachable, but its safe metadata fields could not be verified.",
        );
      }

      const idColumn = columns.has("id") ? "id" : null;
      if (!idColumn) {
        return listFailure(
          "unavailable",
          "The moderation table has no recognized record identifier; no records were returned.",
        );
      }
      const selected = [
        idColumn,
        "status",
        "action",
        "target_type",
        "target_id",
        "moderator_id",
        "reviewer_id",
        "created_at",
      ].filter((column, index, list) =>
        columns.has(column) && list.indexOf(column) === index,
      );

      try {
        let query = client.from("moderation").select(selected.join(","));
        if (columns.has("created_at")) {
          query = query.order("created_at", { ascending: false });
        }
        const { data, error } = await query.limit(100);
        if (error || !data) {
          return listFailure("unavailable", "Moderation metadata could not be read.");
        }
        return {
          status: "connected",
          message: data.length
            ? `Showing ${data.length} moderation records (maximum 100 per request). Content bodies are not queried.`
            : "No moderation records are present yet. Content bodies are not queried.",
          entries: data.map((value) => {
            const row = value as unknown as Record<string, unknown>;
            return {
              id: String(row[idColumn]),
              status: nullableString(row.status),
              action: nullableString(row.action),
              targetType: nullableString(row.target_type),
              targetId: nullableString(row.target_id),
              moderatorId: nullableString(row.moderator_id ?? row.reviewer_id),
              createdAt: nullableDate(row.created_at),
            };
          }),
        };
      } catch {
        return listFailure("unavailable", "Moderation metadata could not be read.");
      }
    },

    async getDataset(source) {
      const tableBySource: Record<AdminDataSource, PlatformTable> = {
        verification_requests: "verification_requests",
        channel_approvals: "channel_approvals",
        report_reasons: "report_reasons",
        featured_items: "featured_items",
        daily_prizes: "daily_prizes",
      };
      const table = tableBySource[source];
      const status = await inspectTable(table);
      if (status !== "ready") {
        return {
          source,
          ...listFailure(toDataListStatus(status), schemaMessage(table, status)),
        };
      }

      const client = getServiceClient();
      const columns = await getTableColumns(table);
      if (!client || !columns) {
        return {
          source,
          ...listFailure(
            "unavailable",
            `The ${table} table is reachable, but its metadata fields could not be safely verified.`,
          ),
        };
      }

      const idColumn = ["id", "request_id", "approval_id", "item_id"]
        .find((column) => columns.has(column));
      if (!idColumn) {
        return {
          source,
          ...listFailure(
            "unavailable",
            `The ${table} table has no recognized record identifier; no records were returned.`,
          ),
        };
      }

      const candidates: Record<
        AdminDataSource,
        { status: string[]; label: string[]; type: string[]; relatedId: string[] }
      > = {
        verification_requests: {
          status: ["status", "state"],
          label: [],
          type: ["request_type", "type"],
          relatedId: ["user_id", "profile_id"],
        },
        channel_approvals: {
          status: ["status", "state"],
          label: [],
          type: ["channel_type", "type"],
          relatedId: ["channel_id", "channel_uuid", "requester_id", "user_id"],
        },
        report_reasons: {
          status: ["is_active", "active", "status"],
          label: ["label", "name", "title"],
          type: ["key", "code", "slug"],
          relatedId: [],
        },
        featured_items: {
          status: ["status", "is_featured", "featured"],
          label: [],
          type: ["target_type", "content_type", "type"],
          relatedId: ["target_id", "post_id", "content_id"],
        },
        daily_prizes: {
          status: ["status", "is_active", "active"],
          label: ["name", "title", "prize_name"],
          type: ["prize_type", "type"],
          relatedId: [],
        },
      };
      const pickColumn = (names: string[]) => names.find((name) => columns.has(name));
      const selected = [
        idColumn,
        pickColumn(candidates[source].status),
        pickColumn(candidates[source].label),
        pickColumn(candidates[source].type),
        pickColumn(candidates[source].relatedId),
        columns.has("created_at") ? "created_at" : undefined,
      ].filter((value): value is string => Boolean(value));

      try {
        let query = client.from(table).select(selected.join(","));
        if (columns.has("created_at")) {
          query = query.order("created_at", { ascending: false });
        }
        const { data, error } = await query.limit(100);
        if (error || !data) {
          return {
            source,
            ...listFailure("unavailable", `${table} metadata could not be read.`),
          };
        }
        const fields = candidates[source];
        const statusColumn = pickColumn(fields.status);
        const labelColumn = pickColumn(fields.label);
        const typeColumn = pickColumn(fields.type);
        const relatedIdColumn = pickColumn(fields.relatedId);
        return {
          source,
          status: "connected",
          message: data.length
            ? `Showing ${data.length} ${table.replaceAll("_", " ")} records (maximum 100 per request).`
            : `No ${table.replaceAll("_", " ")} records are present yet.`,
          entries: data.map((value) => {
            const row = value as unknown as Record<string, unknown>;
            return {
              id: String(row[idColumn]),
              status: statusColumn ? nullableString(row[statusColumn]) : null,
              label: labelColumn ? nullableString(row[labelColumn]) : null,
              type: typeColumn ? nullableString(row[typeColumn]) : null,
              relatedId: relatedIdColumn ? nullableString(row[relatedIdColumn]) : null,
              createdAt: nullableDate(row.created_at),
            };
          }),
        };
      } catch {
        return {
          source,
          ...listFailure("unavailable", `${table} metadata could not be read.`),
        };
      }
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
