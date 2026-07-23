/**
 * Serverless tracking endpoint. Deploy this with Vercel/Netlify functions or
 * move the provider functions into your own authenticated backend.
 * Never put the API keys below in browser code.
 */
const json = (res, body, status = 200) => res.status(status).json(body);

export default async function handler(req, res) {
  const { carrier, trackingNumber } = req.query;
  if (!trackingNumber || !['dhl', 'aramex', 'fedex'].includes(carrier)) return json(res, { error: 'Provide a carrier and tracking number.' }, 400);
  try {
    const shipment = await ({ dhl: trackDhl, aramex: trackAramex, fedex: trackFedex }[carrier])(trackingNumber);
    return json(res, shipment);
  } catch (error) {
    console.error(`Tracking lookup failed for ${carrier}`, error.message);
    return json(res, { error: 'Tracking is temporarily unavailable.' }, 502);
  }
}

async function trackDhl(trackingNumber) {
  const response = await fetch(`https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`, { headers: { 'DHL-API-Key': process.env.DHL_API_KEY } });
  if (!response.ok) throw new Error(`DHL ${response.status}`);
  const data = await response.json();
  return normalize('DHL Express', trackingNumber, data.shipments?.[0]);
}

async function trackFedex(trackingNumber) {
  const baseUrl = process.env.FEDEX_ENVIRONMENT === 'sandbox' ? 'https://apis-sandbox.fedex.com' : 'https://apis.fedex.com';
  const grantType = process.env.FEDEX_GRANT_TYPE || 'client_credentials';
  const tokenPayload = new URLSearchParams({ grant_type: grantType, client_id: process.env.FEDEX_CLIENT_ID, client_secret: process.env.FEDEX_CLIENT_SECRET });
  if (process.env.FEDEX_CHILD_KEY) tokenPayload.set('child_Key', process.env.FEDEX_CHILD_KEY);
  if (process.env.FEDEX_CHILD_SECRET) tokenPayload.set('child_secret', process.env.FEDEX_CHILD_SECRET);
  const tokenResponse = await fetch(`${baseUrl}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenPayload });
  if (!tokenResponse.ok) throw new Error(`FedEx auth ${tokenResponse.status}`);
  const { access_token } = await tokenResponse.json();
  const response = await fetch(`${baseUrl}/track/v1/trackingnumbers`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-locale': process.env.FEDEX_LOCALE || 'en_US', Authorization: `Bearer ${access_token}` }, body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }) });
  if (!response.ok) throw new Error(`FedEx ${response.status}`);
  return normalizeFedex(trackingNumber, await response.json());
}

function normalizeFedex(trackingNumber, data) {
  const result = data?.output?.completeTrackResults?.flatMap(item => item.trackResults || [])?.[0];
  if (!result) throw new Error('FedEx returned no tracking result');
  const location = value => [value?.city, value?.stateOrProvinceCode, value?.countryCode].filter(Boolean).join(', ') || 'Location unavailable';
  const origin = location(result.shipperInformation?.address);
  const destination = location(result.recipientInformation?.address || result.destinationLocation?.address);
  const events = (result.scanEvents || []).map(event => [event.eventDescription || event.eventType || 'Shipment update', location(event.scanLocation), event.date || event.dateTime || '']).filter(event => event[2]);
  const estimated = result.estimatedDeliveryTimeWindow?.window?.ends || result.dateAndTimes?.find(item => item.type === 'ESTIMATED_DELIVERY')?.dateTime;
  return { carrier: 'FedEx', number: trackingNumber, status: result.latestStatusDetail?.description || result.latestStatusDetail?.code || 'In transit', eta: estimated ? new Date(estimated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Check carrier updates', route: `${origin} \u2192 ${destination}`, title: result.latestStatusDetail?.description || 'Shipment update available', events };
}

async function trackAramex(trackingNumber) {
  // Add the current Aramex SOAP/REST tracking request prescribed for your account here.
  // Credentials vary by account and must be kept in ARAMEX_* environment variables.
  throw new Error('Aramex provider needs account credentials/configuration');
}

function normalize(carrier, trackingNumber, raw) { return { carrier, number: trackingNumber, status: raw?.status || 'In transit', eta: 'Check carrier updates', route: 'Origin → Destination', title: 'Shipment update available', events: [] }; }
