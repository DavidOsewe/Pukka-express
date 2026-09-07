import { adminRequest, configured, requireAdmin } from './supabase.js';

const json = (res, body, status = 200) => res.status(status).json(body);

const ALLOWED_CARRIERS = new Set(['standalone', 'dhl', 'fedex', 'aramex']);
const ALLOWED_STATUSES = new Set([
  'Shipment received',
  'Picked up',
  'In transit',
  'Out for delivery',
  'Delivered',
  'Delivery exception',
]);

const mapShipment = (shipment, events = []) => ({
  carrier: shipment.carrier === 'standalone' ? 'Pukka Express' : String(shipment.carrier).toUpperCase(),
  carrierWaybill: shipment.carrier_waybill || null,
  number: shipment.tracking_id,
  status: shipment.status,
  eta: shipment.status === 'Delivered' ? 'Delivered' : 'Check Pukka Express updates',
  route: `${shipment.origin} → ${shipment.destination}`,
  title: shipment.status,
  events: events.map((e) => [
    e.status + (e.note ? ` — ${e.note}` : ''),
    e.location,
    new Date(e.event_time).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
  ]),
});

export default async function handler(req, res) {
  if (!configured()) return json(res, { error: 'Supabase is not configured.' }, 503);

  if (req.method === 'GET') {
    const trackingNumber = String(req.query.trackingNumber || '').trim();
    if (trackingNumber) return getTracking(trackingNumber, res);
    if (!(await requireAdmin(req))) return json(res, { error: 'Unauthorized.' }, 401);
    const response = await adminRequest('shipments?select=*&order=created_at.desc');
    return response.ok
      ? json(res, await response.json())
      : json(res, { error: 'Could not load shipments.' }, 502);
  }

  const user = await requireAdmin(req);
  if (!user) return json(res, { error: 'Unauthorized.' }, 401);

  if (req.method === 'POST') return createShipment(req, res);
  if (req.method === 'PATCH') return addEvent(req, res);
  return json(res, { error: 'Method not allowed.' }, 405);
}

async function getTracking(number, res) {
  const encoded = encodeURIComponent(number);
  const filter = `or=(tracking_id.eq.${encoded},carrier_waybill.eq.${encoded})&limit=1`;
  const response = await adminRequest(`shipments?${filter}&select=*`);
  const rows = response.ok ? await response.json() : [];
  if (!rows.length) return json(res, { error: 'Shipment not found.' }, 404);

  const shipment = rows[0];
  const eventResponse = await adminRequest(
    `shipment_events?shipment_id=eq.${shipment.id}&order=event_time.desc&select=*`
  );
  return json(res, mapShipment(shipment, eventResponse.ok ? await eventResponse.json() : []));
}

async function createShipment(req, res) {
  const body = req.body || {};
  const required = [
    'tracking_id',
    'sender_name',
    'sender_email',
    'sender_phone',
    'sender_street',
    'recipient_name',
    'recipient_email',
    'recipient_phone',
    'recipient_street',
    'origin',
    'destination',
    'weight_kg',
    'price_ngn',
  ];

  if (required.some((key) => body[key] === undefined || body[key] === null || body[key] === '')) {
    return json(res, { error: 'Complete all required shipment fields.' }, 400);
  }

  const carrier = String(body.carrier || 'standalone').toLowerCase();
  if (!ALLOWED_CARRIERS.has(carrier)) {
    return json(res, { error: 'Invalid carrier.' }, 400);
  }

  const trackingId = String(body.tracking_id).trim().toUpperCase();
  if (!/^PUK-\d{4}-\d{5}$/.test(trackingId)) {
    return json(res, { error: 'Tracking ID must match PUK-YYYY-#####' }, 400);
  }

  const weight = Number(body.weight_kg);
  const price = Number(body.price_ngn);
  if (!(weight > 0) || Number.isNaN(weight)) {
    return json(res, { error: 'Weight must be a positive number.' }, 400);
  }
  if (!(price >= 0) || Number.isNaN(price)) {
    return json(res, { error: 'Price must be zero or greater.' }, 400);
  }

  const payload = {
    tracking_id: trackingId,
    carrier,
    carrier_waybill: body.carrier_waybill ? String(body.carrier_waybill).trim() : null,
    sender_name: String(body.sender_name).trim(),
    sender_email: String(body.sender_email).trim(),
    sender_phone: String(body.sender_phone).trim(),
    sender_street: String(body.sender_street).trim(),
    recipient_name: String(body.recipient_name).trim(),
    recipient_email: String(body.recipient_email).trim(),
    recipient_phone: String(body.recipient_phone).trim(),
    recipient_street: String(body.recipient_street).trim(),
    origin: String(body.origin).trim(),
    destination: String(body.destination).trim(),
    weight_kg: weight,
    price_ngn: price,
    status: 'Shipment received',
  };

  const response = await adminRequest('shipments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Create shipment failed', response.status, detail);
    if (response.status === 409 || detail.includes('duplicate') || detail.includes('unique')) {
      return json(res, { error: 'That Pukka tracking ID already exists. Generate another.' }, 409);
    }
    return json(res, { error: 'Could not create shipment.' }, 502);
  }

  const rows = await response.json();
  await adminRequest('shipment_events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipment_id: rows[0].id,
      status: 'Shipment received',
      location: payload.origin,
      note: 'Shipment registered in Pukka Express',
    }),
  });

  return json(res, rows[0], 201);
}

async function addEvent(req, res) {
  const { shipment_id, status, location, note } = req.body || {};
  if (!shipment_id || !status || !location) {
    return json(res, { error: 'Shipment, status, and location are required.' }, 400);
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return json(res, { error: 'Invalid status value.' }, 400);
  }

  const response = await adminRequest('shipment_events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      shipment_id,
      status,
      location: String(location).trim(),
      note: note ? String(note).trim() : null,
    }),
  });

  if (!response.ok) return json(res, { error: 'Could not save update.' }, 502);

  await adminRequest(`shipments?id=eq.${shipment_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });

  return json(res, (await response.json())[0], 201);
}
