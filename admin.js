const $ = (s) => document.querySelector(s);

let token = sessionStorage.getItem('pukkaAccessToken') || '';
let shipments = [];
let filtered = [];
let proposed = '';

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
};

function newId() {
  const year = new Date().getFullYear();
  const n = String(Math.floor(10000 + Math.random() * 90000));
  return `PUK-${year}-${n}`;
}

function setProposed() {
  proposed = newId();
  const el = $('#proposedId');
  if (el) el.textContent = proposed;
}

function money(v) {
  return Number(v || 0).toLocaleString('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  });
}

function stamp(value) {
  return value
    ? new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}

function renderTable() {
  const table = $('#shipmentTable');
  if (!table) return;

  if (!filtered.length) {
    table.innerHTML = '<p class="empty">No shipments match these filters.</p>';
    return;
  }

  table.innerHTML = filtered
    .map(
      (x) => `<div class="register-row">
        <div><strong>${x.tracking_id}</strong><small>${x.recipient_name || ''}</small></div>
        <div><strong>${x.origin || ''} → ${x.destination || ''}</strong>
          <small>${x.carrier_waybill ? 'Waybill: ' + x.carrier_waybill : 'Pukka Express delivery'}</small>
        </div>
        <div class="register-carrier">
          ${x.carrier === 'standalone' ? 'PUKKA EXPRESS' : String(x.carrier || '').toUpperCase()}
          <small>${x.status || ''} · ${stamp(x.updated_at || x.created_at)}</small>
        </div>
        <div>
          <strong>${x.weight_kg ?? '—'} kg</strong>
          <small>${money(x.price_ngn)}</small>
          <small>Created ${stamp(x.created_at)}</small>
          <a href="tracking.html" class="row-link">Customer view</a>
        </div>
      </div>`
    )
    .join('');
}

function applyFilters() {
  const query = ($('#filterSearch')?.value || '').trim().toLowerCase();
  const status = $('#filterStatus')?.value || '';
  const from = $('#filterFrom')?.value || '';
  const to = $('#filterTo')?.value || '';

  filtered = shipments.filter((x) => {
    const haystack = [x.tracking_id, x.recipient_name, x.carrier_waybill, x.sender_name]
      .join(' ')
      .toLowerCase();
    const date = (x.created_at || '').slice(0, 10);
    return (
      (!query || haystack.includes(query)) &&
      (!status || x.status === status) &&
      (!from || date >= from) &&
      (!to || date <= to)
    );
  });
  renderTable();
}

async function render() {
  shipments = await api('/api/shipments');
  const list = $('#statusShipmentList');
  if (list) {
    list.innerHTML = shipments
      .map(
        (x) =>
          `<option value="${x.tracking_id}">${x.recipient_name || ''} · ${x.status || ''}</option>`
      )
      .join('');
  }
  applyFilters();
}

async function dashboard() {
  const active = Boolean(token);
  const loginCard = $('#loginCard');
  const adminDashboard = $('#adminDashboard');
  if (loginCard) loginCard.hidden = active;
  if (adminDashboard) adminDashboard.hidden = !active;

  if (!active) return;

  try {
    await render();
    setProposed();
  } catch (error) {
    token = '';
    sessionStorage.removeItem('pukkaAccessToken');
    if (loginCard) loginCard.hidden = false;
    if (adminDashboard) adminDashboard.hidden = true;
    const loginError = $('#loginError');
    if (loginError) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
  }
}

function csvValue(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}

function downloadCsv() {
  const heads = [
    'Pukka ID',
    'Carrier',
    'Carrier waybill',
    'Status',
    'Weight kg',
    'Price NGN',
    'Sender',
    'Origin',
    'Recipient',
    'Destination',
    'Recipient email',
    'Recipient phone',
    'Created at',
    'Last updated',
  ];
  const body = filtered
    .map((x) =>
      [
        x.tracking_id,
        x.carrier,
        x.carrier_waybill,
        x.status,
        x.weight_kg,
        x.price_ngn,
        x.sender_name,
        x.origin,
        x.recipient_name,
        x.destination,
        x.recipient_email,
        x.recipient_phone,
        stamp(x.created_at),
        stamp(x.updated_at || x.created_at),
      ]
        .map(csvValue)
        .join(',')
    )
    .join('\n');

  const blob = new Blob([heads.map(csvValue).join(',') + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pukka-express-shipments.csv';
  a.click();
  URL.revokeObjectURL(url);
}

$('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const f = new FormData(form);
  const loginError = $('#loginError');
  try {
    const session = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
    });
    token = session.access_token;
    sessionStorage.setItem('pukkaAccessToken', token);
    if (loginError) loginError.hidden = true;
    await dashboard();
  } catch (error) {
    if (loginError) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
  }
});

$('#logout')?.addEventListener('click', () => {
  token = '';
  sessionStorage.removeItem('pukkaAccessToken');
  dashboard();
});

$('#regenerate')?.addEventListener('click', setProposed);

$('#createShipment')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const f = new FormData(form);
  const message = $('#createdMessage');
  const carrier = f.get('carrier');

  const payload = {
    tracking_id: proposed,
    carrier,
    carrier_waybill: (f.get('waybill') || '').trim() || null,
    sender_name: f.get('senderName'),
    sender_email: f.get('senderEmail'),
    sender_phone: f.get('senderPhone'),
    sender_street: f.get('senderStreet'),
    recipient_name: f.get('recipient'),
    recipient_email: f.get('recipientEmail'),
    recipient_phone: f.get('recipientPhone'),
    recipient_street: f.get('recipientStreet'),
    origin: `${f.get('senderTown')}, ${f.get('senderCountry')}`,
    destination: `${f.get('recipientTown')}, ${f.get('recipientCountry')}`,
    weight_kg: Number(f.get('weight')),
    price_ngn: Number(f.get('price')),
  };

  try {
    const item = await api('/api/shipments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    fetch('/api/notify-shipment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        id: item.tracking_id,
        recipient: item.recipient_name,
        recipientEmail: item.recipient_email,
        origin: item.origin,
        destination: item.destination,
        carrier: item.carrier,
        waybill: item.carrier_waybill,
        weight: item.weight_kg,
        price: item.price_ngn,
      }),
    }).catch(() => {});

    if (message) {
      message.innerHTML =
        'Shipment created. Customer tracking ID: <strong>' +
        item.tracking_id +
        '</strong> <button type="button" id="copyTracking">⧉ Copy</button>';
      message.hidden = false;
      $('#copyTracking')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(item.tracking_id);
        const btn = $('#copyTracking');
        if (btn) btn.textContent = 'Copied';
      });
    }

    form.reset();
    await render();
    setProposed();
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.hidden = false;
    }
  }
});

$('#statusUpdate')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const f = new FormData(form);
  const message = $('#statusMessage');
  const trackingNumber = String(f.get('trackingNumber') || '').trim().toUpperCase();
  const shipment = shipments.find((x) => String(x.tracking_id).toUpperCase() === trackingNumber);

  if (!shipment) {
    if (message) {
      message.textContent = 'That Pukka tracking ID is not in the shipment register.';
      message.hidden = false;
    }
    return;
  }

  try {
    await api('/api/shipments', {
      method: 'PATCH',
      body: JSON.stringify({
        shipment_id: shipment.id,
        status: f.get('status'),
        location: f.get('location'),
        note: f.get('note'),
      }),
    });
    if (message) {
      message.textContent = 'Update published for ' + shipment.tracking_id + '.';
      message.hidden = false;
    }
    form.reset();
    await render();
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.hidden = false;
    }
  }
});

$('#clearShipments')?.addEventListener('click', () => {
  alert(
    'Database records are intentionally not cleared from the browser. Remove records in Supabase only when required.'
  );
});

$('#downloadCsv')?.addEventListener('click', downloadCsv);
['filterSearch', 'filterStatus', 'filterFrom', 'filterTo'].forEach((id) => {
  $('#' + id)?.addEventListener('input', applyFilters);
});
$('#clearFilters')?.addEventListener('click', () => {
  ['filterSearch', 'filterStatus', 'filterFrom', 'filterTo'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.value = '';
  });
  applyFilters();
});

dashboard();
