-- Company identifiers shared by Servis, Quotes and RS2.
alter table public.customers add column if not exists ico text;
alter table public.customers add column if not exists dic text;
alter table public.customers add column if not exists ic_dph text;
create index if not exists idx_customers_ico on public.customers(ico) where ico is not null and ico <> '';
