const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,'').replace(/\/rest\/v1$/,'');
export const configured=()=>Boolean(base()&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.SUPABASE_ANON_KEY);
export async function adminRequest(path,options={}){
  if(!configured())throw new Error('Supabase is not configured.');
  const response=await fetch(base()+'/rest/v1/'+path,{...options,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,Accept:'application/json',...(options.headers||{})}});
  return response;
}
export async function requireAdmin(req){
  if(!configured())return null;
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if(!token)return null;
  const userResponse=await fetch(base()+'/auth/v1/user',{headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token}});
  if(!userResponse.ok)return null;
  const user=await userResponse.json();
  const profile=await adminRequest('profiles?id=eq.'+encodeURIComponent(user.id)+'&is_admin=eq.true&select=id');
  const admins=profile.ok?await profile.json():[];
  return admins.length?user:null;
}
