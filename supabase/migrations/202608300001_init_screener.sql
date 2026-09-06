create table if not exists public.screening_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  market_date date not null,
  source text not null default 'RapidAPI IDX',
  universe_size integer not null,
  status text not null default 'completed' check (status in ('completed', 'failed'))
);

create table if not exists public.screening_results (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.screening_runs(id) on delete cascade,
  symbol text not null,
  company_name text not null,
  close_price numeric not null,
  change_percent numeric not null,
  volume_label text not null,
  signal text not null,
  score integer not null check (score between 0 and 100),
  eligible boolean not null,
  as_of_date date not null,
  created_at timestamptz not null default now(),
  unique (run_id, symbol)
);

create index if not exists screening_runs_created_at_idx on public.screening_runs (created_at desc);
create index if not exists screening_results_run_id_idx on public.screening_results (run_id);

alter table public.screening_runs enable row level security;
alter table public.screening_results enable row level security;

comment on table public.screening_runs is 'Riwayat setiap eksekusi screener BSJP.';
comment on table public.screening_results is 'Hasil ranking saham untuk satu screening run.';
