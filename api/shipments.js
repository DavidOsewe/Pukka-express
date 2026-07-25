import { adminRequest, configured, requireAdmin } from './supabase.js';
const json=(res,body,status=200)=>res.status(status).json(body);
const mapShipment=(shipment,events=[])=>({carrier:shipment.carrier==='standalone'?'Pukka Express':shipment.carrier.toUpperCase(),carrierWaybill:shipment.carrier_waybill||null,number:shipment.tracking_id,status:shipment.status,eta:shipment.status==='Delivered'?'Delivered':'Check Pukka Express updates',route:shipment.origin+' → '+shipment.destination,title:shipment.status,events:events.map(e=>[e.status+(e.note?' — '+e.note:''),e.location,new Date(e.event_time).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'})])});

export default async function handler(req,res){
  if(!configured())return json(res,{error:'Supabase is not configured.'},503);
  if(req.method==='GET'){
    const trackingNumber=String(req.query.trackingNumber||'').trim();
    if(trackingNumber)return getTracking(trackingNumber,res);
    if(!await requireAdmin(req))return json(res,{error:'Unauthorized.'},401);
    const response=await adminRequest('shipments?select=*&order=created_at.desc');
    return response.ok?json(res,await response.json()):json(res,{error:'Could not load shipments.'},502);
  }
  const user=await requireAdmin(req);
  if(!user)return json(res,{error:'Unauthorized.'},401);
  if(req.method==='POST')return createShipment(req,res);
  if(req.method==='PATCH')return addEvent(req,res);
  return json(res,{error:'Method not allowed.'},405);
}

async function getTracking(number,res){
  const filter='or=(tracking_id.eq.'+encodeURIComponent(number)+',carrier_waybill.eq.'+encodeURIComponent(number)+')&limit=1';
  const response=await adminRequest('shipments?'+filter+'&select=*');
  const rows=response.ok?await response.json():[];
  if(!rows.length)return json(res,{error:'Shipment not found.'},404);
  const shipment=rows[0],eventResponse=await adminRequest('shipment_events?shipment_id=eq.'+shipment.id+'&order=event_time.desc&select=*');
  return json(res,mapShipment(shipment,eventResponse.ok?await eventResponse.json():[]));
}

async function createShipment(req,res){
  const body=req.body||{};
  const required=['tracking_id','sender_name','sender_email','sender_phone','sender_street','recipient_name','recipient_email','recipient_phone','recipient_street','origin','destination','weight_kg','price_ngn'];
  if(required.some(key=>body[key]===undefined||body[key]===null||body[key]===''))return json(res,{error:'Complete all required shipment fields.'},400);
  const response=await adminRequest('shipments',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
  const rows=response.ok?await response.json():[];
  if(!response.ok)return json(res,{error:'Could not create shipment.'},502);
  await adminRequest('shipment_events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shipment_id:rows[0].id,status:'Shipment received',location:body.origin})});
  return json(res,rows[0],201);
}

async function addEvent(req,res){
  const {shipment_id,status,location,note}=req.body||{};
  if(!shipment_id||!status||!location)return json(res,{error:'Shipment, status, and location are required.'},400);
  const response=await adminRequest('shipment_events',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({shipment_id,status,location,note:note||null})});
  if(!response.ok)return json(res,{error:'Could not save update.'},502);
  await adminRequest('shipments?id=eq.'+shipment_id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,updated_at:new Date().toISOString()})});
  return json(res,(await response.json())[0],201);
}
