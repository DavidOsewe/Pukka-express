/**
 * Serverless tracking endpoint for DHL, FedEx, and Aramex.
 * Deploy as a Vercel API route. Never expose carrier credentials in the browser.
 */
const json = (res, body, status = 200) => res.status(status).json(body);

const ALLOWED = new Set(['dhl', 'aramex', 'fedex']);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, { error: 'Method not allowed.' }, 405);
  }

  const carrier = String(req.query.carrier || '').toLowerCase();
  const trackingNumber = String(req.query.trackingNumber || '').trim();

  if (!trackingNumber || !ALLOWED.has(carrier)) {
    return json(res, { error: 'Provide a valid carrier (dhl, fedex, aramex) and tracking number.' }, 400);
  }

  try {
    const shipment = await (
      { dhl: trackDhl, aramex: trackAramex, fedex: trackFedex }[carrier]
    )(trackingNumber);
    return json(res, shipment);
  } catch (error) {
    console.error(`Tracking lookup failed for ${carrier}`, error.message);
    return json(res, { error: error.message || 'Tracking is temporarily unavailable.' }, 502);
  }
}

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function joinLocation(parts) {
  return parts.filter(Boolean).join(', ') || 'Location unavailable';
}

async function trackDhl(trackingNumber) {
  if (!process.env.DHL_API_KEY) throw new Error('DHL API key is not configured.');

  const response = await fetch(
    `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    { headers: { 'DHL-API-Key': process.env.DHL_API_KEY } }
  );
  if (!response.ok) throw new Error(`DHL returned ${response.status}`);

  const data = await response.json();
  const shipment = data.shipments?.[0];
  if (!shipment) throw new Error('DHL returned no tracking result.');

  const origin = joinLocation([
    shipment.origin?.address?.addressLocality,
    shipment.origin?.address?.countryCode,
  ]);
  const destination = joinLocation([
    shipment.destination?.address?.addressLocality,
    shipment.destination?.address?.countryCode,
  ]);

  const events = (shipment.events || [])
    .map((event) => [
      event.description || event.status || 'Shipment update',
      joinLocation([
        event.location?.address?.addressLocality,
        event.location?.address?.countryCode,
      ]),
      formatWhen(event.timestamp),
    ])
    .filter((event) => event[0]);

  const status =
    shipment.status?.status ||
    shipment.status?.description ||
    events[0]?.[0] ||
    'In transit';

  const etaRaw =
    shipment.estimatedTimeOfDelivery ||
    shipment.estimatedDeliveryTime ||
    shipment.status?.estimatedTimeOfDelivery;
  const eta = etaRaw
    ? formatWhen(etaRaw)
    : status.toLowerCase().includes('delivered')
      ? 'Delivered'
      : 'Check carrier updates';

  return {
    carrier: 'DHL Express',
    number: trackingNumber,
    status,
    eta,
    route: `${origin} → ${destination}`,
    title: status,
    events,
    link: 'https://www.dhl.com/en/express/tracking.html',
  };
}

async function trackFedex(trackingNumber) {
  if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
    throw new Error('FedEx credentials are not configured.');
  }

  const baseUrl =
    process.env.FEDEX_ENVIRONMENT === 'sandbox'
      ? 'https://apis-sandbox.fedex.com'
      : 'https://apis.fedex.com';
  const grantType = process.env.FEDEX_GRANT_TYPE || 'client_credentials';

  const tokenPayload = new URLSearchParams({
    grant_type: grantType,
    client_id: process.env.FEDEX_CLIENT_ID,
    client_secret: process.env.FEDEX_CLIENT_SECRET,
  });
  if (process.env.FEDEX_CHILD_KEY) tokenPayload.set('child_Key', process.env.FEDEX_CHILD_KEY);
  if (process.env.FEDEX_CHILD_SECRET) tokenPayload.set('child_secret', process.env.FEDEX_CHILD_SECRET);

  const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenPayload,
  });
  if (!tokenResponse.ok) throw new Error(`FedEx auth failed (${tokenResponse.status})`);

  const { access_token } = await tokenResponse.json();
  const response = await fetch(`${baseUrl}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-locale': process.env.FEDEX_LOCALE || 'en_US',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
    }),
  });
  if (!response.ok) throw new Error(`FedEx returned ${response.status}`);

  return normalizeFedex(trackingNumber, await response.json());
}

function normalizeFedex(trackingNumber, data) {
  const result = data?.output?.completeTrackResults?.flatMap((item) => item.trackResults || [])?.[0];
  if (!result) throw new Error('FedEx returned no tracking result.');

  const location = (value) =>
    joinLocation([value?.city, value?.stateOrProvinceCode, value?.countryCode]);

  const origin = location(result.shipperInformation?.address);
  const destination = location(
    result.recipientInformation?.address || result.destinationLocation?.address
  );

  const events = (result.scanEvents || [])
    .map((event) => [
      event.eventDescription || event.eventType || 'Shipment update',
      location(event.scanLocation),
      formatWhen(event.date || event.dateTime),
    ])
    .filter((event) => event[0]);

  const estimated =
    result.estimatedDeliveryTimeWindow?.window?.ends ||
    result.dateAndTimes?.find((item) => item.type === 'ESTIMATED_DELIVERY')?.dateTime;

  const status =
    result.latestStatusDetail?.description ||
    result.latestStatusDetail?.code ||
    'In transit';

  return {
    carrier: 'FedEx',
    number: trackingNumber,
    status,
    eta: estimated
      ? formatWhen(estimated)
      : status.toLowerCase().includes('delivered')
        ? 'Delivered'
        : 'Check carrier updates',
    route: `${origin} → ${destination}`,
    title: status,
    events,
    link: 'https://www.fedex.com/fedextrack/',
  };
}

async function trackAramex(trackingNumber) {
  // Aramex tracking is account-specific (SOAP or REST). Wire the request your
  // account manager supplies, using ARAMEX_* environment variables.
  if (
    !process.env.ARAMEX_USERNAME ||
    !process.env.ARAMEX_PASSWORD ||
    !process.env.ARAMEX_ACCOUNT_NUMBER
  ) {
    throw new Error('Aramex credentials are not configured.');
  }
  throw new Error(
    'Aramex tracking adapter is not yet connected for this account. Use a Pukka tracking ID or contact support.'
  );
}
