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
