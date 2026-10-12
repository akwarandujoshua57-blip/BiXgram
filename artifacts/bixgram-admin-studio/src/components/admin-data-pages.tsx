import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  ClipboardList,
  Flag,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import {
  useGetAdminData,
  useGetAdminModeration,
  useGetAdminReports,
  useGetAdminUsers,
  type AdminDataList,
  type AdminDataRecord,
  type AdminDataSource,
  type AdminModerationList,
  type AdminReportList,
  type AdminUserList,
} from "@workspace/api-client-react";

function displayError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 403
  ) {
    return "Your authenticated API role does not have permission to read this section.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Try again.";
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">Live Supabase data</div>
        <h1>{title}</h1>
        <p className="lede">{description}</p>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge ${status}`}>
      <i />
      {status.replaceAll("_", " ")}
    </span>
  );
}

function QueryState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="loading-grid" role="status" aria-label="Loading records">
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel error-card" role="alert">
        <AlertCircle size={18} />
        <div className="error-copy">
          <strong>Connected data could not be loaded</strong>
          <span>{displayError(error)}</span>
        </div>
        <button className="button" onClick={onRetry}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
  return null;
}

function TableState({
  status,
  message,
  rows,
  columns,
}: {
  status: string;
  message?: string;
  rows: Array<{ id: string; cells: ReactNode[] }>;
  columns: string[];
}) {
  if (status !== "connected") {
    return (
      <div className="panel panel-pad" role="status">
        <div className="panel-head">
          <div>
            <h2 className="section-title">Data source status</h2>
            <div className="section-note">{message || "No records were returned."}</div>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="audit-empty">
          <ClipboardList size={22} />
          {status === "missing_schema"
            ? "The required table is not exposed in the connected Supabase schema."
            : status === "not_connected"
              ? "No connected data yet."
              : "The table or its safe fields could not be verified."}
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="panel audit-empty" role="status">
        <ClipboardList size={22} />
        <strong>No records yet</strong>
        <span>{message || "The connected table currently contains no matching records."}</span>
      </div>
    );
  }

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div>
          <h2 className="section-title">Connected records</h2>
          <div className="section-note">{message}</div>
        </div>
        <StatusBadge status="connected" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, index) => (
                  <td key={`${row.id}-${index}`}>{cell ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function recordDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function MetadataTable({
  data,
  columns,
  rows,
}: {
  data: { status: string; message?: string };
  columns: string[];
  rows: Array<{ id: string; cells: ReactNode[] }>;
}) {
  return (
    <TableState
      status={data.status}
      message={data.message}
      columns={columns}
      rows={rows}
    />
  );
}

function UserRows(data: AdminUserList | undefined) {
  return (data?.entries ?? []).map((entry) => ({
    id: entry.id,
    cells: [
      <span className="mono" title={entry.id}>{entry.id}</span>,
      entry.username,
      entry.displayName,
      entry.email,
      entry.status,
      recordDate(entry.createdAt),
    ],
  }));
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const query = useGetAdminUsers({ search: search.trim() || undefined });
  return (
    <main className="page-content" data-testid="page-users">
      <PageHeading
        title="User management"
        description="Search verified Supabase user/profile records. Account restrictions are not enabled because the Base44 platform API is not connected."
        action={
          <label className="search-line">
            <Search size={15} aria-hidden="true" />
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="Search email or username"
              aria-label="Search users"
            />
          </label>
        }
      />
      <div className="notice" style={{ marginBottom: 15 }}>
        <ShieldAlert size={15} />
        <span>
          User records are read-only here. Ban/unban controls require a verified
          integration that applies restrictions to Bixgram’s actual account
          system; changing a Supabase profile alone would not restrict a
          separate Base44 account.
        </span>
      </div>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {!query.isLoading && !query.error && query.data && (
        <MetadataTable
          data={query.data}
          columns={["Account ID", "Username", "Display name", "Email", "Status", "Created"]}
          rows={UserRows(query.data)}
        />
      )}
    </main>
  );
}

function reportRows(data: AdminReportList | undefined) {
  return (data?.entries ?? []).map((entry) => ({
    id: entry.id,
    cells: [
      <span className="mono" title={entry.id}>{entry.id}</span>,
      entry.status,
      entry.targetType,
      entry.targetId ? <span className="mono">{entry.targetId}</span> : null,
      entry.reporterId ? <span className="mono">{entry.reporterId}</span> : null,
      entry.reportedUserId ? <span className="mono">{entry.reportedUserId}</span> : null,
      recordDate(entry.createdAt),
    ],
  }));
}

export function ReportsPage() {
  const reports = useGetAdminReports();
  const reasons = useGetAdminData({ source: "report_reasons" });
  return (
    <main className="page-content" data-testid="page-reports">
      <PageHeading
        title="Reports and moderation"
        description="Review report metadata from Supabase. Report text, message bodies, attachments, and E2EE plaintext are never selected."
      />
      <QueryState loading={reports.isLoading} error={reports.error} onRetry={() => void reports.refetch()} />
      {!reports.isLoading && !reports.error && reports.data && (
        <MetadataTable
          data={reports.data}
          columns={["Report ID", "Status", "Target type", "Target ID", "Reporter ID", "Reported user", "Created"]}
          rows={reportRows(reports.data)}
        />
      )}
      <section className="panel panel-pad" style={{ marginTop: 15 }}>
        <div className="panel-head">
          <div>
            <h2 className="section-title">Report reason taxonomy</h2>
            <div className="section-note">Only configured labels and keys are selected.</div>
          </div>
          <Flag size={16} color="#c892d6" />
        </div>
        <QueryState loading={reasons.isLoading} error={reasons.error} onRetry={() => void reasons.refetch()} />
        {!reasons.isLoading && !reasons.error && reasons.data && (
          <MetadataTable
            data={reasons.data}
            columns={["Reason ID", "Label", "Key", "Active"]}
            rows={reasons.data.entries.map((entry) => ({
              id: entry.id,
              cells: [
                <span className="mono">{entry.id}</span>,
                entry.label,
                entry.type,
                entry.status,
              ],
            }))}
          />
        )}
      </section>
    </main>
  );
}

function moderationRows(data: AdminModerationList | undefined) {
  return (data?.entries ?? []).map((entry) => ({
    id: entry.id,
    cells: [
      <span className="mono">{entry.id}</span>,
      entry.status,
      entry.action,
      entry.targetType,
      entry.targetId ? <span className="mono">{entry.targetId}</span> : null,
      entry.moderatorId ? <span className="mono">{entry.moderatorId}</span> : null,
      recordDate(entry.createdAt),
    ],
  }));
}

export function ContentPage() {
  const moderation = useGetAdminModeration();
  const featured = useGetAdminData({ source: "featured_items" });
  return (
    <main className="page-content" data-testid="page-content">
      <PageHeading
        title="Public content moderation"
        description="View public moderation and featured-item metadata. Content bodies and private messages are not fetched."
      />
      <div className="notice" style={{ marginBottom: 15 }}>
        <ShieldAlert size={15} />
        <span>
          Moderation decisions are read-only until the connected platform API
          provides a verified write contract and durable audit behavior.
        </span>
      </div>
      <QueryState loading={moderation.isLoading} error={moderation.error} onRetry={() => void moderation.refetch()} />
      {!moderation.isLoading && !moderation.error && moderation.data && (
        <MetadataTable
          data={moderation.data}
          columns={["Record ID", "Status", "Action", "Target type", "Target ID", "Moderator ID", "Created"]}
          rows={moderationRows(moderation.data)}
        />
      )}
      <section className="panel panel-pad" style={{ marginTop: 15 }}>
        <div className="panel-head">
          <div>
            <h2 className="section-title">Featured items</h2>
            <div className="section-note">Public item references only; no post body or media is fetched.</div>
          </div>
          <Sparkles size={16} color="#c892d6" />
        </div>
        <QueryState loading={featured.isLoading} error={featured.error} onRetry={() => void featured.refetch()} />
        {!featured.isLoading && !featured.error && featured.data && (
          <MetadataTable
            data={featured.data}
            columns={["Item ID", "Label", "Type", "Target ID", "Status", "Created"]}
            rows={featured.data.entries.map((entry: AdminDataRecord) => ({
              id: entry.id,
              cells: [
                <span className="mono">{entry.id}</span>,
                entry.label,
                entry.type,
                entry.relatedId ? <span className="mono">{entry.relatedId}</span> : null,
                entry.status,
                recordDate(entry.createdAt),
              ],
            }))}
          />
        )}
      </section>
    </main>
  );
}

const datasetCopy: Record<
  Extract<AdminDataSource, "verification_requests" | "channel_approvals" | "daily_prizes">,
  { title: string; description: string; notice: string; columns: string[] }
> = {
  verification_requests: {
    title: "Verification requests",
    description: "Review request status and account references from the connected Supabase table.",
    notice: "Identity documents and private evidence are not selected. Approval actions remain disabled until a supported Bixgram API is verified.",
    columns: ["Request ID", "Type", "Related account", "Status", "Created"],
  },
  channel_approvals: {
    title: "Channel approvals",
    description: "View channel approval records from the connected Supabase table.",
    notice: "This reads the approval queue only. Approving a Supabase row is not represented as a Bixgram platform approval while the Base44 API is disconnected.",
    columns: ["Approval ID", "Type", "Channel / requester ID", "Status", "Created"],
  },
  daily_prizes: {
    title: "Daily prize records",
    description: "Review available daily-prize metadata from the connected Supabase table.",
    notice: "This is not a premium, payment, or entitlement integration. Only allowlisted metadata is shown.",
    columns: ["Record ID", "Prize label", "Prize type", "Related ID", "Status", "Created"],
  },
};

export function DatasetPage({
  source,
}: {
  source: Extract<AdminDataSource, "verification_requests" | "channel_approvals" | "daily_prizes">;
}) {
  const copy = datasetCopy[source];
  const query = useGetAdminData({ source });
  const rows = (query.data?.entries ?? []).map((entry) => ({
    id: entry.id,
    cells: [
      <span className="mono">{entry.id}</span>,
      source === "channel_approvals" ? entry.type : entry.label ?? entry.type,
      entry.relatedId ? <span className="mono">{entry.relatedId}</span> : null,
      entry.status,
      recordDate(entry.createdAt),
    ],
  }));
  return (
    <main className="page-content" data-testid={`page-${source}`}>
      <PageHeading title={copy.title} description={copy.description} />
      <div className="notice" style={{ marginBottom: 15 }}>
        <Users size={15} />
        <span>{copy.notice}</span>
      </div>
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      {!query.isLoading && !query.error && query.data && (
        <MetadataTable data={query.data} columns={copy.columns} rows={rows} />
      )}
    </main>
  );
}

