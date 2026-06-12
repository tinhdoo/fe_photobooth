create extension if not exists pgcrypto;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  code text unique not null,
  amount integer not null default 0,
  status text not null default 'pending',
  provider text not null default 'sepay',
  bank text,
  account_number text,
  transaction_reference text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz
);

create index if not exists payments_code_idx on payments (code);
create index if not exists payments_session_id_idx on payments (session_id);
create index if not exists payments_status_idx on payments (status);

alter table payments enable row level security;

drop policy if exists "payments_public_read_status" on payments;
create policy "payments_public_read_status"
on payments
for select
to anon
using (true);

-- Inserts/updates are intentionally server-only through Vercel API using
-- SUPABASE_SERVICE_ROLE_KEY, so no anon insert/update policy is created.

create table if not exists app_configs (
  key text primary key default 'app',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_configs enable row level security;

drop policy if exists "app_configs_public_read" on app_configs;
create policy "app_configs_public_read"
on app_configs
for select
to anon
using (true);

insert into app_configs (key, config)
values ('app', '{}'::jsonb)
on conflict (key) do nothing;

create table if not exists payment_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  value integer not null default 0,
  is_used boolean not null default false,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_codes_code_idx on payment_codes (code);
create index if not exists payment_codes_is_used_idx on payment_codes (is_used);
create index if not exists payment_codes_expires_at_idx on payment_codes (expires_at);

alter table payment_codes enable row level security;

drop policy if exists "payment_codes_public_read" on payment_codes;
create policy "payment_codes_public_read"
on payment_codes
for select
to anon
using (true);

-- Code generation and marking used are server-only through Vercel API using
-- SUPABASE_SERVICE_ROLE_KEY.

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,
  name text,
  mode text not null default 'payment',
  last_active timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists devices_device_id_idx on devices (device_id);
create index if not exists devices_last_active_idx on devices (last_active);

alter table devices enable row level security;

drop policy if exists "devices_public_read" on devices;
create policy "devices_public_read"
on devices
for select
to anon
using (true);

-- Device registration, edit, and delete are server-only through Vercel API using
-- SUPABASE_SERVICE_ROLE_KEY.

create table if not exists mobile_uploads (
  id uuid primary key default gen_random_uuid(),
  session_uuid text not null,
  url text not null,
  public_id text,
  created_at timestamptz not null default now()
);

create index if not exists mobile_uploads_session_uuid_idx on mobile_uploads (session_uuid);
create index if not exists mobile_uploads_created_at_idx on mobile_uploads (created_at);

alter table mobile_uploads enable row level security;

drop policy if exists "mobile_uploads_public_read" on mobile_uploads;
create policy "mobile_uploads_public_read"
on mobile_uploads
for select
to anon
using (true);

-- Mobile uploads are inserted server-side through Vercel API using
-- SUPABASE_SERVICE_ROLE_KEY.

create table if not exists photo_sessions (
  id uuid primary key default gen_random_uuid(),
  uuid text unique not null,
  layout_id text,
  composite_url text,
  composite_public_id text,
  photos jsonb not null default '[]'::jsonb,
  payment_method text,
  amount integer not null default 0,
  meta_data jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists photo_sessions_uuid_idx on photo_sessions (uuid);
create index if not exists photo_sessions_created_at_idx on photo_sessions (created_at);
create index if not exists photo_sessions_expires_at_idx on photo_sessions (expires_at);

alter table photo_sessions enable row level security;

drop policy if exists "photo_sessions_public_read" on photo_sessions;
create policy "photo_sessions_public_read"
on photo_sessions
for select
to anon
using (true);

-- Photo sessions are inserted/updated server-side through Vercel API using
-- SUPABASE_SERVICE_ROLE_KEY.

do $$
begin
  alter publication supabase_realtime add table public.app_configs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.devices;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.mobile_uploads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payment_codes;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.photo_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
