export type AdProductId='office-wrap'|'billboard'|'plane-flyover'|'robotaxi-wrap'|'radio-spot'|'event-pin';
export interface AdProduct {
  id:AdProductId;name:string;unit:'week'|'slot'|'event';currency:'USD';
  priceCents:number;maxPriceCents?:number;pricing:'fixed'|'demand'|'indicative';
  companyDomainRequired:boolean;moderationRequired:true;status:'presell';
}
/** All prices are integer cents. Indicative products require a confirmed quote before checkout. */
export const AD_CATALOGUE:readonly AdProduct[]=Object.freeze([
  {id:'office-wrap',name:'Office wrap',unit:'week',currency:'USD',priceCents:10000,pricing:'fixed',companyDomainRequired:true,moderationRequired:true,status:'presell'},
  {id:'billboard',name:'Billboard',unit:'week',currency:'USD',priceCents:25000,maxPriceCents:200000,pricing:'demand',companyDomainRequired:false,moderationRequired:true,status:'presell'},
  {id:'plane-flyover',name:'Plane banner flyover',unit:'slot',currency:'USD',priceCents:50000,pricing:'indicative',companyDomainRequired:false,moderationRequired:true,status:'presell'},
  {id:'robotaxi-wrap',name:'Robotaxi fleet wrap',unit:'week',currency:'USD',priceCents:30000,pricing:'indicative',companyDomainRequired:false,moderationRequired:true,status:'presell'},
  {id:'radio-spot',name:'Radio spot',unit:'week',currency:'USD',priceCents:20000,pricing:'indicative',companyDomainRequired:false,moderationRequired:true,status:'presell'},
  {id:'event-pin',name:'Event-pin sponsor',unit:'event',currency:'USD',priceCents:15000,pricing:'indicative',companyDomainRequired:false,moderationRequired:true,status:'presell'},
]);
