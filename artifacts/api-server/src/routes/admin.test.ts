import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type {
  AdminAuditLogList,
  AdminConfig,
  AdminDataList,
  AdminModerationList,
  AdminOverview,
  AdminReportList,
  AdminUserList,
} from "@workspace/api-zod";
import {
  canReviewAuditLogs,
  hasPermission,
  type AdminActor,
  type AuthorizationResolution,
} from "../lib/admin-access";
import {
  createAdminService,
  type AdminService,
  type SecurityEventInput,
} from "../lib/admin-service";
import { createAdminRouter } from "./admin";

const owner: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  role: "OWNER",
  permissions: [],
  emailVerified: true,
};

const moderator: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000002",
  email: "moderator@example.test",
  role: "MODERATOR",
  permissions: ["overview:read", "users:read"],
  emailVerified: true,
};

const limitedModerator: AdminActor = {
  ...moderator,
  userId: "00000000-0000-4000-8000-000000000003",
  permissions: ["users:read"],
};

const disconnectedConfig: AdminConfig = {
  authConfigured: false,
  ownerConfigured: false,
  serviceRoleConfigured: false,
  moderatorSchema: "not_connected",
  auditSchema: "not_connected",
  profilesSchema: "not_connected",
  usersSchema: "not_connected",
  reportsSchema: "not_connected",
  moderationSchema: "not_connected",
  platformAuditSchema: "not_connected",
  verificationRequestsSchema: "not_connected",
  channelApprovalsSchema: "not_connected",
  reportReasonsSchema: "not_connected",
  featuredItemsSchema: "not_connected",
  dailyPrizesSchema: "not_connected",
  base44Api: "not_connected",
  supabaseUrl: null,
  supabaseAnonKey: null,
};

const disconnectedOverview: AdminOverview = {
  integrations: [
    {
      key: "base44",
      label: "Bixgram platform API",
      status: "not_connected",
      message: "No authorized Base44 administration API is connected.",
    },
  ],
  metrics: {
    users: null,
    reports: null,
    moderationItems: null,
    verificationRequests: null,
    channelApprovals: null,
    featuredItems: null,
    dailyPrizes: null,
  },
};

const disconnectedUsers: AdminUserList = {
  status: "not_connected",
  message: "User source is not connected.",
  entries: [],
};

const disconnectedReports: AdminReportList = {
  status: "not_connected",
  message: "Report source is not connected.",
  entries: [],
};

const disconnectedModeration: AdminModerationList = {
  status: "not_connected",
  message: "Moderation source is not connected.",
  entries: [],
};

const disconnectedAudit: AdminAuditLogList = {
  status: "not_connected",
  message: "Audit-log storage is not connected.",
  entries: [],
};

const events: SecurityEventInput[] = [];

function resolutionFor(token: string): AuthorizationResolution {
  if (token === "owner-test-token") {
    return { kind: "authorized", actor: owner };
  }
  if (token === "approved-moderator-token") {
    return { kind: "authorized", actor: moderator };
  }
  if (token === "limited-moderator-token") {
    return { kind: "authorized", actor: limitedModerator };
  }
  if (token === "unapproved-moderator-token") {
    return {
      kind: "unauthorized",
      identity: {
        userId: "00000000-0000-4000-8000-000000000004",
        email: "pending@example.test",
        emailVerified: true,
      },
    };
  }
  if (token === "unverified-token") {
    return {
      kind: "unverified",
      identity: {
        userId: "00000000-0000-4000-8000-000000000005",
        email: "unverified@example.test",
        emailVerified: false,
      },
    };
  }
  if (token === "owner-not-configured-token") {
    return {
      kind: "owner_not_configured",
      identity: {
        userId: "00000000-0000-4000-8000-000000000006",
        email: "someone@example.test",
        emailVerified: true,
      },
    };
  }
  return { kind: "invalid_token" };
}

const service: AdminService = {
  async getConfig() {
    return disconnectedConfig;
  },
  async resolveAuthorization(token) {
    return resolutionFor(token);
  },
  async recordSecurityEvent(event) {
    events.push(event);
  },
  async getOverview() {
    return disconnectedOverview;
  },
  async getUsers() {
    return disconnectedUsers;
  },
  async getReports() {
    return disconnectedReports;
  },
  async getModeration() {
    return disconnectedModeration;
  },
  async getDataset(source) {
    return {
      source,
      status: "not_connected",
      message: "Data source is not connected.",
      entries: [],
    } satisfies AdminDataList;
  },
  async getAuditLogs() {
    return disconnectedAudit;
  },
};

const app = express()
  .use("/api", createAdminRouter(service))
  .use((_request, response) => response.status(404).json({ error: "Not found" }));

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function get(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

test("unauthenticated users cannot read protected overview data", async () => {
  const protectedRoutes = [
    "/api/admin/session",
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/reports",
    "/api/admin/moderation",
    "/api/admin/data?source=verification_requests",
    "/api/admin/audit-logs",
  ];
  for (const route of protectedRoutes) {
    const response = await get(route);
    assert.equal(response.status, 401, `${route} should require authentication`);
  }
  assert.equal(events.at(-1)?.action, "admin.authorization.missing_bearer");
  assert.equal(events.at(-1)?.outcome, "denied");
});

test("invalid and unverified Supabase identities are denied", async () => {
  const invalid = await get("/api/admin/session", "invalid-token");
  assert.equal(invalid.status, 401);
  const unverified = await get("/api/admin/session", "unverified-token");
  assert.equal(unverified.status, 403);
  assert.equal(events.at(-1)?.action, "admin.authorization.unverified_email");
});

test("ordinary and unapproved users cannot access the dashboard", async () => {
  const response = await get(
    "/api/admin/overview",
    "unapproved-moderator-token",
  );
  assert.equal(response.status, 403);
  assert.equal(events.at(-1)?.actorUserId, "00000000-0000-4000-8000-000000000004");
});

test("a missing owner configuration fails closed for verified users", async () => {
  const response = await get(
    "/api/admin/session",
    "owner-not-configured-token",
  );
  assert.equal(response.status, 403);
  assert.equal(
    events.at(-1)?.action,
    "admin.authorization.owner_not_configured",
  );
});

test("a verified owner session is resolved server-side and recorded", async () => {
  const response = await get("/api/admin/session", "owner-test-token");
  assert.equal(response.status, 200);
  const session = (await response.json()) as {
    role: string;
    emailVerified: boolean;
  };
  assert.equal(session.role, "OWNER");
  assert.equal(session.emailVerified, true);
  assert.equal(events.at(-1)?.action, "admin.session.verified");
  assert.equal(events.at(-1)?.actorUserId, owner.userId);
});

test("moderator access is limited to explicitly granted permissions", async () => {
  assert.equal(
    (await get("/api/admin/overview", "approved-moderator-token")).status,
    200,
  );
  assert.equal(
    (await get("/api/admin/overview", "limited-moderator-token")).status,
    403,
  );
  assert.equal(
    hasPermission(moderator, "users:read"),
    true,
  );
  assert.equal(
    hasPermission(moderator, "reports:read"),
    false,
  );
  assert.equal(canReviewAuditLogs(moderator), false);
  assert.equal(canReviewAuditLogs(owner), true);
  assert.equal(
    (await get("/api/admin/audit-logs", "approved-moderator-token")).status,
    403,
  );
  assert.equal(
    (
      await get("/api/admin/users/user-a/restrict", "approved-moderator-token", {
        method: "POST",
      })
    ).status,
    404,
  );
  assert.equal(
    (await get("/api/admin/reports", "approved-moderator-token")).status,
    403,
  );
  assert.equal(
    (
      await get(
        "/api/admin/data?source=channel_approvals",
        "approved-moderator-token",
      )
    ).status,
    403,
  );
});

test("changing record IDs cannot reach unimplemented user-record endpoints", async () => {
  const first = await get("/api/admin/users/user-a", "owner-test-token");
  const second = await get("/api/admin/users/user-b", "owner-test-token");
  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
});

test("configuration responses never include the service-role key", async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "do-not-return-this-test-value";
  try {
    const config = await createAdminService().getConfig();
    const serialized = JSON.stringify(config);
    assert.equal(config.serviceRoleConfigured, true);
    assert.equal(serialized.includes("do-not-return-this-test-value"), false);
    assert.equal(serialized.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
    assert.equal("serviceRoleKey" in config, false);
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previous.anon;
    if (previous.serviceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRole;
  }
});

test("Admin Studio has no private E2EE message or key endpoints", async () => {
  const plaintextPaths = [
    "/api/admin/conversations",
    "/api/admin/messages/private-message-id",
    "/api/admin/encryption-keys",
    "/api/admin/private-attachments",
  ];
  for (const path of plaintextPaths) {
    assert.equal((await get(path, "owner-test-token")).status, 404);
  }
});

test("disconnected tables produce unavailable metrics instead of fake zeroes", async () => {
  const response = await get("/api/admin/overview", "owner-test-token");
  assert.equal(response.status, 200);
  const data = (await response.json()) as AdminOverview;
  assert.deepEqual(data.metrics, {
    users: null,
    reports: null,
    moderationItems: null,
    verificationRequests: null,
    channelApprovals: null,
    featuredItems: null,
    dailyPrizes: null,
  });
});

test("owner can read each fixed data source and arbitrary table names are rejected", async () => {
  const authorized = "owner-test-token";
  for (const source of [
    "verification_requests",
    "channel_approvals",
    "report_reasons",
    "featured_items",
    "daily_prizes",
  ]) {
    const response = await get(
      `/api/admin/data?source=${source}`,
      authorized,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as AdminDataList;
    assert.equal(body.source, source);
    assert.deepEqual(body.entries, []);
  }
  assert.equal(
    (
      await get("/api/admin/data?source=auth.users", authorized)
    ).status,
    400,
  );
});

test("report metadata responses do not include content or message fields", async () => {
  const response = await get("/api/admin/reports", "owner-test-token");
  assert.equal(response.status, 200);
  const body = (await response.json()) as AdminReportList;
  assert.deepEqual(body.entries, []);
  assert.equal("body" in body, false);
  assert.equal("messageContent" in body, false);
});

test("missing Base44 and audit integrations are explicitly disconnected", async () => {
  const config = await get("/api/admin/config");
  const configBody = (await config.json()) as AdminConfig;
  assert.equal(configBody.base44Api, "not_connected");
  assert.equal(configBody.auditSchema, "not_connected");

  const logs = await get("/api/admin/audit-logs", "owner-test-token");
  assert.equal(logs.status, 200);
  const auditBody = (await logs.json()) as AdminAuditLogList;
  assert.equal(auditBody.status, "not_connected");
  assert.equal(auditBody.entries.length, 0);
  assert.match(auditBody.message ?? "", /not connected/i);
});

test("unsupported moderator-write routes remain unavailable", async () => {
  const response = await get("/api/admin/moderators", "owner-test-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-created@example.test" }),
  });
  assert.equal(
    response.status,
    404,
  );
});
