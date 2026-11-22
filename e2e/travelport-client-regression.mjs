import assert from 'node:assert/strict';
import {configuration,buildSearchRequest,authenticate,searchRaw} from '../netlify/lib/travelport-client.mjs';
const env={TRAVELPORT_ENVIRONMENT:'preproduction',TRAVELPORT_USERNAME:'test-user',TRAVELPORT_PASSWORD:'fake-password',TRAVELPORT_CLIENT_ID:'test-id',TRAVELPORT_CLIENT_SECRET:'fake-secret',TRAVELPORT_ACCESS_GROUP:'19Y88702-C27A-4E5D-829A-89D7016688B1'};
assert.equal(configuration({}).ready,false);
assert.equal(configuration(env).ready,true);
assert.throws(()=>buildSearchRequest('DTW','DTW','2026-12-11'));
assert.throws(()=>buildSearchRequest('DTW','ESC','2026-02-30'));
assert.equal(buildSearchRequest('DTW','ESC','2026-12-11').CatalogProductOfferingsQueryRequest.CatalogProductOfferingsRequest.SearchCriteriaFlight[0].From.cityOrAirport,'Airport Only');
assert.equal(Object.keys(buildSearchRequest('DTW','ESC','2026-12-11')).join(','),'CatalogProductOfferingsQueryRequest');
let authCalls=0,searchCalls=0;
const fakeFetch=async(url,options)=>{
 if(url.includes('/oauth/token')){authCalls++;const p=new URLSearchParams(options.body);assert.equal(p.get('grant_type'),'password');return {ok:true,json:async()=>({access_token:'fake-token',expires_in:86400})};}
 searchCalls++;assert.equal(options.headers.Authorization,'Bearer fake-token');assert.equal(options.headers['Accept-Version'],'11');assert.equal(options.headers['Content-Version'],'11');assert.match(options.headers['Accept-Encoding'],/gzip/);assert.equal(options.headers.XAUTH_TRAVELPORT_ACCESSGROUP,env.TRAVELPORT_ACCESS_GROUP);assert.equal(JSON.parse(options.body).CatalogProductOfferingsQueryRequest.CatalogProductOfferingsRequest.SearchCriteriaFlight[0].To.value,'ESC');
 return {ok:true,json:async()=>({CatalogProductOfferingsResponse:{Result:{status:'Complete'}}})};
};
await authenticate(env,fakeFetch);
await searchRaw('DTW','ESC','2026-12-11',env,fakeFetch);
assert.equal(authCalls,1);assert.equal(searchCalls,1);
console.log('PASS mocked Travelport OAuth and v11 Search transport; NO live inventory was tested');
