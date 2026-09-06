create table if not exists public.broker_signal_snapshots (
  symbol text not null,
  signal_date date not null,
  broker_accdist text not null,
  avg5_accdist text not null,
  top3_percent numeric not null,
  top5_percent numeric not null,
  net_broker_count integer not null,
  traded_value numeric not null,
  traded_volume numeric not null,
  captured_at timestamptz not null default now(),
  primary key (symbol, signal_date)
);

create index if not exists broker_signal_snapshots_date_idx
  on public.broker_signal_snapshots (signal_date desc);

alter table public.broker_signal_snapshots enable row level security;

comment on table public.broker_signal_snapshots is 'Snapshot harian akumulasi/distribusi broker untuk riset sinyal forward.';
