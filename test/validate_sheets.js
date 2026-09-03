// Enum allowlists taken from the Sheets API v4 reference. A mock that echoes
// 200 will happily accept an invalid enum; this is what catches it.
const OK = {
  condition: ['NUMBER_GREATER','NUMBER_GREATER_THAN_EQ','NUMBER_LESS','NUMBER_LESS_THAN_EQ',
              'NUMBER_EQ','NUMBER_NOT_EQ','NUMBER_BETWEEN','NUMBER_NOT_BETWEEN',
              'TEXT_CONTAINS','TEXT_NOT_CONTAINS','TEXT_STARTS_WITH','TEXT_ENDS_WITH','TEXT_EQ',
              'BLANK','NOT_BLANK','CUSTOM_FORMULA','BOOLEAN'],
  dimension: ['ROWS','COLUMNS'],
  hAlign: ['LEFT','CENTER','RIGHT'],
  vAlign: ['TOP','MIDDLE','BOTTOM'],
  wrap: ['OVERFLOW_CELL','LEGACY_WRAP','CLIP','WRAP'],
  numberFormat: ['TEXT','NUMBER','PERCENT','CURRENCY','DATE','TIME','DATE_TIME','SCIENTIFIC'],
  mergeType: ['MERGE_ALL','MERGE_COLUMNS','MERGE_ROWS'],
  request: ['repeatCell','updateSheetProperties','updateDimensionProperties','addConditionalFormatRule',
            'mergeCells','addBanding','setBasicFilter','updateCells','updateBorders']
};
const errs = [];
function walk(node, path){
  if(!node || typeof node !== 'object') return;
  if(Array.isArray(node)) return node.forEach((n,i)=>walk(n, path+'['+i+']'));
  for(const [k,v] of Object.entries(node)){
    const p = path + '.' + k;
    if(k === 'condition' && v && v.type && !OK.condition.includes(v.type)) errs.push(p+'.type = '+v.type);
    if(k === 'dimension' && typeof v === 'string' && !OK.dimension.includes(v)) errs.push(p+' = '+v);
    if(k === 'horizontalAlignment' && !OK.hAlign.includes(v)) errs.push(p+' = '+v);
    if(k === 'verticalAlignment' && !OK.vAlign.includes(v)) errs.push(p+' = '+v);
    if(k === 'wrapStrategy' && !OK.wrap.includes(v)) errs.push(p+' = '+v);
    if(k === 'numberFormat' && v && v.type && !OK.numberFormat.includes(v.type)) errs.push(p+'.type = '+v.type);
    if(k === 'mergeType' && !OK.mergeType.includes(v)) errs.push(p+' = '+v);
    if(k === 'fields' && typeof v !== 'string') errs.push(p+' must be a string');
    if((k === 'red'||k==='green'||k==='blue') && (typeof v !== 'number' || v < 0 || v > 1)) errs.push(p+' = '+v+' (must be 0..1)');
    walk(v, p);
  }
}
const calls = JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
let nReq = 0, kinds = {};
calls.forEach((c, ci) => {
  walk(c.body, 'call'+ci);
  if(c.body && c.body.requests){
    c.body.requests.forEach((r, ri) => {
      nReq++;
      const kind = Object.keys(r)[0];
      kinds[kind] = (kinds[kind]||0)+1;
      if(!OK.request.includes(kind)) errs.push('call'+ci+'.requests['+ri+'] unknown kind: '+kind);
      if(r.repeatCell && !r.repeatCell.fields) errs.push('call'+ci+'.requests['+ri+'] repeatCell missing fields');
    });
  }
});
// every conditional rule range must be inside the sheet's declared grid
const grids = {};
(calls[0].body.sheets||[]).forEach(s => { grids[s.properties.sheetId] = s.properties.gridProperties; });
calls.forEach(c => (c.body.requests||[]).forEach((r, ri) => {
  const rule = r.addConditionalFormatRule && r.addConditionalFormatRule.rule;
  if(!rule) return;
  rule.ranges.forEach(rg => {
    const g = grids[rg.sheetId];
    if(!g) return errs.push('rule range on unknown sheetId '+rg.sheetId);
    if(rg.endRowIndex > g.rowCount) errs.push('rule endRowIndex '+rg.endRowIndex+' > rowCount '+g.rowCount+' on sheet '+rg.sheetId);
    if(rg.endColumnIndex > g.columnCount) errs.push('rule endColumnIndex '+rg.endColumnIndex+' > columnCount '+g.columnCount+' on sheet '+rg.sheetId);
    if(rg.endRowIndex <= rg.startRowIndex) errs.push('empty rule range on sheet '+rg.sheetId);
  });
}));
console.log('requests checked:', nReq);
console.log('kinds:', JSON.stringify(kinds));
if(errs.length){ console.log('\nFAILURES (' + errs.length + '):'); errs.slice(0,25).forEach(e=>console.log('  ', e)); process.exit(1); }
console.log('\nALL SHEETS API VALUES VALID');
