-- Spektra Ponuky / Supabase production schema
-- Run in Supabase SQL editor or via the Supabase ChatGPT plugin.
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'sales' check (role in ('admin','sales','technician')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  quote_no text unique,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft' check (status in ('lead','draft','ready','sent','approved','rejected')),
  category text,
  brand text,
  system_type text,
  installation_tier text,
  building jsonb not null default '{}'::jsonb,
  device jsonb not null default '{}'::jsonb,
  optional_services jsonb not null default '{}'::jsonb,
  subsidy jsonb not null default '{}'::jsonb,
  subtotal_ex_vat numeric(12,2) not null default 0,
  vat_pct numeric(6,2) not null default 23,
  total_inc_vat numeric(12,2) not null default 0,
  price_complete boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort_order integer not null default 0,
  role text,
  pohoda_stock_id text,
  pohoda_code text,
  name text not null,
  qty numeric(14,3) not null default 1,
  unit text not null default 'ks',
  purchase_price_ex_vat numeric(12,4),
  sell_price_ex_vat numeric(12,4),
  mapping_status text,
  visible_to_customer boolean not null default false,
  customer_group text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.pohoda_stocks (
  id uuid primary key default gen_random_uuid(),
  pohoda_stock_id text,
  fingerprint text unique,
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
  active boolean not null default true,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists idx_quotes_updated on public.quotes(updated_at desc);
create index if not exists idx_quotes_status on public.quotes(status);
create index if not exists idx_quote_items_quote on public.quote_items(quote_id);
create index if not exists idx_stocks_code on public.pohoda_stocks(code);
create index if not exists idx_stocks_plu on public.pohoda_stocks(plu);
create index if not exists idx_stocks_name on public.pohoda_stocks using gin (to_tsvector('simple', name));

alter table public.app_users enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.pohoda_stocks enable row level security;

drop policy if exists "users read own profile" on public.app_users;
create policy "users read own profile" on public.app_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "active users read customers" on public.customers;
create policy "active users read customers" on public.customers
  for select to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write customers" on public.customers;
create policy "active users write customers" on public.customers
  for all to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
  with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read quotes" on public.quotes;
create policy "active users read quotes" on public.quotes
  for select to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write quotes" on public.quotes;
create policy "active users write quotes" on public.quotes
  for all to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
  with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read quote items" on public.quote_items;
create policy "active users read quote items" on public.quote_items
  for select to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write quote items" on public.quote_items;
create policy "active users write quote items" on public.quote_items
  for all to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
  with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read stock" on public.pohoda_stocks;
create policy "active users read stock" on public.pohoda_stocks
  for select to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "admins write stock" on public.pohoda_stocks;
create policy "admins write stock" on public.pohoda_stocks
  for all to authenticated using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active and u.role='admin'))
  with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active and u.role='admin'));
