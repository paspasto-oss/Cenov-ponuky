create or replace function spektra_private.save_quote_atomic(
 p_quote jsonb,p_items jsonb,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); oldq public.quotes%rowtype; newq public.quotes%rowtype;
 item public.quote_items%rowtype; raw jsonb; normalized jsonb:='[]'; saved_items jsonb;
 pos integer:=0; local_key text:=nullif(btrim(p_quote->>'local_id'),'');
 request_hash text:=md5(jsonb_build_object('quote',p_quote,'items',p_items,'version',p_expected_version)::text);
 previous spektra_private.quote_save_requests%rowtype;
 net_unrounded numeric:=0; complete boolean:=true; customer uuid; result jsonb;
 allowed_workflow text[]:=array['pdf_template','pdf_banner_mode','pdf_banner_url','pdf_banner_path',
 'pdf_images_enabled','pdf_images_user_disabled','pdf_images','warranty_consent',
 'pohoda_offer_exported_at','pohoda_offer_export_file'];
begin
 if uid is null or not exists(select 1 from public.app_users where user_id=uid and active) then
   raise exception using errcode='42501',message='Účet nemá povolený prístup k ponukám.';
 end if;
 if p_request_id is null or local_key is null or length(local_key)>200 or
    jsonb_typeof(p_quote) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then
   raise exception using errcode='22023',message='Chýba identifikátor alebo položky ponuky.';
 end if;
 if jsonb_array_length(p_items)>2000 then raise exception using errcode='22023',message='Príliš veľa položiek.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('quote-request:'||uid::text||':'||p_request_id::text,0));
 select * into previous from spektra_private.quote_save_requests where user_id=uid and request_id=p_request_id;
 if found then
   if previous.payload_hash<>request_hash then raise exception using errcode='22023',message='Identifikátor opakovaného uloženia má iný obsah.'; end if;
   return previous.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('quote-local:'||local_key,0));
 if nullif(p_quote->>'id','') is not null then
   select * into oldq from public.quotes where id=(p_quote->>'id')::uuid for update;
   if not found or coalesce(oldq.local_id,'remote_'||oldq.id::text) is distinct from local_key then
     raise exception using errcode='40001',message='Ponuka už nie je dostupná alebo má iný identifikátor. Synchronizujte údaje.';
   end if;
 else
   select * into oldq from public.quotes where local_id=local_key for update;
 end if;
 if oldq.id is not null and (p_expected_version is null or oldq.sync_version<>p_expected_version) then
   raise exception using errcode='40001',message='Ponuka bola zmenená na inom zariadení. Miestne zmeny zostávajú zachované; najprv vyriešte konflikt.';
 end if;
 if oldq.id is null and p_expected_version is not null then
   raise exception using errcode='40001',message='Pôvodná ponuka sa nenašla. Miestne zmeny zostávajú zachované.';
 end if;

 if oldq.status='approved' and coalesce((p_quote->>'metadata_only')::boolean,false) then
   if p_quote->>'status' is distinct from 'approved' then
     raise exception using errcode='55000',message='Schválenú ponuku nemožno vrátiť do konceptu.';
   end if;
   select oldq.workflow||coalesce(jsonb_object_agg(key,value),'{}') into raw
     from jsonb_each(coalesce(p_quote->'workflow','{}')) where key=any(allowed_workflow);
   update public.quotes set workflow=raw,updated_by=uid where id=oldq.id returning * into newq;
   result:=jsonb_build_object('remote_id',newq.id,'remote_customer_id',newq.customer_id,'quote_no',newq.quote_no,
     'server_quote_no',true,'status',newq.status,'sync_version',newq.sync_version,'updated_at',newq.updated_at,
     'net',newq.subtotal_ex_vat,'vat_pct',newq.vat_pct,'total',newq.total_inc_vat,'price_complete',newq.price_complete,
     'customer_snapshot',newq.customer_snapshot,'issued_on',newq.issued_on,'valid_until',newq.valid_until);
   insert into spektra_private.quote_save_requests(user_id,request_id,payload_hash,quote_id,result)
     values(uid,p_request_id,request_hash,newq.id,result);
   return result;
 end if;

 -- Strong typed normalization is also used when comparing an approved item list.
 for raw in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(raw) is distinct from 'object' then raise exception using errcode='22023',message='Neplatná položka.'; end if;
   item:=jsonb_populate_record(null::public.quote_items,raw);
   item.sort_order:=pos; item.qty:=coalesce(item.qty,1); item.unit:=coalesce(nullif(item.unit,''),'ks');
   item.visible_to_customer:=coalesce(item.visible_to_customer,false); item.metadata:=coalesce(item.metadata,'{}');
   if nullif(btrim(item.name),'') is null or not(item.qty>=0 and item.qty<100000000000) or
     (item.sell_price_ex_vat is not null and not(item.sell_price_ex_vat>=0 and item.sell_price_ex_vat<100000000)) or
     (item.purchase_price_ex_vat is not null and not(item.purchase_price_ex_vat>=0 and item.purchase_price_ex_vat<100000000)) or
     jsonb_typeof(item.metadata)<>'object' then
     raise exception using errcode='22023',message='Položka musí mať názov, nezáporné množstvo a platnú cenu.';
   end if;
   normalized:=normalized||jsonb_build_array(to_jsonb(item)-array['id','quote_id']);
   if item.sell_price_ex_vat is null then complete:=false; else net_unrounded:=net_unrounded+item.qty*item.sell_price_ex_vat; end if;
   pos:=pos+1;
 end loop;
 complete:=complete and pos>0;
 newq:=jsonb_populate_record(oldq,jsonb_build_object(
   'status',coalesce(p_quote->>'status','draft'),'category',p_quote->>'category','brand',p_quote->>'brand',
   'system_type',p_quote->>'system_type','installation_tier',coalesce(p_quote->>'installation_tier','standard'),
   'building',coalesce(p_quote->'building','{}'),'device',coalesce(p_quote->'device','{}'),
   'optional_services',coalesce(p_quote->'optional_services','{}'),'subsidy',coalesce(p_quote->'subsidy','{}'),
   'workflow',coalesce(p_quote->'workflow','{}'),'vat_pct',coalesce((p_quote->>'vat_pct')::numeric,23),
   'customer_snapshot',p_quote->'customer'));
 if jsonb_typeof(newq.customer_snapshot) is distinct from 'object' or
    nullif(btrim(newq.customer_snapshot->>'name'),'') is null or
    not(newq.vat_pct>=0 and newq.vat_pct<=100) then
   raise exception using errcode='22023',message='Vyplňte zákazníka a platnú sadzbu DPH.';
 end if;
 newq.customer_snapshot:=jsonb_build_object('name',newq.customer_snapshot->>'name',
   'phone',coalesce(newq.customer_snapshot->>'phone',''),'email',coalesce(newq.customer_snapshot->>'email',''),
   'address',coalesce(newq.customer_snapshot->>'address',''),'note',coalesce(newq.customer_snapshot->>'note',''));
 if oldq.status='approved' then
   select coalesce(jsonb_agg(to_jsonb(i)-array['id','quote_id'] order by sort_order),'[]') into saved_items
     from public.quote_items i where quote_id=oldq.id;
   if normalized is distinct from saved_items or
      (to_jsonb(newq)-array['workflow']) is distinct from (to_jsonb(oldq)-array['workflow']) or
      (newq.workflow-allowed_workflow) is distinct from (oldq.workflow-allowed_workflow) then
     raise exception using errcode='55000',message='Schválené ceny, položky a zákaznícke údaje nemožno meniť.';
   end if;
   update public.quotes set workflow=newq.workflow,updated_by=uid where id=oldq.id returning * into newq;
 else
   if newq.status='approved' and not complete then
     raise exception using errcode='22023',message='Schváliť možno iba ponuku s kompletnými cenami.';
   end if;
   customer:=oldq.customer_id;
   if customer is null then
     insert into public.customers(name,phone,email,address,notes,created_by)
     values(newq.customer_snapshot->>'name',nullif(newq.customer_snapshot->>'phone',''),nullif(newq.customer_snapshot->>'email',''),
       nullif(newq.customer_snapshot->>'address',''),nullif(newq.customer_snapshot->>'note',''),uid) returning id into customer;
   else
     -- Customer updates are inside the same transaction, AFTER the version check.
     update public.customers set name=newq.customer_snapshot->>'name',phone=nullif(newq.customer_snapshot->>'phone',''),
       email=nullif(newq.customer_snapshot->>'email',''),address=nullif(newq.customer_snapshot->>'address',''),
       notes=nullif(newq.customer_snapshot->>'note',''),updated_at=clock_timestamp() where id=customer;
   end if;
   newq.subtotal_ex_vat:=round(net_unrounded,2);
   newq.total_inc_vat:=round(newq.subtotal_ex_vat*(1+newq.vat_pct/100),2);
   newq.price_complete:=complete;
   if oldq.id is null then
     newq.id:=gen_random_uuid();newq.quote_no:=spektra_private.next_quote_no();
     newq.issued_on:=(now() at time zone 'Europe/Bratislava')::date;newq.valid_until:=newq.issued_on+14;
     -- Keep draft state until all children are written; approval guard remains active.
     insert into public.quotes(id,local_id,quote_no,customer_id,status,category,brand,system_type,installation_tier,
       building,device,optional_services,subsidy,workflow,subtotal_ex_vat,vat_pct,total_inc_vat,price_complete,
       created_by,updated_by,customer_snapshot,issued_on,valid_until)
     values(newq.id,local_key,newq.quote_no,customer,'draft',newq.category,newq.brand,newq.system_type,newq.installation_tier,
       newq.building,newq.device,newq.optional_services,newq.subsidy,newq.workflow,newq.subtotal_ex_vat,newq.vat_pct,
       newq.total_inc_vat,newq.price_complete,uid,uid,newq.customer_snapshot,newq.issued_on,newq.valid_until);
   else
     newq.id:=oldq.id;
     delete from public.quote_items where quote_id=newq.id;
   end if;
   insert into public.quote_items(quote_id,sort_order,role,pohoda_stock_id,pohoda_code,name,qty,unit,purchase_price_ex_vat,
     sell_price_ex_vat,mapping_status,visible_to_customer,customer_group,metadata)
   select newq.id,x.sort_order,x.role,x.pohoda_stock_id,x.pohoda_code,x.name,x.qty,x.unit,x.purchase_price_ex_vat,
     x.sell_price_ex_vat,x.mapping_status,x.visible_to_customer,x.customer_group,x.metadata
   from jsonb_populate_recordset(null::public.quote_items,normalized) x;
   update public.quotes set customer_id=customer,status=newq.status,category=newq.category,brand=newq.brand,
     system_type=newq.system_type,installation_tier=newq.installation_tier,building=newq.building,device=newq.device,
     optional_services=newq.optional_services,subsidy=newq.subsidy,workflow=newq.workflow,
     subtotal_ex_vat=newq.subtotal_ex_vat,vat_pct=newq.vat_pct,total_inc_vat=newq.total_inc_vat,
     price_complete=newq.price_complete,updated_by=uid,customer_snapshot=newq.customer_snapshot
   where id=newq.id returning * into newq;
 end if;
 result:=jsonb_build_object('remote_id',newq.id,'remote_customer_id',newq.customer_id,'quote_no',newq.quote_no,
   'server_quote_no',true,'status',newq.status,'sync_version',newq.sync_version,'updated_at',newq.updated_at,
   'net',newq.subtotal_ex_vat,'vat_pct',newq.vat_pct,'total',newq.total_inc_vat,'price_complete',newq.price_complete,
   'customer_snapshot',newq.customer_snapshot,'issued_on',newq.issued_on,'valid_until',newq.valid_until);
 insert into spektra_private.quote_save_requests(user_id,request_id,payload_hash,quote_id,result)
 values(uid,p_request_id,request_hash,newq.id,result);
 return result;
end $$;
revoke all on function spektra_private.save_quote_atomic(jsonb,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function spektra_private.save_quote_atomic(jsonb,jsonb,bigint,uuid) to authenticated;
create or replace function public.save_quote_atomic(p_quote jsonb,p_items jsonb,p_expected_version bigint,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select spektra_private.save_quote_atomic(p_quote,p_items,p_expected_version,p_request_id)
$$;
revoke all on function public.save_quote_atomic(jsonb,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.save_quote_atomic(jsonb,jsonb,bigint,uuid) to authenticated;
-- Cutover revokes direct quote/line writes in a second migration, after the
-- versioned frontend is deployed. Read policies remain in place.
notify pgrst,'reload schema';
