-- REVIEW-ONLY template. This file is never executed by the application.
-- First inspect the intended Supabase schema read-only. Apply manually only
-- after confirming these table names are unused and this additive design fits.
-- No Bixgram/Base44 platform tables or records are changed by this template.

create table public.bixgram_admin_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null check (status in ('pending', 'approved', 'revoked')),
  permissions text[] not null default '{}',
  invited_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bixgram_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  affected_record_id text,
  outcome text not null check (outcome in ('success', 'denied', 'error')),
  created_at timestamptz not null default now()
);

alter table public.bixgram_admin_moderators enable row level security;
alter table public.bixgram_admin_audit_logs enable row level security;

-- API access uses the server-only service-role key after its own per-request
-- authentication and authorization checks. Do not grant these tables to
-- browser roles and do not create permissive RLS policies.
revoke all on table public.bixgram_admin_moderators from anon, authenticated;
revoke all on table public.bixgram_admin_audit_logs from anon, authenticated;
grant select on table public.bixgram_admin_moderators to service_role;
grant select, insert on table public.bixgram_admin_audit_logs to service_role;

-- Do not insert owner or moderator records here. Owner authority is configured
-- server-side; a moderator must be individually approved by the owner.
