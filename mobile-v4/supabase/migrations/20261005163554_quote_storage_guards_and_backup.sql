-- Atomic quote storage. Apply once through the Supabase migration API.
-- Private recovery copies never enter the public repository or Storage buckets.
create schema if not exists spektra_private;
revoke all on schema spektra_private from public, anon, authenticated;
grant usage on schema spektra_private to authenticated;
create table if not exists spektra_private.storage_repair_backup (
  repair_key text not null,
  entity text not null,
  entity_id text not null,
  payload jsonb not null,
  backed_up_at timestamptz not null default clock_timestamp(),
  primary key(repair_key,entity,entity_id)
);
alter table spektra_private.storage_repair_backup enable row level security;
revoke all on spektra_private.storage_repair_backup from public, anon, authenticated;

lock table public.quotes, public.quote_items in share row exclusive mode;
insert into spektra_private.storage_repair_backup(repair_key,entity,entity_id,payload)
select 'atomic-storage-v1','quotes',id::text,to_jsonb(q) from public.quotes q
union all select 'atomic-storage-v1','quote_items',id::text,to_jsonb(i) from public.quote_items i
union all select 'atomic-storage-v1','customers',id::text,to_jsonb(c) from public.customers c
union all select 'atomic-storage-v1','quote_number_counters',year_no::text,to_jsonb(n) from public.quote_number_counters n
union all select 'atomic-storage-v1','app_users',user_id::text,to_jsonb(u) from public.app_users u
on conflict do nothing;
insert into spektra_private.storage_repair_backup(repair_key,entity,entity_id,payload)
select 'atomic-storage-v1','function',p.oid::regprocedure::text,jsonb_build_object('sql',pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('handle_new_user','next_quote_no')
on conflict do nothing;

alter table public.quotes add column if not exists sync_version bigint not null default 1;
alter table public.quotes add column if not exists customer_snapshot jsonb not null default '{}'::jsonb;
alter table public.quotes add column if not exists issued_on date;
alter table public.quotes add column if not exists valid_until date;
update public.quotes q set customer_snapshot=jsonb_build_object(
  'name',coalesce(c.name,'Bez mena'),'phone',coalesce(c.phone,''),'email',coalesce(c.email,''),
  'address',coalesce(c.address,''),'note',coalesce(c.notes,''))
from public.customers c where c.id=q.customer_id and q.customer_snapshot='{}'::jsonb;
update public.quotes set issued_on=(created_at at time zone 'Europe/Bratislava')::date,
  valid_until=(created_at at time zone 'Europe/Bratislava')::date+14 where issued_on is null;
create unique index if not exists quotes_local_id_unique on public.quotes(local_id) where local_id is not null;

-- Remove only completely identical duplicates at the SAME position, and only
-- when keeping one copy restores the already stored total. Otherwise abort.
do $$
declare q record; calculated numeric; conflicts integer;
begin
  for q in select distinct h.id,h.subtotal_ex_vat,h.status from public.quotes h
    join public.quote_items i on i.quote_id=h.id
    where exists(select 1 from public.quote_items d where d.quote_id=i.quote_id and d.sort_order=i.sort_order and d.id<>i.id)
  loop
    if q.status='approved' then raise exception 'Manual review required: duplicate rows in approved quote'; end if;
    select count(*) into conflicts from (
      select sort_order from public.quote_items where quote_id=q.id group by sort_order
      having count(distinct(to_jsonb(quote_items)-'id'))>1
    ) x;
    if conflicts>0 then raise exception 'Manual review required: non-identical duplicate positions'; end if;
    select sum(qty*sell_price_ex_vat) into calculated from (
      select distinct on(sort_order) qty,sell_price_ex_vat from public.quote_items
      where quote_id=q.id order by sort_order,id
    ) x;
    if calculated is null or abs(round(calculated,2)-q.subtotal_ex_vat)>0.01 then
      raise exception 'Manual review required: deduplication does not restore stored total';
    end if;
    delete from public.quote_items where id in (
      select id from (select id,row_number()over(partition by sort_order order by id) n
        from public.quote_items where quote_id=q.id) x where n>1
    );
    update public.quotes set sync_version=sync_version+1,updated_at=clock_timestamp() where id=q.id;
  end loop;
end $$;
create unique index if not exists quote_items_position_unique on public.quote_items(quote_id,sort_order);

create table if not exists spektra_private.quote_save_requests (
  user_id uuid not null,
  request_id uuid not null,
  payload_hash text not null,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id)
);
alter table spektra_private.quote_save_requests enable row level security;
revoke all on spektra_private.quote_save_requests from public, anon, authenticated;

-- Keep privileged implementation out of the exposed API schema.
create or replace function spektra_private.next_quote_no()
returns text language plpgsql security definer set search_path='' as $$
declare y integer:=extract(year from now() at time zone 'Europe/Bratislava')::integer; n integer;
begin
  if not exists(select 1 from public.app_users where user_id=(select auth.uid()) and active) then
    raise exception using errcode='42501',message='Aktívny účet je potrebný na pridelenie čísla ponuky.';
  end if;
  insert into public.quote_number_counters(year_no,last_no) values(y,1)
  on conflict(year_no) do update set last_no=public.quote_number_counters.last_no+1 returning last_no into n;
  return right(y::text,2)||'NA'||lpad(n::text,greatest(4,length(n::text)),'0');
end $$;
revoke all on function spektra_private.next_quote_no() from public,anon,authenticated;
grant execute on function spektra_private.next_quote_no() to authenticated;
create or replace function public.next_quote_no()
returns text language sql security invoker set search_path='' as $$select spektra_private.next_quote_no()$$;
revoke all on function public.next_quote_no() from public,anon,authenticated;
grant execute on function public.next_quote_no() to authenticated;
alter table public.quote_number_counters enable row level security;
revoke all on public.quote_number_counters from public,anon,authenticated;

-- Existing team members are unchanged. Newly registered identities wait for
-- an administrator; editable user_metadata never grants authorization.
alter table public.app_users alter column active set default false;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.app_users(user_id,display_name,role,active)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),'sales',false)
  on conflict(user_id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function spektra_private.guard_quote()
returns trigger language plpgsql security invoker set search_path='' as $$
declare mutable_workflow text[]:=array['pdf_template','pdf_banner_mode','pdf_banner_url','pdf_banner_path',
 'pdf_images_enabled','pdf_images_user_disabled','pdf_images','warranty_consent',
 'pohoda_offer_exported_at','pohoda_offer_export_file'];
begin
  if tg_op='DELETE' then
    if old.status='approved' then raise exception using errcode='55000',message='Schválenú ponuku nemožno vymazať.'; end if;
    return old;
  end if;
  if old.status='approved' and (
    (to_jsonb(new)-array['updated_at','updated_by','sync_version','workflow']) is distinct from
    (to_jsonb(old)-array['updated_at','updated_by','sync_version','workflow']) or
    (new.workflow-mutable_workflow) is distinct from (old.workflow-mutable_workflow)
  ) then raise exception using errcode='55000',message='Schválená ponuka je uzamknutá. Vytvorte nový koncept.'; end if;
  new.sync_version:=old.sync_version+1;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function spektra_private.guard_quote() from public,anon,authenticated;
drop trigger if exists quote_storage_guard on public.quotes;
create trigger quote_storage_guard before update or delete on public.quotes for each row execute function spektra_private.guard_quote();
create or replace function spektra_private.guard_quote_item()
returns trigger language plpgsql security invoker set search_path='' as $$
declare locked boolean;
begin
  select exists(select 1 from public.quotes q where q.status='approved' and
    ((tg_op<>'INSERT' and q.id=old.quote_id) or (tg_op<>'DELETE' and q.id=new.quote_id))) into locked;
  if locked then raise exception using errcode='55000',message='Položky schválenej ponuky sú uzamknuté.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function spektra_private.guard_quote_item() from public,anon,authenticated;
drop trigger if exists quote_item_storage_guard on public.quote_items;
create trigger quote_item_storage_guard before insert or update or delete on public.quote_items for each row execute function spektra_private.guard_quote_item();

notify pgrst,'reload schema';
