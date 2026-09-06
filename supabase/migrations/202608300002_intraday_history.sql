create table if not exists public.intraday_candles (
  symbol text not null,
  candle_at timestamptz not null,
  market_date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume bigint not null,
  foreign_buy numeric not null default 0,
  foreign_sell numeric not null default 0,
  source text not null default 'RapidAPI IDX',
  captured_at timestamptz not null default now(),
  primary key (symbol, candle_at)
);

create index if not exists intraday_candles_symbol_date_idx
  on public.intraday_candles (symbol, market_date);

create table if not exists public.market_data_sync_state (
  state_key text primary key,
  cursor_date date not null,
  updated_at timestamptz not null default now()
);

alter table public.intraday_candles enable row level security;
alter table public.market_data_sync_state enable row level security;

comment on table public.intraday_candles is 'Candle OHLCV 15 menit IDX yang di-cache untuk riset dan backtest.';
comment on table public.market_data_sync_state is 'Cursor pekerjaan backfill data pasar yang dijalankan cron.';
