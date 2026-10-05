-- Final deployment step after the atomic-storage client is live.
-- Apply through Supabase apply_migration as atomic_quote_storage_cutover.
-- Old browser tabs must reload; never restore direct quote-item writes.

-- Reuse the existing inspection customer inside the same save transaction.
do $$
declare definition text;
begin
  select pg_get_functiondef('spektra_private.save_quote_atomic(jsonb,jsonb,bigint,uuid)'::regprocedure) into definition;
  if strpos(definition,'customer:=oldq.customer_id;')=0 then
    raise exception 'Unexpected RPC definition: customer patch requires review';
  end if;
  definition:=replace(definition,'customer:=oldq.customer_id;',
    'customer:=coalesce(oldq.customer_id,nullif(p_quote->>''customer_id'','''')::uuid);');
  execute definition;
end $$;

-- Writes are exclusively through the active-member checked, transactional RPC.
revoke all on public.quotes,public.quote_items from public,anon,authenticated;
grant select on public.quotes,public.quote_items to authenticated;
drop policy if exists "active users write quotes" on public.quotes;
drop policy if exists "active users write quote items" on public.quote_items;

-- Pending/inactive accounts must not alter shared PDF image objects.
drop policy if exists "quote images insert authenticated" on storage.objects;
drop policy if exists "quote images update authenticated" on storage.objects;
drop policy if exists "quote images delete authenticated" on storage.objects;
create policy "active users insert quote images" on storage.objects for insert to authenticated
with check(bucket_id='quote-images' and exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));
create policy "active users update quote images" on storage.objects for update to authenticated
using(bucket_id='quote-images' and exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active))
with check(bucket_id='quote-images' and exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));
create policy "active users delete quote images" on storage.objects for delete to authenticated
using(bucket_id='quote-images' and exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));
create policy "active users select quote image objects" on storage.objects for select to authenticated
using(bucket_id='quote-images' and exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active));

notify pgrst,'reload schema';
