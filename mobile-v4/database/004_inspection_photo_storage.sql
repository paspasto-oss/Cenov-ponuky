-- Spektra Obhliadky: fotky lokálne v mobile + náhľady v Supabase + Drive odkazy.
-- Spustiť v Supabase SQL editore po základnej schéme.

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  sync_version integer not null default 1,
  customer_id uuid references public.customers(id) on delete set null,
  technician_id uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','converted','cancelled')),
  inspection_types jsonb not null default '[]'::jsonb,
  site_address text,
  site_contact_name text,
  site_phone text,
  site_email text,
  building jsonb not null default '{}'::jsonb,
  existing_system jsonb not null default '{}'::jsonb,
  heat_loss jsonb not null default '{}'::jsonb,
  proposed_device_stock_id uuid references public.pohoda_stocks(id) on delete set null,
  proposed_device jsonb not null default '{}'::jsonb,
  outdoor_unit jsonb not null default '{}'::jsonb,
  plant_room jsonb not null default '{}'::jsonb,
  electrical jsonb not null default '{}'::jsonb,
  routes jsonb not null default '{}'::jsonb,
  extra_work jsonb not null default '[]'::jsonb,
  installation jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  inspected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_materials (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  pohoda_stock_id uuid references public.pohoda_stocks(id) on delete set null,
  sort_order integer not null default 0,
  role text,
  code text,
  name text not null,
  qty numeric(14,3) not null default 1,
  unit text not null default 'ks',
  source text not null default 'manual',
  original_qty numeric(14,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  category text not null default 'other',
  storage_path text,
  file_name text,
  local_photo_key text,
  original_file_name text,
  drive_file_url text,
  drive_folder_url text,
  sync_status text not null default 'preview_uploaded'
    check (sync_status in ('local_only','pending_upload','preview_uploaded','drive_uploaded','synced','upload_error')),
  file_size_original bigint,
  file_size_preview bigint,
  is_required boolean not null default false,
  caption text,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now()
);

alter table public.inspection_photos add column if not exists local_photo_key text;
alter table public.inspection_photos add column if not exists original_file_name text;
alter table public.inspection_photos add column if not exists drive_file_url text;
alter table public.inspection_photos add column if not exists drive_folder_url text;
alter table public.inspection_photos add column if not exists sync_status text not null default 'preview_uploaded';
alter table public.inspection_photos add column if not exists file_size_original bigint;
alter table public.inspection_photos add column if not exists file_size_preview bigint;
alter table public.inspection_photos add column if not exists uploaded_at timestamptz not null default now();

create table if not exists public.inspection_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.inspection_quotes (
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  relation_type text not null default 'generated',
  created_at timestamptz not null default now(),
  primary key (inspection_id, quote_id)
);

create index if not exists idx_inspections_updated on public.inspections(updated_at desc);
create index if not exists idx_inspection_materials_inspection on public.inspection_materials(inspection_id, sort_order);
create index if not exists idx_inspection_photos_inspection on public.inspection_photos(inspection_id, category);
create index if not exists idx_inspection_events_inspection on public.inspection_events(inspection_id, created_at desc);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('inspection-media','inspection-media',false,1048576,array['image/jpeg','image/webp','image/png'])
on conflict (id) do update
set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg','image/webp','image/png'];

alter table public.inspections enable row level security;
alter table public.inspection_materials enable row level security;
alter table public.inspection_photos enable row level security;
alter table public.inspection_events enable row level security;
alter table public.inspection_quotes enable row level security;

drop policy if exists "active users read inspections" on public.inspections;
create policy "active users read inspections" on public.inspections for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write inspections" on public.inspections;
create policy "active users write inspections" on public.inspections for all to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read inspection children" on public.inspection_materials;
create policy "active users read inspection children" on public.inspection_materials for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write inspection children" on public.inspection_materials;
create policy "active users write inspection children" on public.inspection_materials for all to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read inspection photos" on public.inspection_photos;
create policy "active users read inspection photos" on public.inspection_photos for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write inspection photos" on public.inspection_photos;
create policy "active users write inspection photos" on public.inspection_photos for all to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read inspection events" on public.inspection_events;
create policy "active users read inspection events" on public.inspection_events for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write inspection events" on public.inspection_events;
create policy "active users write inspection events" on public.inspection_events for insert to authenticated
with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read inspection quotes" on public.inspection_quotes;
create policy "active users read inspection quotes" on public.inspection_quotes for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users write inspection quotes" on public.inspection_quotes;
create policy "active users write inspection quotes" on public.inspection_quotes for all to authenticated
using (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active))
with check (exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));

drop policy if exists "active users read inspection media" on storage.objects;
create policy "active users read inspection media" on storage.objects for select to authenticated
using (bucket_id='inspection-media' and exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users upload inspection media" on storage.objects;
create policy "active users upload inspection media" on storage.objects for insert to authenticated
with check (bucket_id='inspection-media' and exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
drop policy if exists "active users delete inspection media" on storage.objects;
create policy "active users delete inspection media" on storage.objects for delete to authenticated
using (bucket_id='inspection-media' and exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.active));
