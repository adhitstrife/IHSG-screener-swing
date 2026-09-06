-- Legacy BSJP history remains separate and cannot satisfy the swing cache.
create table if not exists public.swing_screening_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  generated_at timestamptz not null,
  cache_key text not null,
  strategy_version text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
create index if not exists swing_screening_cache_idx
  on public.swing_screening_runs (cache_key, generated_at desc);
alter table public.swing_screening_runs enable row level security;
comment on table public.swing_screening_runs is
  'Atomic versioned swing snapshots. Server service role only.';
