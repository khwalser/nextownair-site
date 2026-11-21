import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../netlify/functions/flights.mjs',import.meta.url),'utf8');
const start=source.indexOf('function validDate(');
const end=source.indexOf('function parseIsoDuration(',start);
assert(start>=0&&end>start,'Flight API validation functions are present');
const context={Date,Number,String};
vm.createContext(context);
vm.runInContext(source.slice(start,end)+'\nthis.validDate=validDate;this.validMoneyAmount=validMoneyAmount;',context);
for(const date of ['2026-11-21','2028-02-29','2026-12-31']){
  assert.equal(context.validDate(date),true,'Calendar date must be accepted: '+date);
}
for(const date of ['2026-02-29','2026-02-31','2026-13-01','2026-00-10','2026-11-00','0000-01-01','not-a-date']){
  assert.equal(context.validDate(date),false,'Impossible date must be rejected: '+date);
}
for(const amount of [null,undefined,'',' ', 'not-a-number', '-1',Infinity]){
  assert.equal(context.validMoneyAmount(amount),false,'Absent or invalid fare must be rejected: '+String(amount));
}
for(const amount of ['0',0,'148.50',148.5]){
  assert.equal(context.validMoneyAmount(amount),true,'Explicit valid fare must be accepted: '+amount);
}
assert(source.includes('if(!validMoneyAmount(offer.total_amount))return null;'),'Upstream offer parser rejects missing prices before coercion');
assert(source.includes('!validDate(departureDate)'),'Flight API rejects impossible dates before provider request');
console.log('PASS: Flight API rejects impossible dates and missing/invalid upstream prices');
