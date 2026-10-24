-- One shared customer directory for Spektra Ponuky, Spektra Servis and RS2.
alter table public.customers add column if not exists company text;
alter table public.customers add column if not exists street text;
alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists archived boolean not null default false;
alter table public.customers add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists source_app text;

create index if not exists idx_customers_phone_digits
  on public.customers (regexp_replace(coalesce(phone,''), '\D', '', 'g'))
  where phone is not null and phone <> '';
create index if not exists idx_customers_email_lower
  on public.customers (lower(email))
  where email is not null and email <> '';
create index if not exists idx_customers_updated_at on public.customers(updated_at desc);

grant select, insert, update on public.customers to authenticated;

