/* An optional calendar date belongs to this job, not to the shared contact.
 * Keep it as YYYY-MM-DD: parsing it as a timestamp would shift dates by timezone. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SpektraRealizationDate=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function normalize(value){
    if(typeof value!=='string')return '';
    const iso=value.trim(),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if(!match)return '';
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    if(year<1||month<1||month>12)return '';
    const leap=year%4===0&&(year%100!==0||year%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    return day>=1&&day<=days[month-1]?iso:'';
  }
  function format(value){
    const date=normalize(value);
    if(!date)return '';
    const [year,month,day]=date.split('-');
    return Number(day)+'. '+Number(month)+'. '+year;
  }
  function get(record){return normalize(record?.estimated_realization_date);}
  return {normalize,format,get};
});
