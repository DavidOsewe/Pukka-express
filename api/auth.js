export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY)return res.status(503).json({error:'Supabase is not configured.'});
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:'Email and password are required.'});
  const response=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const data=await response.json();
  if(!response.ok){const reason=data.msg||data.message||data.error_description||data.error||'No error detail returned';return res.status(response.status).json({error:'Supabase sign-in failed ('+response.status+(data.code?' · '+data.code:'')+'): '+reason});}
  return res.status(200).json({access_token:data.access_token,refresh_token:data.refresh_token,user:data.user});
}
