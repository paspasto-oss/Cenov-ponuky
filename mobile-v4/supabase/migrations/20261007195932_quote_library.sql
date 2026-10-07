-- Additive shared HVAC template/pricing/realization library.
-- Existing offers and their saved prices are not modified.
create table public.quote_library (
  key text primary key check (length(key) between 1 and 240),
  kind text not null check (kind in ('template','pricing','feedback')),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152),
  revision integer not null default 1 check (revision > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quote_library enable row level security;
revoke all on public.quote_library from anon;
grant select,insert,update on public.quote_library to authenticated;

create policy "active Spektra users read quote library"
on public.quote_library for select to authenticated
using (exists (select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));

create policy "active Spektra users insert quote library"
on public.quote_library for insert to authenticated
with check (exists (select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));

create policy "active Spektra users update quote library"
on public.quote_library for update to authenticated
using (exists (select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active))
with check (exists (select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));

create function spektra_private.quote_library_stamp()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.key<>old.key or new.kind<>old.kind or new.revision<>old.revision+1 then
      raise exception using errcode='40001',message='Zostava sa medzitým zmenila. Obnovte knižnicu a zopakujte úpravu.';
    end if;
    new.created_by:=old.created_by;
    new.created_at:=old.created_at;
  elsif new.revision<>1 then
    raise exception using errcode='22023',message='Nová zostava musí začínať verziou 1.';
  end if;
  if tg_op='INSERT' then new.created_by:=auth.uid(); end if;
  new.updated_by:=auth.uid();
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function spektra_private.quote_library_stamp() from public,anon,authenticated;
create trigger quote_library_stamp before insert or update on public.quote_library
for each row execute function spektra_private.quote_library_stamp();
