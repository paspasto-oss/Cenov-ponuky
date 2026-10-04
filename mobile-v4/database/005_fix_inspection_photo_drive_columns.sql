-- Spektra Obhliadky: doplnenie stĺpcov pre lokálne fotky a Drive odkazy.
-- Spustiť v Supabase SQL editore, ak aplikácia hlási:
-- Could not find the 'drive_file_url' column of 'inspection_photos' in the schema cache.

alter table public.inspection_photos add column if not exists local_photo_key text;
alter table public.inspection_photos add column if not exists original_file_name text;
alter table public.inspection_photos add column if not exists drive_file_url text;
alter table public.inspection_photos add column if not exists drive_folder_url text;
alter table public.inspection_photos add column if not exists sync_status text not null default 'preview_uploaded';
alter table public.inspection_photos add column if not exists file_size_original bigint;
alter table public.inspection_photos add column if not exists file_size_preview bigint;
alter table public.inspection_photos add column if not exists uploaded_at timestamptz not null default now();

create index if not exists idx_inspection_photos_inspection on public.inspection_photos(inspection_id, category);
