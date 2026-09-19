-- Spektra Ponuky v4
-- PostgreSQL / Supabase schema

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null,
  role text not null check (role in ('admin','sales','technician')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  company_id text,
  tax_id text,
  vat_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text unique,
  customer_id uuid references customers(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  assigned_to uuid references app_users(id) on delete set null,
  status text not null default 'draft'
    check (status in ('lead','draft','ready','sent','approved','rejected')),
  category text,
  brand text,
  selected_device_id text,
  system_type text,
  building_address text,
  building_area_m2 numeric(10,2),
  heat_loss_kw numeric(10,2),
  building_class text,
  heating_system text,
  calculated_load_kw numeric(10,2),
  recommended_power_kw numeric(10,2),
  input_snapshot jsonb not null default '{}'::jsonb,
  recommendation_snapshot jsonb not null default '{}'::jsonb,
  subtotal_ex_vat numeric(12,2) not null default 0,
  vat_pct numeric(6,2) not null default 23,
  vat_amount numeric(12,2) not null default 0,
  total_inc_vat numeric(12,2) not null default 0,
  customer_note text,
  internal_note text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  sort_order integer not null default 0,
  item_type text not null default 'material',
  catalog_id text,
  sku text,
  name text not null,
  qty numeric(12,3) not null default 1,
  unit text not null default 'ks',
  purchase_price_ex_vat numeric(12,2),
  sell_price_ex_vat numeric(12,2) not null default 0,
  vat_pct numeric(6,2) not null default 23,
  visible_to_customer boolean not null default true,
  bundle_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  actor_id uuid references app_users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_quotes_status on quotes(status);
create index if not exists idx_quotes_customer on quotes(customer_id);
create index if not exists idx_quotes_updated on quotes(updated_at desc);
create index if not exists idx_quote_items_quote on quote_items(quote_id);

-- RLS should be enabled after Supabase Auth users are connected.
-- Recommended policy: authenticated active users can read/write business data;
-- admin can manage users and pricing data.
