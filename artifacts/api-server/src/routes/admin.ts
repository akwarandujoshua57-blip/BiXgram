import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetAdminAuditLogsResponse,
  GetAdminConfigResponse,
  GetAdminDataQueryParams,
  GetAdminDataResponse,
  GetAdminOverviewResponse,
  GetAdminReportsResponse,
  GetAdminSessionResponse,
  GetAdminModerationResponse,
  GetAdminUsersQueryParams,
  GetAdminUsersResponse,
} from "@workspace/api-zod";
import {
  canReviewAuditLogs,
  hasPermission,
  type AdminActor,
  type AdminPermission,
  type AuthorizationResolution,
} from "../lib/admin-access";
import {
  createAdminService,
  identityFromAuthorization,
  type AdminService,
  type SecurityEventInput,
} from "../lib/admin-service";

function bearerToken(request: Request): string | null {
  const header = request.header("authorization");
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function eventFor(
  resolution: AuthorizationResolution | null,
  action: string,
  outcome: SecurityEventInput["outcome"],
): SecurityEventInput {
  const identity = resolution ? identityFromAuthorization(resolution) : null;
  return {
    actorUserId: identity?.userId ?? null,
    actorEmail: identity?.email ?? null,
    action,
    outcome,
  };
}

async function deny(
  response: Response,
  dependencies: AdminService,
  resolution: AuthorizationResolution | null,
  status: 401 | 403 | 503,
  action: string,
  message: string,
) {
  await dependencies.recordSecurityEvent(
    eventFor(resolution, action, "denied"),
  );
  response.status(status).json({ error: message });
}

async function resolveActor(
  request: Request,
  response: Response,
  dependencies: AdminService,
): Promise<AdminActor | null> {
  const token = bearerToken(request);
  if (!token) {
    await deny(
      response,
      dependencies,
      null,
      401,
      "admin.authorization.missing_bearer",
      "A verified Supabase session is required.",
    );
    return null;
  }

  let resolution: AuthorizationResolution;
  try {
    resolution = await dependencies.resolveAuthorization(token);
  } catch {
    await deny(
      response,
      dependencies,
      null,
      503,
      "admin.authorization.error",
      "Authorization is temporarily unavailable.",
    );
    return null;
  }

  if (resolution.kind === "authorized") {
    response.locals.adminActor = resolution.actor;
    return resolution.actor;
  }

  if (resolution.kind === "invalid_token") {
    await deny(
      response,
      dependencies,
      resolution,
      401,
      "admin.authorization.invalid_token",
      "The Supabase session is invalid or expired.",
    );
    return null;
  }

  if (resolution.kind === "auth_not_configured") {
    await deny(
      response,
      dependencies,
      resolution,
      503,
      "admin.authorization.not_configured",
      "Supabase Auth is not configured.",
    );
    return null;
  }

  await deny(
    response,
    dependencies,
    resolution,
    403,
    resolution.kind === "unverified"
      ? "admin.authorization.unverified_email"
      : resolution.kind === "owner_not_configured"
        ? "admin.authorization.owner_not_configured"
        : "admin.authorization.unauthorized",
    resolution.kind === "unverified"
      ? "A verified email address is required."
      : resolution.kind === "owner_not_configured"
        ? "Owner access is disabled until an owner email is configured."
        : "This account has not been approved for Admin Studio.",
  );
  return null;
}

async function requirePermission(
  actor: AdminActor,
  permission: AdminPermission,
  response: Response,
  dependencies: AdminService,
) {
  if (hasPermission(actor, permission)) return true;
  await dependencies.recordSecurityEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: `admin.authorization.denied.${permission}`,
    outcome: "denied",
  });
  response.status(403).json({ error: "This permission has not been granted." });
  return false;
}

export function createAdminRouter(
  dependencies: AdminService = createAdminService(),
): IRouter {
  const router: IRouter = Router();

  router.get("/admin/config", async (_request, response) => {
    try {
      const config = GetAdminConfigResponse.parse(await dependencies.getConfig());
      response.json(config);
    } catch {
      response.status(503).json({ error: "Configuration status is unavailable." });
    }
  });

  router.get("/admin/session", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;

    await dependencies.recordSecurityEvent({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "admin.session.verified",
      outcome: "success",
    });
    response.json(
      GetAdminSessionResponse.parse({
        role: actor.role,
        permissions: actor.permissions,
        emailVerified: actor.emailVerified,
      }),
    );
  });

  router.get("/admin/overview", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;
    if (!(await requirePermission(actor, "overview:read", response, dependencies))) {
      return;
    }

    try {
      response.json(
        GetAdminOverviewResponse.parse(await dependencies.getOverview(actor)),
      );
    } catch {
      response.status(503).json({ error: "Admin overview is unavailable." });
    }
  });

  router.get("/admin/users", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;
    if (!(await requirePermission(actor, "users:read", response, dependencies))) {
      return;
    }
    const query = GetAdminUsersQueryParams.safeParse({
      search: request.query.search,
    });
    if (!query.success) {
      response.status(400).json({ error: "The user search term is invalid." });
      return;
    }
    try {
      response.json(
        GetAdminUsersResponse.parse(
          await dependencies.getUsers(query.data.search ?? ""),
        ),
      );
    } catch {
      response.status(503).json({ error: "User records are unavailable." });
    }
  });

  router.get("/admin/reports", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;
    if (!(await requirePermission(actor, "reports:read", response, dependencies))) {
      return;
    }
    try {
      response.json(
        GetAdminReportsResponse.parse(await dependencies.getReports()),
      );
    } catch {
      response.status(503).json({ error: "Report records are unavailable." });
    }
  });

  router.get("/admin/moderation", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;
    if (!(await requirePermission(actor, "content:read", response, dependencies))) {
      return;
    }
    try {
      response.json(
        GetAdminModerationResponse.parse(await dependencies.getModeration()),
      );
    } catch {
      response.status(503).json({ error: "Moderation records are unavailable." });
    }
  });

  router.get("/admin/data", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;

    const query = GetAdminDataQueryParams.safeParse({
      source: request.query.source,
    });
    if (!query.success) {
      response.status(400).json({ error: "The requested data source is unsupported." });
      return;
    }
    const permissionBySource = {
      verification_requests: "verification:read",
      channel_approvals: "channels:read",
      report_reasons: "reports:read",
      featured_items: "content:read",
      daily_prizes: "premium:read",
    } as const;
    if (
      !(await requirePermission(
        actor,
        permissionBySource[query.data.source],
        response,
        dependencies,
      ))
    ) {
      return;
    }
    try {
      response.json(
        GetAdminDataResponse.parse(
          await dependencies.getDataset(query.data.source),
        ),
      );
    } catch {
      response.status(503).json({ error: "The requested data is unavailable." });
    }
  });

  router.get("/admin/audit-logs", async (request, response) => {
    const actor = await resolveActor(request, response, dependencies);
    if (!actor) return;
    if (!canReviewAuditLogs(actor)) {
      await dependencies.recordSecurityEvent({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "admin.authorization.denied.audit_logs",
        outcome: "denied",
      });
      response.status(403).json({ error: "Owner access is required." });
      return;
    }

    try {
      response.json(
        GetAdminAuditLogsResponse.parse(await dependencies.getAuditLogs()),
      );
    } catch {
      response.status(503).json({ error: "Audit logs are unavailable." });
    }
  });

  return router;
}

export default createAdminRouter();
