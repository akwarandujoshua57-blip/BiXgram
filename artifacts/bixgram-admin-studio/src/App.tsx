import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, BarChart3,
  ChevronRight, CircleHelp, Clapperboard, ClipboardList, Cloud,
  Fingerprint, Flag, Gauge, HeartHandshake, KeyRound, LayoutDashboard,
  LifeBuoy, LockKeyhole, LogOut, MonitorCog, Radio, RefreshCw, Search,
  Server, Settings2, Shield, ShieldAlert, ShieldCheck, Sparkles, Users,
  UserRoundCheck, Video, WalletCards, type LucideIcon,
} from 'lucide-react';
import {
  getGetAdminAuditLogsQueryKey, getGetAdminOverviewQueryKey, getGetAdminSessionQueryKey,
  setAuthTokenGetter, setBaseUrl, useGetAdminAuditLogs, useGetAdminConfig,
  useGetAdminOverview, useGetAdminSession, useHealthCheck,
  type AdminAuditLogList, type AdminConfig, type AdminOverview, type AdminSession,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { ContentPage, DatasetPage, ReportsPage, UsersPage } from '@/components/admin-data-pages';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

setBaseUrl(import.meta.env.VITE_API_BASE_URL?.trim() || null);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

type NavItem = { path: string; label: string; icon: LucideIcon; group: string };

const navigation: NavItem[] = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { path: '/users', label: 'Users', icon: Users, group: 'Platform' },
  { path: '/reports', label: 'Reports', icon: Flag, group: 'Platform' },
  { path: '/content', label: 'Content', icon: Clapperboard, group: 'Platform' },
  { path: '/channels', label: 'Channels', icon: Radio, group: 'Platform' },
  { path: '/live', label: 'Live', icon: Video, group: 'Platform' },
  { path: '/verification', label: 'Verification', icon: UserRoundCheck, group: 'Platform' },
  { path: '/monetization', label: 'Monetization', icon: WalletCards, group: 'Insights' },
  { path: '/analytics', label: 'Analytics', icon: BarChart3, group: 'Insights' },
  { path: '/security', label: 'Security', icon: Shield, group: 'Administration' },
  { path: '/moderators', label: 'Moderators', icon: HeartHandshake, group: 'Administration' },
  { path: '/health', label: 'System health', icon: Activity, group: 'Administration' },
  { path: '/settings', label: 'Configuration', icon: Settings2, group: 'Administration' },
];
const mobileItems = navigation;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The request could not be completed. Please try again.';
}

function apiErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status;
  return undefined;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function Brand() {
  return <div className="brand" data-testid="brand-bixgram">
    <div className="brand-mark"><Sparkles size={18} strokeWidth={2.2} /></div>
    <div><div className="brand-name">bixgram</div><div className="brand-caption">admin studio</div></div>
  </div>;
}

function Sidebar({ path }: { path: string }) {
  const groups = useMemo(() => [...new Set(navigation.map((item) => item.group))], []);
  return <aside className="sidebar" data-testid="navigation-sidebar">
    <Brand />
    <div className="workspace-tag"><span className="tiny-dot" /> Owner workspace <ChevronRight size={13} style={{ marginLeft: 'auto' }} /></div>
    {groups.map((group) => <div key={group}>
      <div className="nav-label">{group}</div>
      <nav className="nav-group" aria-label={`${group} navigation`}>
        {navigation.filter((item) => item.group === group).map((item) => {
          const Icon = item.icon;
          return <Link key={item.path} href={item.path} className={`nav-link${path === item.path ? ' active' : ''}`} data-testid={`link-nav-${item.path === '/' ? 'overview' : item.path.slice(1)}`}>
            <Icon size={16} strokeWidth={1.8} /><span>{item.label}</span>
          </Link>;
        })}
      </nav>
    </div>)}
    <div className="nav-bottom">
      <Link href="/settings" className="nav-link" data-testid="link-nav-setup-help"><LifeBuoy size={16} /><span>Setup guide</span></Link>
      <div className="sidebar-foot"><div className="foot-signal"><i /> Private control center</div>Connected Supabase data is read-only. Platform actions require a verified Bixgram API.</div>
    </div>
  </aside>;
}

function Header({ session, onSignOut }: { session: AdminSession; onSignOut: () => void }) {
  const [path] = useLocation();
  const current = navigation.find((item) => item.path === path)?.label ?? 'Workspace';
  const initials = session.role === 'OWNER' ? 'OW' : 'MD';
  return <>
    <div className="mobile-top"><Brand /><span className="readiness-pill"><i /> Private workspace</span></div>
    <header className="topbar">
      <div className="crumb">Bixgram / <strong data-testid="text-current-page">{current}</strong></div>
      <div className="top-actions">
        <span className="readiness-pill"><i /> Verified admin session</span>
        <div className="owner-chip"><span className="owner-avatar">{initials}</span><span className="owner-email">{session.role === 'OWNER' ? 'Owner access' : 'Moderator access'}</span></div>
        <button className="signout" aria-label="Sign out" title="Sign out" onClick={onSignOut} data-testid="button-sign-out"><LogOut size={16} /></button>
      </div>
    </header>
  </>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="lede">{description}</p></div>{action}</div>;
}

function LoadError({ title, detail, retry, testId = 'error-data' }: { title: string; detail: string; retry: () => void; testId?: string }) {
  return <div className="panel error-card" role="alert" data-testid={testId}><div className="error-icon"><AlertCircle size={18} /></div><div className="error-copy"><strong>{title}</strong><span>{detail}</span></div><button className="button" onClick={retry} data-testid="button-retry"><RefreshCw size={13} /> Try again</button></div>;
}

function LoadingState() {
  return <div className="loading-grid" role="status" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${status}`} data-testid={`status-${status.replaceAll('_', '-')}`}><i />{statusLabel(status)}</span>;
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: number | null | undefined; icon: LucideIcon }) {
  const available = typeof value === 'number';
  return <div className="panel metric-card" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={15} /></span></div>
    <div className={`metric-number${available ? '' : ' metric-unavailable'}`}>{available ? value.toLocaleString() : 'Unavailable'}</div>
    <div className="metric-foot">{available ? 'Reported by connected platform data' : 'Source is not connected'}</div>
  </div>;
}

function IntegrationRow({ item }: { item: AdminOverview['integrations'][number] }) {
  return <div className="integration-row" data-testid={`integration-${item.key}`}>
    <div className="integration-glyph"><Cloud size={15} /></div>
    <div className="integration-copy"><div className="integration-name">{item.label}</div><div className="integration-message">{item.message}</div></div>
    <StatusBadge status={item.status} />
  </div>;
}

function OverviewPage({ overview, loading, error, retry }: { overview?: AdminOverview; loading: boolean; error: unknown; retry: () => void }) {
  if (loading) return <main className="page-content"><PageHeading eyebrow="Control room" title="Overview" description="Platform readiness and connected data, at a glance." /><LoadingState /></main>;
  if (error || !overview) return <main className="page-content"><PageHeading eyebrow="Control room" title="Overview" description="Platform readiness and connected data, at a glance." /><LoadError title="Overview is unavailable" detail={error ? errorText(error) : 'No overview data was returned.'} retry={retry} /></main>;
  const metrics = overview.metrics;
  const connected = overview.integrations.filter((item) => item.status === 'connected').length;
  return <main className="page-content" data-testid="page-overview">
    <PageHeading eyebrow="Control room / 01" title="Platform readiness" description="A measured view of what is configured—and what still needs a real connection before Bixgram can be administered." />
    <div className="overview-hero">
      <section className="panel welcome-panel" data-testid="card-readiness-summary">
        <div className="micro-label">OWNER CONSOLE · SUPABASE DATA</div>
        <h2>Good to have you here.</h2>
        <p>Connected Supabase records are read directly and shown with honest empty or unavailable states. Base44 remains separate until an authorized platform API is configured.</p>
        <span className="inline-status"><i /> Platform-changing actions remain disabled</span>
      </section>
      <section className="panel readiness-card">
        <div><div className="section-title">Integration posture</div><div className="section-note">Verified Supabase tables and platform APIs</div></div>
        <div className="readiness-big"><span className="readiness-mark"><Gauge size={19} /></span><div><div className="readiness-value">{connected} connected</div><div className="readiness-sub">of {overview.integrations.length} reported integrations</div></div></div>
        <div><div className="quiet-rule" /><span className="inline-status"><i /> Platform write controls stay gated</span></div>
      </section>
    </div>
    <div className="metric-grid">
      <MetricCard label="Users" value={metrics?.users} icon={Users} />
      <MetricCard label="Reports" value={metrics?.reports} icon={Flag} />
      <MetricCard label="Verification requests" value={metrics?.verificationRequests} icon={UserRoundCheck} />
      <MetricCard label="Channel approvals" value={metrics?.channelApprovals} icon={Radio} />
    </div>
    <div className="content-grid">
      <section className="panel panel-pad" data-testid="section-integrations">
        <div className="panel-head"><div><h2 className="section-title">Integration readiness</h2><div className="section-note">Reported status, without assumptions</div></div><span className="micro-label" style={{ margin: '3px 0 0' }}>LIVE STATUS</span></div>
        {overview.integrations.length ? <div className="integration-list">{overview.integrations.map((item) => <IntegrationRow key={item.key} item={item} />)}</div> : <div className="audit-empty"><Cloud size={22} />No integration statuses have been reported.</div>}
      </section>
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="section-title">Control surface</h2><div className="section-note">Connected data stays read-only until platform writes are authorized</div></div><LockKeyhole size={17} color="#b58bc7" /></div>
        <div className="area-list">
          {[
            ['Account lookup', Search, 'profiles'],
            ['Reports & moderation', ShieldAlert, 'reports'],
            ['Public content review', Clapperboard, 'featured-items'],
            ['Channel approvals', Radio, 'channel-approvals'],
            ['Verification requests', Fingerprint, 'verification-requests'],
          ].map(([label, Icon, key]) => {
            const Glyph = Icon as LucideIcon;
            const status = overview.integrations.find((item) => item.key === key)?.status ?? 'unavailable';
            return <div className="area-row" key={label as string}><Glyph size={14} /><span className="area-name">{label as string}</span><span className="area-state">{statusLabel(status)}</span></div>;
          })}
        </div>
        <div className="notice" style={{ marginTop: 15 }}><ShieldCheck size={15} /><span><strong>Safe by design.</strong> Counts come from connected tables; an actual zero is distinct from an unavailable source. Base44 actions remain out of reach without its authorized API.</span></div>
      </section>
    </div>
  </main>;
}

const disconnectedInfo: Record<string, { title: string; description: string; icon: LucideIcon; scope: string }> = {
  '/users': { title: 'Account lookup', description: 'Find and review Bixgram accounts once a verified platform data source is connected.', icon: Users, scope: 'No account directory or lookup API is connected.' },
  '/reports': { title: 'Reports & moderation', description: 'A future queue for platform reports, with clear context and an auditable moderation path.', icon: Flag, scope: 'No report queue or moderation API is connected.' },
  '/content': { title: 'Public content review', description: 'Review public platform content only after its source schema and moderation interface are available.', icon: Clapperboard, scope: 'No public-content source or moderation API is connected.' },
  '/channels': { title: 'Channel reports', description: 'Channel-level reports will appear here when Bixgram reporting data is connected.', icon: Radio, scope: 'No channel reporting source is connected.' },
  '/live': { title: 'Live reports', description: 'A dedicated view for live-session reports, when a real report source is available.', icon: Video, scope: 'No live-report source or API is connected.' },
  '/verification': { title: 'Verification requests', description: 'Review verification requests from a connected platform queue; none are available yet.', icon: UserRoundCheck, scope: 'No verification request source is connected.' },
  '/monetization': { title: 'Premium & monetization', description: 'Understand premium operations only after the platform billing and entitlement sources are integrated.', icon: WalletCards, scope: 'No premium or monetization data source is connected.' },
  '/analytics': { title: 'Platform analytics', description: 'Platform-level reporting requires connected, defined analytics data—not estimates.', icon: BarChart3, scope: 'No platform analytics source is connected.' },
  '/moderators': { title: 'Approved moderators', description: 'Moderator records will be listed here once the moderator schema and a supported API are available.', icon: HeartHandshake, scope: 'No moderator directory is connected.' },
};

function DisconnectedPage({ path }: { path: string }) {
  const data = disconnectedInfo[path];
  const Icon = data.icon;
  return <main className="page-content" data-testid={`page-${path.slice(1)}`}>
    <PageHeading eyebrow="Platform operations / disconnected" title={data.title} description={data.description} />
    <section className="panel unavailable-card" data-testid={`disconnected-${path.slice(1)}`}>
      <div className="unavailable-mark"><Icon size={20} /></div>
      <h2>Not connected yet</h2>
      <p>{data.scope} This workspace does not create sample accounts, reports, content, moderator records, or metrics. No management actions are available here.</p>
      <span className="status-badge"><i />Not connected yet</span>
    </section>
    <div className="notice" style={{ marginTop: 15 }}><CircleHelp size={15} /><span>To make this area operational, connect an approved Bixgram API and its source schema. See <Link href="/settings" data-testid="link-disconnected-configuration" style={{ color: '#7ddce1', textDecoration: 'underline' }}>configuration instructions</Link>.</span></div>
  </main>;
}

function SecurityPage({ session, audit, loading, error, retry }: { session: AdminSession; audit?: AdminAuditLogList; loading: boolean; error: unknown; retry: () => void }) {
  if (session.role !== 'OWNER') return <UnauthorizedPage message="Security audit records are restricted to the verified owner account." />;
  return <main className="page-content" data-testid="page-security">
    <PageHeading eyebrow="Administration / owner only" title="Security" description="Review security posture and supplied audit records. This screen never exposes private keys or encrypted message contents." />
    <div className="content-grid">
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="section-title">Security posture</h2><div className="section-note">The API reports current configuration</div></div><ShieldCheck size={18} color="#6cdae0" /></div>
        <div className="notice callout-cyan"><LockKeyhole size={15} /><span>Owner-only controls are enforced by the API session. This UI does not grant or infer access based on email, route, or browser state.</span></div>
        <div className="config-list" style={{ marginTop: 12 }}>
          <div className="config-row"><div><div className="config-label">Signed-in role</div><div className="config-desc">Resolved from the AdminSession response</div></div><div className="config-value"><StatusBadge status={session.role.toLowerCase()} /></div></div>
          <div className="config-row"><div><div className="config-label">Verified email</div><div className="config-desc">Authentication verification state</div></div><div className="config-value"><StatusBadge status={session.emailVerified ? 'connected' : 'unavailable'} /></div></div>
          <div className="config-row"><div><div className="config-label">Permissions</div><div className="config-desc">Granted by the API for this session</div></div><div className="config-value">{session.permissions.length ? session.permissions.join(', ') : 'No permissions reported'}</div></div>
        </div>
      </section>
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="section-title">Audit trail</h2><div className="section-note">Owner-only · API supplied records</div></div><ClipboardList size={17} color="#c58bd3" /></div>
        {loading ? <LoadingState /> : error ? <LoadError title="Audit records unavailable" detail={errorText(error)} retry={retry} /> : audit ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 13 }}><span className="audit-description">{audit.message || 'Audit status from the admin API.'}</span><StatusBadge status={audit.status} /></div>
          {audit.status !== 'connected' ? <div className="audit-empty" data-testid="empty-audit"><ClipboardList size={22} />{audit.message || 'Audit storage is not connected.'}</div> : !audit.entries.length ? <div className="audit-empty" data-testid="empty-audit"><ClipboardList size={22} />{audit.message || 'No audit events have been recorded yet.'}</div> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Outcome</th></tr></thead><tbody>{audit.entries.map((entry) => <tr key={entry.id} data-testid={`row-audit-${entry.id}`}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorEmail || 'Actor unavailable'}<div className="mono">{entry.actorUserId || '—'}</div></td><td>{entry.action}</td><td className="mono">{entry.affectedRecordId || '—'}</td><td><StatusBadge status={entry.outcome} /></td></tr>)}</tbody></table></div>}
        </> : <div className="audit-empty">No audit response is available.</div>}
      </section>
    </div>
  </main>;
}

function HealthPage() {
  const health = useHealthCheck();
  return <main className="page-content" data-testid="page-health">
    <PageHeading eyebrow="Administration / service status" title="System health" description="Health information is limited to the status response exposed by the API. This is not a live platform observability console." action={<button className="button" onClick={() => void health.refetch()} data-testid="button-refresh-health"><RefreshCw size={13} /> Refresh status</button>} />
    {health.isLoading ? <LoadingState /> : health.error ? <LoadError title="Health endpoint unavailable" detail={errorText(health.error)} retry={() => void health.refetch()} /> : <section className="panel panel-pad" data-testid="health-status-card">
      <div className="panel-head"><div><h2 className="section-title">Admin API health check</h2><div className="section-note">Health check endpoint response</div></div><Server size={17} color="#70d9df" /></div>
      <div className="integration-row"><div className="integration-glyph"><Activity size={15} /></div><div className="integration-copy"><div className="integration-name">API service status</div><div className="integration-message">No deeper service or platform checks are implied.</div></div><StatusBadge status={health.data?.status || 'unavailable'} /></div>
    </section>}
    <div className="notice" style={{ marginTop: 14 }}><AlertCircle size={15} /><span>Platform health, background workers, storage, and third-party service checks are not provided by this endpoint.</span></div>
  </main>;
}

function ConfigurationPage({ config, loading, error, retry }: { config?: AdminConfig; loading: boolean; error: unknown; retry: () => void }) {
  return <main className="page-content" data-testid="page-settings">
    <PageHeading eyebrow="Administration / setup" title="Configuration guide" description="A transparent checklist for connecting supported services. Nothing can be configured or written from this page." />
    {loading ? <LoadingState /> : error || !config ? <LoadError title="Configuration status unavailable" detail={error ? errorText(error) : 'No configuration status was returned.'} retry={retry} /> : <div className="content-grid">
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="section-title">Configuration signals</h2><div className="section-note">Non-secret status only; no credentials are displayed</div></div><MonitorCog size={17} color="#72d8dd" /></div>
        <div className="config-list">
          <ConfigRow label="Authentication" description="Supabase Auth configuration reported by the API" value={config.authConfigured ? 'connected' : 'not_connected'} />
          <ConfigRow label="Owner account" description="Owner identity configured on the server" value={config.ownerConfigured ? 'connected' : 'not_connected'} />
          <ConfigRow label="Moderator schema" description="Source schema for approved moderators" value={config.moderatorSchema} />
          <ConfigRow label="Audit log schema" description="Source schema for owner audit records" value={config.auditSchema} />
          <ConfigRow label="Profiles schema" description="Supabase profile records, read-only" value={config.profilesSchema} />
          <ConfigRow label="Users schema" description="Fallback user table when profiles is not exposed" value={config.usersSchema} />
          <ConfigRow label="Reports schema" description="Report metadata; message content is not fetched" value={config.reportsSchema} />
          <ConfigRow label="Moderation schema" description="Public moderation metadata" value={config.moderationSchema} />
          <ConfigRow label="Verification requests" description="Verification metadata only; no evidence files" value={config.verificationRequestsSchema} />
          <ConfigRow label="Channel approvals" description="Supabase queue; no platform write API implied" value={config.channelApprovalsSchema} />
          <ConfigRow label="Report reasons" description="Allowlisted reason labels and keys" value={config.reportReasonsSchema} />
          <ConfigRow label="Featured items" description="Public item references only" value={config.featuredItemsSchema} />
          <ConfigRow label="Daily prizes" description="Allowlisted prize metadata" value={config.dailyPrizesSchema} />
          <ConfigRow label="Platform audit_logs" description="Separate from the Admin Studio audit store" value={config.platformAuditSchema} />
          <ConfigRow label="Base44 API" description="Platform data/API connection status" value={config.base44Api} />
          <ConfigRow label="Service role key" description="Server-only status; its value is never sent to this interface" value={config.serviceRoleConfigured ? 'connected' : 'not_connected'} />
        </div>
      </section>
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="section-title">Next steps</h2><div className="section-note">Complete setup in the service environments</div></div><ArrowDownRight size={17} color="#c892d6" /></div>
        <div className="steps">
          <div className="step"><span><strong>Configure Supabase Auth</strong> for the admin audience. The public URL and anon key initialize sign-in only; credentials remain in the service configuration.</span></div>
          <div className="step"><span><strong>Set the owner identity server-side</strong> and verify the AdminSession endpoint returns the authoritative role and permissions.</span></div>
          <div className="step"><span><strong>Connect supported Bixgram APIs and schemas</strong> before enabling account, content, moderation, analytics, or monetization work.</span></div>
          <div className="step"><span><strong>Keep privileged keys and private data on the server.</strong> Never expose a service-role key, E2EE plaintext, or private keys here.</span></div>
        </div>
        <div className="notice" style={{ marginTop: 19 }}><KeyRound size={15} /><span>Admin Studio has no signup flow and does not perform configuration writes.</span></div>
      </section>
    </div>}
    <div className="notice" style={{ marginTop: 15 }}><LifeBuoy size={15} /><span>These are instructions only. Integration setup must be completed by an authorized operator in the relevant service configuration.</span></div>
  </main>;
}

function ConfigRow({ label, description, value }: { label: string; description: string; value: string }) {
  return <div className="config-row"><div><div className="config-label">{label}</div><div className="config-desc">{description}</div></div><div className="config-value"><StatusBadge status={value} /></div></div>;
}

function UnauthorizedPage({ message = 'Your verified API session does not permit this area.' }: { message?: string }) {
  return <main className="page-content" data-testid="page-unauthorized">
    <PageHeading eyebrow="Access boundary" title="Owner access required" description="This area is reserved for an authorized owner session." />
    <section className="panel unavailable-card"><div className="unavailable-mark"><ShieldAlert size={20} /></div><h2>Unauthorized</h2><p data-testid="text-unauthorized-reason">{message} Access is determined by the authenticated AdminSession response, never by the browser.</p></section>
  </main>;
}

function SignInPage({ config, configLoading, configError, client, onSignedIn }: { config?: AdminConfig; configLoading: boolean; configError: unknown; client: SupabaseClient | null; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) { setError('Authentication is not configured yet. Ask an authorized operator to complete setup.'); return; }
    setBusy(true);
    setError('');
    const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) { setError(signInError.message); return; }
    setPassword('');
    onSignedIn();
  };
  return <div className="signin-wrap" data-testid="page-sign-in">
    <section className="signin-aside"><Brand /><div><div className="eyebrow">Bixgram / private administration</div><h1>Operate with<br /><em>clarity.</em></h1><p>A private control center for preparing Bixgram operations—with verified access, transparent readiness, and no pretend platform controls.</p></div><div className="aside-footer">PRIVATE · OWNER OPERATED · READ ONLY UNTIL CONNECTED</div></section>
    <section className="signin-main"><div className="signin-card">
      <div className="signin-mobile-brand"><Brand /></div>
      <div className="eyebrow">Secure access</div><h2>Sign in to Admin Studio</h2><p>Use your existing, verified administrator account. There is no public signup.</p>
      {configLoading ? <div className="loading-grid"><div className="skeleton" /></div> : configError ? <div className="signin-error" role="alert" data-testid="error-config">{errorText(configError)}<button className="button button-subtle" style={{ marginLeft: 10 }} onClick={() => window.location.reload()} data-testid="button-reload-config">Reload</button></div> : !config?.authConfigured || !client ? <div className="signin-error" role="status" data-testid="status-auth-unconfigured">Authentication is not connected yet. In this Replit project, add SUPABASE_URL, SUPABASE_ANON_KEY, and BIXGRAM_OWNER_EMAIL in Tools → Secrets. The service-role key is optional for this login screen and must remain server-only. See the setup guide in the project files.</div> : <form className="signin-form" onSubmit={(event) => void submit(event)} data-testid="form-sign-in">
        <label className="field">Administrator email<input className="input" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" data-testid="input-sign-in-email" /></label>
        <label className="field">Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" data-testid="input-sign-in-password" /></label>
        {error && <div className="signin-error" role="alert" data-testid="error-sign-in">{error}</div>}
        <button className="button button-primary signin-submit" type="submit" disabled={busy} data-testid="button-submit-sign-in">{busy ? 'Verifying access…' : <>Continue securely <ArrowRight size={14} /></>}</button>
      </form>}
      <div className="auth-note"><LockKeyhole size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Sign-in authenticates with Supabase. The API independently verifies your session and assigns access. No role, email, or permissions are trusted from this form.</div>
    </div></section>
  </div>;
}

function AppWorkspace({ config, configLoading, configError, session, overview, overviewLoading, overviewError, audit, auditLoading, auditError, retryOverview, retryAudit, retryConfig, onSignOut }: {
  config?: AdminConfig; configLoading: boolean; configError: unknown;
  session: AdminSession; overview?: AdminOverview; overviewLoading: boolean; overviewError: unknown; audit?: AdminAuditLogList; auditLoading: boolean; auditError: unknown; onSignOut: () => void;
  retryOverview: () => void; retryAudit: () => void; retryConfig: () => void;
}) {
  const [path] = useLocation();
  const content = (route: string) => {
    if (route === '/') return <OverviewPage overview={overview} loading={overviewLoading} error={overviewError} retry={retryOverview} />;
    if (route === '/security') return <SecurityPage session={session} audit={audit} loading={auditLoading} error={auditError} retry={retryAudit} />;
    if (route === '/health') return <HealthPage />;
    if (route === '/settings') return <ConfigurationPage config={config} loading={configLoading} error={configError} retry={retryConfig} />;
    if (route === '/users') return <UsersPage />;
    if (route === '/reports') return <ReportsPage />;
    if (route === '/content') return <ContentPage />;
    if (route === '/channels') return <DatasetPage source="channel_approvals" />;
    if (route === '/verification') return <DatasetPage source="verification_requests" />;
    if (route === '/monetization') return <DatasetPage source="daily_prizes" />;
    if (route === '/moderators' && session.role !== 'OWNER') return <UnauthorizedPage message="The moderator directory is restricted to the verified owner account." />;
    if (route in disconnectedInfo) return <DisconnectedPage path={route} />;
    return <NotFound />;
  };
  return <div className="app-shell">
    <Sidebar path={path} />
    <div className="main-area"><Header session={session} onSignOut={onSignOut} />
      <Switch>
        <Route path="/unauthorized"><UnauthorizedPage /></Route>
        {navigation.map((item) => <Route key={item.path} path={item.path}>{content(item.path)}</Route>)}
        <Route component={NotFound} />
      </Switch>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{mobileItems.map((item) => {
      const Icon = item.icon;
      return <Link href={item.path} key={item.path} className={path === item.path ? 'active' : ''} data-testid={`mobile-link-${item.path === '/' ? 'overview' : item.path.slice(1)}`}><Icon /><span>{item.label}</span></Link>;
    })}</nav>
  </div>;
}

function AppRouter() {
  const queryClient = useQueryClient();
  const [path, setLocation] = useLocation();
  const configQuery = useGetAdminConfig();
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const url = configQuery.data?.supabaseUrl;
    const anon = configQuery.data?.supabaseAnonKey;
    if (!configQuery.data?.authConfigured || !url || !anon) {
      setSupabase(null);
      setAuthReady(true);
      setAuthTokenGetter(null);
      return;
    }
    const authClient = createClient(url, anon, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });
    setSupabase(authClient);
    setAuthTokenGetter(async () => {
      const { data } = await authClient.auth.getSession();
      return data.session?.access_token ?? null;
    });
    setAuthReady(true);
    const { data: listener } = authClient.auth.onAuthStateChange(() => {
      void queryClient.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAdminAuditLogsQueryKey() });
    });
    return () => {
      listener.subscription.unsubscribe();
      setAuthTokenGetter(null);
    };
  }, [configQuery.data?.authConfigured, configQuery.data?.supabaseUrl, configQuery.data?.supabaseAnonKey, queryClient]);
  const sessionQuery = useGetAdminSession({ query: { enabled: authReady && !!supabase, queryKey: getGetAdminSessionQueryKey(), retry: false } });
  const overviewQuery = useGetAdminOverview({ query: { enabled: !!sessionQuery.data, queryKey: getGetAdminOverviewQueryKey() } });
  const auditQuery = useGetAdminAuditLogs({ query: { enabled: !!sessionQuery.data && sessionQuery.data.role === 'OWNER' && path === '/security', queryKey: getGetAdminAuditLogsQueryKey() } });

  useEffect(() => {
    if (sessionQuery.data && (path === '/signin' || path === '/')) setLocation('/');
    if (!sessionQuery.data && sessionQuery.error && path !== '/unauthorized') {
      setLocation(apiErrorStatus(sessionQuery.error) === 403 ? '/unauthorized' : '/signin');
    }
  }, [sessionQuery.data, sessionQuery.error, path, setLocation]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    queryClient.clear();
    setLocation('/signin');
  };

  if (apiErrorStatus(sessionQuery.error) === 403) return <UnauthorizedPage message="The authenticated account was not authorized by the admin API." />;
  if (path === '/signin' && (!sessionQuery.data || sessionQuery.error)) {
    return <SignInPage config={configQuery.data} configLoading={configQuery.isLoading} configError={configQuery.error} client={supabase} onSignedIn={() => void sessionQuery.refetch()} />;
  }
  if (path === '/unauthorized' && !sessionQuery.data) return <UnauthorizedPage message="A verified administrator session is required to open this area." />;
  if (!authReady || sessionQuery.isLoading || (sessionQuery.data && !overviewQuery.isFetched && overviewQuery.isLoading)) {
    return <div className="app-shell"><div className="main-area"><div className="page-content"><div className="eyebrow">Bixgram / secure session</div><h1>Resolving access</h1><p className="lede">The admin API is validating this session.</p><div style={{ marginTop: 24 }}><LoadingState /></div></div></div></div>;
  }
  if (configQuery.isLoading) return <div className="app-shell"><div className="main-area"><div className="page-content"><LoadingState /></div></div></div>;
  if (!configQuery.data?.authConfigured || !supabase) return <SignInPage config={configQuery.data} configLoading={configQuery.isLoading} configError={configQuery.error} client={supabase} onSignedIn={() => void sessionQuery.refetch()} />;
  if (sessionQuery.error || !sessionQuery.data) {
    if (path === '/unauthorized') return <UnauthorizedPage message="The API did not return an authorized administrator session." />;
    return <SignInPage config={configQuery.data} configLoading={false} configError={sessionQuery.error} client={supabase} onSignedIn={() => void sessionQuery.refetch()} />;
  }
  return <AppWorkspace
    config={configQuery.data}
    configLoading={configQuery.isLoading}
    configError={configQuery.error}
    session={sessionQuery.data}
    overview={overviewQuery.data}
    overviewLoading={overviewQuery.isLoading}
    overviewError={overviewQuery.error}
    audit={auditQuery.data}
    auditLoading={path === '/security' && auditQuery.isLoading}
    auditError={auditQuery.error}
    retryOverview={() => void overviewQuery.refetch()}
    retryAudit={() => void auditQuery.refetch()}
    retryConfig={() => void configQuery.refetch()}
    onSignOut={() => void signOut()}
  />;
}

function NotFound() {
  return <div className="not-found" data-testid="page-not-found"><div><h1>Page not found</h1><p>This route is not part of Bixgram Admin Studio.</p><Link className="button" href="/" data-testid="link-not-found-overview">Return to overview</Link></div></div>;
}

function Router() {
  return <ErrorBoundary><AppRouter /></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
