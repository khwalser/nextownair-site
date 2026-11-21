import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../flight-provider.js',import.meta.url),'utf8');
const context={window:{NTA_DATA:{routes:[]}},URLSearchParams,fetch:async()=>{throw Error('Unexpected network request')}};
vm.createContext(context);
vm.runInContext(source,context);
const normalize=context.window.NTA_FLIGHTS.normalizeFlightsContract;
const fare=amount=>({contractVersion:'nta-flights-v1',sourceProvider:'provider',offers:[{
  id:'test',origin:'DTW',destination:'ROC',departureDate:'2026-12-10',
  fare:{amount,currency:'USD',status:'verified'},
  fareChoices:[{id:'missing',amount:null},{id:'empty',amount:''},{id:'valid',amount:'142.50'}]
}]});
for(const input of [null,undefined,'',' ', 'abc']){
  const result=normalize(fare(input));
  assert.equal(result.offers[0].amount,null,'Missing or invalid amount must remain unknown: '+String(input));
  assert.equal(result.offers[0].fareChoices[0].amount,null,'Null fare choice must remain unknown');
  assert.equal(result.offers[0].fareChoices[1].amount,null,'Empty fare choice must remain unknown');
  assert.equal(result.offers[0].fareChoices[2].amount,142.5,'Valid numeric string must retain price');
}
assert.equal(normalize(fare('0')).offers[0].amount,0,'Explicitly supplied zero is distinct from missing fare');
assert.equal(normalize(fare('142.50')).offers[0].amount,142.5,'A valid fare is preserved');
console.log('PASS: Provider fare normalization never invents a zero price for missing amounts');
