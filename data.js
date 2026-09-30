window.NTA_DATA = {
  airports: [
    {code:'ROC',name:'Frederick Douglass Greater Rochester',city:'Rochester',state:'NY',lat:43.1189,lon:-77.6724,type:'hub',note:'Start from western New York'},
    {code:'DTW',name:'Detroit Metropolitan',city:'Detroit',state:'MI',lat:42.2162,lon:-83.3554,type:'hub',note:'Major connector for Michigan EAS service'},
    {code:'APN',name:'Alpena County Regional',city:'Alpena',state:'MI',lat:45.0781,lon:-83.5603,type:'eas',hubs:['DTW'],note:'Lake Huron, Thunder Bay and northeast Michigan',stay:['Thunder Bay National Marine Sanctuary','Lake Huron shoreline','Downtown Alpena']},
    {code:'PLN',name:'Pellston Regional',city:'Pellston',state:'MI',lat:45.5709,lon:-84.7967,type:'eas',hubs:['DTW'],note:'Gateway to Mackinac and northern Michigan',stay:['Mackinac Island','Straits of Mackinac','Northern Michigan shoreline']},
    {code:'ESC',name:'Delta County',city:'Escanaba',state:'MI',lat:45.7228,lon:-87.0937,type:'eas',hubs:['DTW','MSP'],note:'Little Bay de Noc and the central Upper Peninsula',stay:['Fayette Historic State Park','Local pasties','Little Bay de Noc sunset']},
    {code:'IMT',name:'Ford',city:'Iron Mountain',state:'MI',lat:45.8184,lon:-88.1145,type:'eas',hubs:['DTW','MSP'],note:'Western U.P. forests and waterfalls',stay:['Pine Mountain','Waterfall country','Upper Peninsula backroads']},
    {code:'CMX',name:'Houghton County Memorial',city:'Hancock / Houghton',state:'MI',lat:47.1684,lon:-88.4891,type:'eas',hubs:['ORD'],note:'Keweenaw Peninsula and Lake Superior',stay:['Quincy Mine','Keweenaw Peninsula','Lake Superior shoreline']},
    {code:'MSP',name:'Minneapolis–Saint Paul',city:'Minneapolis',state:'MN',lat:44.8848,lon:-93.2223,type:'hub',note:'Upper Midwest connector'},
    {code:'BRD',name:'Brainerd Lakes Regional',city:'Brainerd',state:'MN',lat:46.3983,lon:-94.1381,type:'eas',hubs:['MSP'],note:'Minnesota lake and cabin country',stay:['Brainerd Lakes','Paul Bunyan country','Lake country drives']},
    {code:'ORD',name:"O'Hare International",city:'Chicago',state:'IL',lat:41.9742,lon:-87.9073,type:'hub',note:'National connector'},
    {code:'DEN',name:'Denver International',city:'Denver',state:'CO',lat:39.8561,lon:-104.6737,type:'hub',note:'Rocky Mountain gateway'},
    {code:'EGE',name:'Eagle County Regional',city:'Eagle / Vail',state:'CO',lat:39.6426,lon:-106.9177,type:'regional',note:'Regional gateway for Vail and the central Rockies'}
  ],
  routes: [
    ['ROC','DTW'],['DTW','APN'],['DTW','PLN'],['DTW','ESC'],['DTW','IMT'],['ESC','MSP'],['IMT','MSP'],['MSP','BRD'],['CMX','ORD'],['ROC','ORD'],['ORD','DEN'],['DTW','DEN'],['DEN','EGE']
  ]
};
