-- 002_pohoda_integration.sql
-- Adds POHODA stock mirror, item identity and export queue.

create table if not exists pohoda_stocks (
  id uuid primary key default gen_random_uuid(),
  pohoda_stock_id text,
  code text not null,
  ean text,
  name text not null,
  storage_id text,
  storage_name text,
  unit text,
  vat_pct numeric(6,2),
  purchase_price_ex_vat numeric(12,4),
  sell_price_ex_vat numeric(12,4),
  quantity_available numeric(14,3),
  supplier_code text,
  supplier_name text,
  active boolean not null default true,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (code, storage_id)
);

create index if not exists idx_pohoda_stocks_code on pohoda_stocks(code);
create index if not exists idx_pohoda_stocks_stockid on pohoda_stocks(pohoda_stock_id);
create index if not exists idx_pohoda_stocks_supplier on pohoda_stocks(supplier_code);

alter table quote_items
  add column if not exists pohoda_stock_uuid uuid references pohoda_stocks(id) on delete set null,
  add column if not exists pohoda_stock_id text,
  add column if not exists pohoda_code text,
  add column if not exists pohoda_storage_id text,
  add column if not exists pohoda_storage_name text,
  add column if not exists source_type text not null default 'pohoda'
    check (source_type in ('pohoda','manual_text')),
  add column if not exists mapping_status text not null default 'unmapped'
    check (mapping_status in ('mapped','unmapped','stale')),
  add column if not exists quantity_planned numeric(14,3),
  add column if not exists quantity_issued numeric(14,3) not null default 0,
  add column if not exists purchase_price_snapshot numeric(12,4),
  add column if not exists sell_price_snapshot numeric(12,4);

create table if not exists bundle_recipes (
  id uuid primary key default gen_random_uuid(),
  bundle_key text not null unique,
  name text not null,
  system_type text,
  max_route_m numeric(10,2),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bundle_recipe_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundle_recipes(id) on delete cascade,
  sort_order integer not null default 0,
  pohoda_stock_uuid uuid references pohoda_stocks(id) on delete restrict,
  pohoda_code text,
  qty numeric(14,3) not null,
  unit text not null,
  qty_rule text,
  required boolean not null default true,
  customer_group text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists pohoda_export_jobs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  job_type text not null check (job_type in (
    'offer',
    'received_order',
    'issued_order',
    'stock_issue',
    'stock_receipt'
  )),
  status text not null default 'queued'
    check (status in ('queued','processing','sent','success','error','cancelled')),
  request_xml text,
  response_xml text,
  pohoda_document_id text,
  pohoda_document_number text,
  error_message text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_export_jobs_status on pohoda_export_jobs(status, created_at);
create index if not exists idx_export_jobs_quote on pohoda_export_jobs(quote_id);

create table if not exists stock_movements_app (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete set null,
  quote_item_id uuid references quote_items(id) on delete set null,
  pohoda_stock_uuid uuid references pohoda_stocks(id) on delete set null,
  movement_type text not null check (movement_type in (
    'planned','reserved','issued','received','returned','cancelled'
  )),
  qty numeric(14,3) not null,
  source_export_job_id uuid references pohoda_export_jobs(id) on delete set null,
  created_at timestamptz not null default now()
);
