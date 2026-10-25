-- Prevent repeated quotes, inspections and revisions from creating another
-- customer card. Matching is deliberately conservative: the normalized name
-- must match and so must a useful phone/e-mail. Address is only a fallback
-- when neither record has phone/e-mail.
create or replace function spektra_private.contact_fold(value text)
returns text language sql immutable parallel safe set search_path='' as $$
  select regexp_replace(
    translate(lower(btrim(coalesce(value,''))),
      'áäčďéíĺľňóôŕšťúýž',
      'aacdeeillnoorrstuyz'),
    '[^a-z0-9]+','','g')
$$;

create or replace function spektra_private.contact_phone(value text)
returns text language sql immutable parallel safe set search_path='' as $$
  select case
    when length(regexp_replace(coalesce(value,''),'\D','','g')) >= 9
      then right(regexp_replace(coalesce(value,''),'\D','','g'),9)
    else regexp_replace(coalesce(value,''),'\D','','g')
  end
$$;

create or replace function spektra_private.resolve_customer(
  payload jsonb, requested_id uuid, actor uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  result uuid;
  contact_name text:=nullif(btrim(payload->>'name'),'');
  name_key text:=spektra_private.contact_fold(payload->>'name');
  phone_key text:=spektra_private.contact_phone(payload->>'phone');
  email_key text:=lower(btrim(coalesce(payload->>'email','')));
  address_key text:=spektra_private.contact_fold(payload->>'address');
begin
  if contact_name is null then
    raise exception using errcode='22023',message='Chýba meno alebo názov zákazníka.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'customer:'||name_key||':'||coalesce(nullif(phone_key,''),nullif(email_key,''),address_key),0));

  if requested_id is not null then
    select id into result from public.customers where id=requested_id for update;
  end if;
  if result is null then
    select id into result
    from public.customers c
    where not c.archived
      and spektra_private.contact_fold(coalesce(c.name,c.company))=name_key
      and (
        (length(phone_key)>=7 and spektra_private.contact_phone(c.phone)=phone_key)
        or (position('@' in email_key)>1 and lower(btrim(coalesce(c.email,'')))=email_key)
        or (phone_key='' and email_key='' and spektra_private.contact_phone(c.phone)=''
            and lower(btrim(coalesce(c.email,'')))='' and address_key<>''
            and spektra_private.contact_fold(c.address)=address_key)
      )
    order by c.created_at,c.id limit 1 for update;
  end if;

  if result is null then
    insert into public.customers(name,phone,email,address,notes,created_by,updated_by,source_app)
    values(contact_name,nullif(btrim(payload->>'phone'),''),nullif(lower(btrim(payload->>'email')),''),
      nullif(btrim(payload->>'address'),''),nullif(btrim(coalesce(payload->>'note',payload->>'notes')),''),
      actor,actor,coalesce(nullif(payload->>'source_app',''),'ponuky'))
    returning id into result;
  else
    update public.customers set
      name=contact_name,
      phone=coalesce(nullif(btrim(payload->>'phone'),''),phone),
      email=coalesce(nullif(lower(btrim(payload->>'email')),''),email),
      address=coalesce(nullif(btrim(payload->>'address'),''),address),
      notes=coalesce(nullif(btrim(coalesce(payload->>'note',payload->>'notes')),''),notes),
      archived=false,updated_by=actor,updated_at=clock_timestamp()
    where id=result;
  end if;
  return result;
end $$;

-- Merge only high-confidence duplicates and retain every quote/inspection.
create table if not exists spektra_private.customers_before_20261025_dedup as
select * from public.customers;
revoke all on spektra_private.customers_before_20261025_dedup from public,anon,authenticated;

do $$
declare canonical public.customers%rowtype; duplicate public.customers%rowtype;
begin
  for duplicate in select * from public.customers order by created_at,id loop
    select * into canonical from public.customers c
    where c.id<>duplicate.id and c.created_at<=duplicate.created_at
      and spektra_private.contact_fold(coalesce(c.name,c.company))=
          spektra_private.contact_fold(coalesce(duplicate.name,duplicate.company))
      and (
        (length(spektra_private.contact_phone(duplicate.phone))>=7
          and spektra_private.contact_phone(c.phone)=spektra_private.contact_phone(duplicate.phone))
        or (position('@' in lower(btrim(coalesce(duplicate.email,''))))>1
          and lower(btrim(coalesce(c.email,'')))=lower(btrim(duplicate.email)))
        or (spektra_private.contact_phone(duplicate.phone)='' and lower(btrim(coalesce(duplicate.email,'')))=''
          and spektra_private.contact_phone(c.phone)='' and lower(btrim(coalesce(c.email,'')))=''
          and spektra_private.contact_fold(duplicate.address)<>''
          and spektra_private.contact_fold(c.address)=spektra_private.contact_fold(duplicate.address))
      )
    order by c.created_at,c.id limit 1;
    if canonical.id is not null then
      update public.quotes set customer_id=canonical.id where customer_id=duplicate.id;
      update public.inspections set customer_id=canonical.id where customer_id=duplicate.id;
      update public.customers set
        phone=coalesce(phone,duplicate.phone),email=coalesce(email,duplicate.email),
        address=coalesce(address,duplicate.address),notes=coalesce(notes,duplicate.notes),
        company=coalesce(company,duplicate.company),ico=coalesce(ico,duplicate.ico),
        dic=coalesce(dic,duplicate.dic),ic_dph=coalesce(ic_dph,duplicate.ic_dph),
        updated_at=greatest(updated_at,duplicate.updated_at)
      where id=canonical.id;
      delete from public.customers where id=duplicate.id;
    end if;
  end loop;
end $$;

-- Patch the already deployed atomic quote function without duplicating its
-- large, audited body. Customer resolution remains inside its transaction.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('spektra_private.save_quote_atomic(jsonb,jsonb,bigint,uuid)'::regprocedure);
  definition:=replace(definition,
    $old$customer:=coalesce(oldq.customer_id,nullif(p_quote->>'customer_id','')::uuid);$old$,
    $new$customer:=spektra_private.resolve_customer(newq.customer_snapshot,
      coalesce(oldq.customer_id,nullif(p_quote->>'customer_id','')::uuid),uid);$new$);
  if position('spektra_private.resolve_customer' in definition)=0 then
    raise exception 'save_quote_atomic customer block was not found';
  end if;
  execute definition;
end $$;

create or replace function public.resolve_customer(payload jsonb, requested_id uuid default null)
returns uuid language sql security invoker set search_path='' as $$
  select spektra_private.resolve_customer(payload,requested_id,auth.uid())
$$;
revoke all on function public.resolve_customer(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.resolve_customer(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
