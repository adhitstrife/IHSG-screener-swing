create table if not exists public.idx_cash_dividends (
  id bigint generated always as identity primary key,
  symbol text not null check (symbol ~ '^[A-Z]{4}$'),
  company_name text not null,
  dividend_per_share numeric not null check (dividend_per_share > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  dividend_kind text not null check (dividend_kind in ('Interim', 'Final', 'Cash')),
  cum_date_regular date not null,
  ex_date_regular date,
  record_date date,
  payment_date date,
  announcement_date date,
  source_url text not null,
  source_reference text,
  source_hash text not null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_cash_dividends_event_identity_idx on public.idx_cash_dividends (symbol, cum_date_regular, dividend_kind);
create index if not exists idx_cash_dividends_cum_idx on public.idx_cash_dividends (cum_date_regular);
create index if not exists idx_cash_dividends_payment_idx on public.idx_cash_dividends (payment_date);
create index if not exists idx_cash_dividends_symbol_idx on public.idx_cash_dividends (symbol);

create table if not exists public.dividend_sync_runs (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz not null,
  status text not null check (status in ('completed', 'failed')),
  events_found integer not null default 0,
  coverage_start date,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array')
);
create index if not exists dividend_sync_runs_synced_idx on public.dividend_sync_runs (synced_at desc);
alter table public.idx_cash_dividends enable row level security;
alter table public.dividend_sync_runs enable row level security;
comment on table public.idx_cash_dividends is 'Normalized cash dividend schedules from official KSEI announcements.';
comment on table public.dividend_sync_runs is 'Server-only KSEI dividend synchronization log.';
