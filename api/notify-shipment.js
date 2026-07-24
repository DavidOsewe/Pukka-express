const json=(res,body,status=200)=>res.status(status).json(body);
const safe=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,{error:'Method not allowed.'},405);
  if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return json(res,{sent:false,reason:'Email notifications are not configured.'},200);
  const {id,recipient,recipientEmail,origin,destination,carrier,waybill,weight,price}=req.body||{};
  if(!id||!recipient||!recipientEmail)return json(res,{error:'Shipment email details are incomplete.'},400);
  const carrierName=carrier==='standalone'?'Pukka Express':String(carrier||'').toUpperCase();
  const waybillLine=waybill?'<p><b>Carrier waybill:</b> '+safe(waybill)+'</p>':'';
  const html='<div style="font-family:Arial,sans-serif;color:#18215f;line-height:1.55"><h1>Your Pukka Express shipment has been created</h1><p>Hello '+safe(recipient)+',</p><p>Your shipment is registered and ready to be tracked.</p><p><b>Pukka tracking ID:</b> '+safe(id)+'<br><b>Route:</b> '+safe(origin)+' → '+safe(destination)+'<br><b>Service:</b> '+safe(carrierName)+'<br><b>Weight:</b> '+safe(weight)+' kg<br><b>Shipment price:</b> ₦'+safe(Number(price||0).toLocaleString('en-NG'))+'</p>'+waybillLine+'<p>Visit <a href="'+safe(process.env.PUBLIC_SITE_URL||'https://pukka-express.vercel.app')+'/tracking.html">Pukka Express tracking</a> and enter your tracking ID for updates.</p><p>Need help? pukkaexpress.ng@gmail.com · +234 803 631 6751</p></div>';
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[recipientEmail],subject:'Your Pukka Express shipment '+id+' has been created',html})});
    if(!response.ok){console.error('Email provider error',response.status);return json(res,{sent:false},502)}
    return json(res,{sent:true});
  }catch(error){console.error('Shipment notification failed',error.message);return json(res,{sent:false},502)}
}
