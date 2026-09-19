-- 003_weekly_stock_sync.sql

create table if not exists stock_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('mserver_xml','xlsx_upload')),
  source_filename text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'processing'
    check (status in ('processing','preview','success','error','cancelled')),
  is_full_sync boolean not null default true,
  rows_received integer not null default 0,
  rows_normalized integer not null default 0,
  products_new integer not null default 0,
  products_updated integer not null default 0,
  prices_changed integer not null default 0,
  quantities_changed integer not null default 0,
  products_deactivated integer not null default 0,
  conflicts integer not null default 0,
  error_message text,
  summary jsonb not null default '{}'::jsonb
);

alter table pohoda_stocks
  add column if not exists plu text,
  add column if not exists ean text,
  add column if not exists sell_price_inc_vat numeric(12,4),
  add column if not exists margin_pct numeric(10,4),
  add column if not exists discount_pct numeric(10,4),
  add column if not exists min_limit numeric(14,3),
  add column if not exists max_limit numeric(14,3),
  add column if not exists quantity_to_order numeric(14,3),
  add column if not exists stock_group_ref text,
  add column if not exists stock_group text,
  add column if not exists manufacturer text,
  add column if not exists labels text,
  add column if not exists xlsx_fingerprint text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists missing_since timestamptz,
  add column if not exists last_sync_run_id uuid references stock_sync_runs(id) on delete set null;

create index if not exists idx_pohoda_stocks_plu on pohoda_stocks(plu);
create index if not exists idx_pohoda_stocks_xlsx_fingerprint on pohoda_stocks(xlsx_fingerprint);
create index if not exists idx_pohoda_stocks_active on pohoda_stocks(active);
create index if not exists idx_pohoda_stocks_name on pohoda_stocks(name);

create table if not exists pohoda_stock_price_history (
  id uuid primary key default gen_random_uuid(),
  pohoda_stock_uuid uuid not null references pohoda_stocks(id) on delete cascade,
  sync_run_id uuid references stock_sync_runs(id) on delete set null,
  purchase_price_ex_vat numeric(12,4),
  sell_price_ex_vat numeric(12,4),
  sell_price_inc_vat numeric(12,4),
  valid_from timestamptz not null default now()
);

create index if not exists idx_stock_price_history_stock
  on pohoda_stock_price_history(pohoda_stock_uuid, valid_from desc);

create table if not exists stock_sync_staging (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references stock_sync_runs(id) on delete cascade,
  source_row_no integer,
  pohoda_stock_id text,
  xlsx_fingerprint text,
  plu text,
  code text,
  ean text,
  name text not null,
  unit text,
  storage_ref text,
  storage_name text,
  stock_group_ref text,
  stock_group text,
  supplier_name text,
  manufacturer text,
  purchase_price_ex_vat numeric(12,4),
  sell_price_ex_vat numeric(12,4),
  sell_price_inc_vat numeric(12,4),
  quantity_available numeric(14,3),
  min_limit numeric(14,3),
  max_limit numeric(14,3),
  quantity_to_order numeric(14,3),
  margin_pct numeric(10,4),
  discount_pct numeric(10,4),
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','matched','new','conflict','ignored')),
  matched_stock_uuid uuid references pohoda_stocks(id) on delete set null,
  change_flags jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_stock_sync_staging_run
  on stock_sync_staging(sync_run_id);
create index if not exists idx_stock_sync_staging_fingerprint
  on stock_sync_staging(xlsx_fingerprint);

create table if not exists pohoda_stock_suppliers (
  id uuid primary key default gen_random_uuid(),
  pohoda_stock_uuid uuid not null references pohoda_stocks(id) on delete cascade,
  supplier_name text not null,
  supplier_code text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  unique (pohoda_stock_uuid, supplier_name)
);

-- Existing quotes keep their price snapshots.
-- Sync only updates the current master catalog.
