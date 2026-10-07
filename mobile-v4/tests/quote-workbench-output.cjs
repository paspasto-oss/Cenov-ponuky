const {test}=require('node:test');
const assert=require('node:assert/strict');
const rows=require('../js/quote-row-output.js');
const output=require('../js/quote-workbench-output.js');

const item=(name,patch={})=>({role:'quote_material',name,qty:1,unit:'ks',price:10,cost:777.1234,note:'NEVER_CUSTOMER_INTERNAL_NOTE',...patch});
function fixture(){
  const q={quote_no:'26NA0042',vat_pct:23,customer:{name:'Zákazník <script>',address:'Rajec'},internal_note:'PRIVATE_QUOTE_NOTE',
    material_edits:{rows_mode:true,assemblies:{version:1,groups:[],output:{material:'summary',labor:'summary',appendix:false}}},
    items:[
      item('Tepelné čerpadlo',{role:'device',price:4500,kind:'equipment',pohoda_code:'HP01'}),
      item('Rúrka <A>',{qty:2.5,unit:'m',price:8,kind:'material',pohoda_code:'000A'}),
      item('Ventil & koleno',{qty:2,price:15,kind:'material',pohoda_code:'000B'}),
      item('Montáž dohodnutá',{role:'installation',price:900,kind:'labor',work_scope:['Zameranie <otvor>','Vŕtanie','Osadenie','Montáž','Skúška zariadenia']}),
      item('Doprava',{role:'quote_manual_service',price:60,kind:'transport'}),
      item('Tlaková skúška a protokol',{role:'quote_manual_service',price:90,kind:'service'}),
      item('Prvý riadok\nDruhý <script>alert(1)</script>',{role:'quote_text',kind:'text',price:0})
    ]};
  const specs=[['device','Zariadenie','equipment','computed',[0]],['material','Montážny materiál','material','computed',[1,2]],['labor','Montáž','labor','fixed',[3]],['trip','Doprava','transport','computed',[4]],['test','Skúšky','service','computed',[5]],['text','Poznámky','text','computed',[6]]];
  q.material_edits.assemblies.groups=specs.map(([id,name,kind,pricing,indices])=>({id,name,kind,pricing,indices}));
  return q;
}
const assemblies={
  isText:i=>i.role==='quote_text',
  groups:q=>q.material_edits.assemblies.groups.map(g=>({...g,row_indices:g.indices,rows:g.indices.map(index=>q.items[index]),net:g.indices.reduce((sum,index)=>sum+(q.items[index].price==null?NaN:q.items[index].qty*q.items[index].price),0)}))
};
const options={assemblies,formatMoney:n=>n==null?'—':Number(n).toFixed(2)+' €'};
const sumBill=q=>q.items.reduce((sum,item)=>sum+(rows.amounts(item,q).amount||0),0);

test('all 18 independent detail/appendix combinations preserve every billed euro and the quote snapshot',()=>{
  for(const material of ['summary','contents','detail'])for(const labor of ['summary','contents','detail'])for(const appendix of [false,true]){
    const q=fixture();q.material_edits.assemblies.output={material,labor,appendix};
    const before=JSON.stringify(q),model=rows.customerModel(q,options);
    assert.equal(model.rows.reduce((sum,item)=>sum+(rows.amounts(item,q).amount||0),0),sumBill(q),JSON.stringify({material,labor,appendix}));
    assert.equal(model.appendixRows.reduce((sum,item)=>sum+(rows.amounts(item,q).amount||0),0),0,'Appendix is not additional billing.');
    assert.equal(model.totals.net,5600);assert.equal(model.totals.total,6888);
    assert.equal(model.appendixRows.length>0,appendix&&(material!=='summary'||labor!=='summary'));
    output.renderCustomer(q,options);assert.equal(JSON.stringify(q),before);
  }
});

test('material contents display quantity and one group price while full detail displays the actual row prices',()=>{
  const q=fixture();q.material_edits.assemblies.output.material='contents';
  const model=rows.customerModel(q,options),material=model.rows.filter(x=>x._quote_output.group_kind==='material');
  assert.deepEqual(material.filter(x=>x._quote_output.type==='contents').map(x=>[x.name,x.qty,x.unit]),[['Rúrka <A>',2.5,'m'],['Ventil & koleno',2,'ks']]);
  assert.deepEqual(material.filter(x=>x._quote_output.type==='contents').map(x=>rows.displayAmounts(x,q).amount),[null,null]);
  assert.equal(rows.amounts(material.at(-1),q).amount,50);
  let html=output.renderRows(q,{...options,model,rows:material});
  assert.doesNotMatch(html,/8\.00 €|15\.00 €|20\.00 €|30\.00 €/);assert.match(html,/50\.00 €/);
  q.material_edits.assemblies.output.material='detail';
  html=output.renderRows(q,options);assert.match(html,/8\.00 €/);assert.match(html,/20\.00 €/);assert.match(html,/15\.00 €/);
});

test('fixed labor detail preserves the negotiated parent price and uses unpriced operations',()=>{
  const q=fixture();q.items[3].price=850;q.material_edits.assemblies.output.labor='detail';
  const model=rows.customerModel(q,options),labor=model.rows.filter(x=>x._quote_output.group_kind==='labor');
  assert.equal(labor.length,6);assert.equal(labor[0].price,850);assert.equal(labor[0].name,'Montáž dohodnutá');
  for(const line of labor.slice(1)){assert.equal(line.price,null);assert.equal(rows.amounts(line,q).amount,null);}
  const html=output.renderRows(q,{...options,model,rows:labor});assert.equal((html.match(/850\.00 €/g)||[]).length,2);
  assert.match(html,/Zameranie &lt;otvor&gt;/);assert.doesNotMatch(html,/\b900\.00 €|\b0\.00 €/);
});

test('computed labor detail uses saved operation prices and does not charge the subtotal twice',()=>{
  const q=fixture();q.material_edits.assemblies.groups[2].pricing='computed';
  q.items[3].name='Zameranie';q.items[3].price=80;q.items[3].work_scope=[];
  q.items.push(item('Montáž',{role:'installation',price:820,kind:'labor'}));q.material_edits.assemblies.groups[2].indices.push(7);
  q.material_edits.assemblies.output.labor='detail';
  const lines=rows.customerModel(q,options).rows.filter(x=>x._quote_output.group_kind==='labor');
  assert.equal(lines.length,4);assert.equal(lines.reduce((sum,i)=>sum+(rows.amounts(i,q).amount||0),0),900);
  assert.equal(rows.displayAmounts(lines.at(-1),q).amount,900);assert.equal(rows.amounts(lines.at(-1),q).amount,null);
});

test('customer model and both table layouts exclude internal fields, escape all text, and preserve multiline notes',()=>{
  const q=fixture();q.material_edits.assemblies.output={material:'detail',labor:'detail',appendix:true};
  q.items[1].stored_metadata={secret:'SECRET_METADATA'};q.items[1].margin='PRIVATE_MARGIN';
  const model=rows.customerModel(q,options),json=JSON.stringify(model);
  assert.doesNotMatch(json,/NEVER_CUSTOMER|PRIVATE_|SECRET_METADATA|777\.1234|"cost"|"note"|"stored_metadata"|"margin"/);
  for(const layout of ['technical','presentation']){
    const html=output.renderCustomer(q,{...options,layout});
    assert.doesNotMatch(html,/NEVER_CUSTOMER|PRIVATE_|SECRET_METADATA|777\.1234|<script>|onerror=/);
    assert.match(html,/Zákazník &lt;script&gt;/);assert.match(html,/Rúrka &lt;A&gt;/);assert.match(html,/Ventil &amp; koleno/);
    assert.match(html,/Prvý riadok\nDruhý &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html,/data-pdf-text-row/);assert.match(html,/data-pdf-page-break-before/);
    assert.equal((html.match(/<table data-pdf-items/g)||[]).length,2);
  }
});

test('unknown prices stay unknown and zero VAT is respected for every customer view',()=>{
  const q=fixture();q.vat_pct=0;q.items[1].price=null;
  for(const detail of ['summary','contents','detail']){
    q.material_edits.assemblies.output.material=detail;
    const model=rows.customerModel(q,options);assert.equal(model.totals.net,null);assert.equal(model.totals.total,null);
    assert.ok(model.rows.some(x=>x._quote_output.group_kind==='material'&&rows.displayAmounts(x,q).amount==null));
    const device=model.rows.find(x=>x._quote_output.group_kind==='equipment');assert.equal(rows.displayAmounts(device,q).gross,4500);
  }
});

test('appendix respects separate detail settings and its rows never bill a second time',()=>{
  const q=fixture();q.material_edits.assemblies.output={material:'contents',labor:'summary',appendix:true};
  const model=rows.customerModel(q,options);
  assert.ok(model.rows.some(x=>x.name==='Montážny materiál'&&x.price===50));
  assert.ok(model.appendixRows.every(x=>x._quote_output.group_kind==='material'));
  assert.ok(model.appendixRows.every(x=>x._quote_output.billable===false));
  const html=output.renderAppendix(q,{...options,model});assert.match(html,/50\.00 €/);assert.doesNotMatch(html,/8\.00 €|15\.00 €|Montáž dohodnutá/);
});

test('purchase rows merge exact stock identities across assemblies while retaining warehouse, unit and unmapped differences',()=>{
  const q=fixture(),g=q.material_edits.assemblies.groups[1];
  q.items[1].pohoda={id:'stock-01',storage_ref:'A',code:'000A'};
  q.items.push(item('Premenovaná rúrka',{qty:4,unit:'m',pohoda:{id:'stock-01',storage_ref:'A',code:'000A'}}));g.indices.push(7);
  q.items.push(item('Iný sklad',{qty:3,unit:'m',pohoda:{id:'stock-01',storage_ref:'B',code:'000A'}}));g.indices.push(8);
  q.items.push(item('Iná jednotka',{qty:1,unit:'ks',pohoda:{id:'stock-01',storage_ref:'A',code:'000A'}}));g.indices.push(9);
  q.items.push(item('Bez kódu',{qty:2}),item('Bez kódu',{qty:3}));g.indices.push(10,11);
  const list=output.purchaseRows(q,options),pipe=list.find(x=>x.names.includes('Premenovaná rúrka'));
  assert.equal(pipe.qty,6.5);assert.equal(pipe.code,'000A');assert.deepEqual(pipe.names,['Rúrka <A>','Premenovaná rúrka']);
  assert.equal(list.filter(x=>x.code==='000A').length,3);
  assert.equal(list.filter(x=>x.name==='Bez kódu').length,2);
  assert.ok(!list.some(x=>/Montáž dohodnutá|Doprava|Tlaková skúška/.test(x.name)));
  assert.equal(list.find(x=>x.code==='HP01').qty,1);
});

test('installer document contains planned work and explicit uncompleted service status without exposing sale or purchase prices',()=>{
  const q=fixture(),before=JSON.stringify(q),model=output.installerModel(q,options);
  assert.equal(model.work.length,1);assert.equal(model.services.length,2);
  assert.ok(model.services.every(x=>x.status.includes('vykonanie sa potvrdzuje samostatne')));
  const html=output.renderInstaller(q,options);
  assert.match(html,/Tlaková skúška a protokol/);assert.match(html,/Skúška zariadenia/);assert.match(html,/PRIVATE_QUOTE_NOTE/);
  assert.doesNotMatch(html,/777\.1234|4500|4\s*500|<script>/);
  assert.equal(JSON.stringify(q),before);
});

test('unsafe image callback URLs are ignored and a legitimate image URL is attribute escaped',()=>{
  const q=fixture();
  assert.doesNotMatch(output.renderRows(q,{...options,getImage:()=> 'javascript:alert(1)'}),/<img/);
  const html=output.renderRows(q,{...options,getImage:()=> 'https://example.invalid/a.png?x="quoted"'});
  assert.match(html,/src="https:\/\/example.invalid\/a.png\?x=&quot;quoted&quot;"/);
});

test('real assembly engine integrates fixed work scope, row overrides and safe catalog references without repricing',()=>{
  const engine=require('../js/quote-assemblies.js'),q=fixture();
  delete q.material_edits.assemblies;
  q.items.forEach(item=>item.stored_metadata={quote_assembly:{kind:item.kind}});
  // Hydrated catalog objects can be stale; persisted stock identity wins.
  q.items[1].pohoda_stock_id=11;q.items[1].pohoda={id:'stale-shared-id',code:'000A'};
  q.items[2].pohoda_stock_id=22;q.items[2].pohoda={id:'stale-shared-id',code:'000B'};
  engine.init(q);engine.setOutput(q,{material:'detail',labor:'contents',appendix:true});
  const material=engine.groups(q).find(group=>group.kind==='material');
  engine.setField(q,engine.rowId(q.items[1]),'name','Ručne upravený názov');
  engine.setField(q,engine.rowId(q.items[1]),'qty',4);
  engine.setField(q,engine.rowId(q.items[1]),'price',12);
  const before=JSON.stringify(q),model=rows.customerModel(q),html=output.renderCustomer(q);
  assert.equal(model.rows.find(row=>row._quote_output.group_id===material.id).price,78);
  assert.match(html,/Ručne upravený názov/);assert.match(html,/Zameranie &lt;otvor&gt;/);
  const purchase=output.purchaseRows(q),pipe=purchase.find(row=>row.code==='000A');
  assert.equal(pipe.qty,4);assert.equal(pipe.reference.stock_id,11);assert.equal(pipe.reference.id,null);
  assert.equal(purchase.find(row=>row.code==='000B').reference.stock_id,22);
  assert.equal(JSON.stringify(q),before);
});

test('fixed material contents become the purchase list and incomplete assemblies remain visibly marked on internal outputs',()=>{
  const q=fixture(),group=q.material_edits.assemblies.groups[1];
  group.pricing='fixed';group.indices=[1];group.procurement_incomplete=true;
  group.contents=[{name:'Súčasť balíka',qty:4,unit:'ks',catalog_ref:{id:'part-1',code:'PART01'}},{name:'Práca zahrnutá',kind:'labor',qty:1,unit:'hod'}];
  const list=output.purchaseRows(q,options);
  assert.equal(list.find(item=>item.code==='PART01').qty,4);assert.ok(!list.some(item=>item.name==='Rúrka <A>'||item.name==='Práca zahrnutá'));
  assert.match(output.renderPurchase(q,options),/Súpis materiálu potrebuje doplnenie/);
  assert.match(output.renderInstaller(q,options),/Zostava nemá úplný položkový súpis/);
  assert.doesNotMatch(output.renderCustomer(q,options),/Súpis materiálu potrebuje doplnenie/);
});

test('canonical totals match atomic-save rounding for fractional prices and quantities without changing saved fields',()=>{
  for(const [qty,price,net,total] of [[3,0.3333,1,1.23],[1,1.005,1.01,1.24],[2.555,19.9999,51.1,62.85]]){
    const q={vat_pct:23,net:-1,total:-1,items:[item('Presná cena',{qty,price})]},before=JSON.stringify(q);
    const totals=rows.canonicalTotals(q);assert.equal(totals.net,net);assert.equal(totals.total,total);assert.equal(JSON.stringify(q),before);
  }
  assert.equal(rows.canonicalTotals({items:[]}).complete,false);
});
