const $ = (s) => document.querySelector(s);

let chosen = 'auto';
let lastLookup = null;

function detect(value) {
  if (chosen !== 'auto') return chosen;
  if (/^\d{12}$|^\d{15}$/.test(value)) return 'fedex';
  if (/^\d{10}$/.test(value)) return 'aramex';
  return 'dhl';
}

function carrierMark(carrier) {
  const mark = $('#carrierLogo');
  const name = String(carrier || '').toLowerCase();
  mark.style.cssText = '';

  if (name.includes('fedex')) {
    mark.style.cssText = 'background:#fff;border:1px solid #e6e8ef;font:800 15px Arial;letter-spacing:-1px';
    mark.innerHTML = '<span style="color:#4d148c">Fed</span><span style="color:#ff6200">Ex</span>';
  } else if (name.includes('dhl')) {
    mark.style.cssText = 'background:#ffcc00;color:#d40511;font:800 italic 15px Arial';
    mark.textContent = 'DHL';
  } else if (name.includes('aramex')) {
    mark.style.cssText = 'background:#fff;color:#d71920;border:1px solid #e6e8ef;font:800 12px Arial';
    mark.textContent = 'aramex';
  } else {
    mark.style.cssText = 'background:#eaf0ff;color:#2559e6;font:800 10px Manrope';
    mark.textContent = 'Pukka';
  }
}

function show(data, number, source = 'live') {
  const parts = (data.route || 'Origin → Destination').split(' → ');
  const origin = parts[0] || 'Origin';
  const destination = parts[1] || 'Destination';
  const summary = $('.shipment-summary');
  const details = $('.detail-grid');

  summary.hidden = false;
  details.hidden = false;
  summary.style.display = 'grid';
  details.style.display = 'grid';

  carrierMark(data.carrier);
  $('#carrierName').textContent = String(data.carrier || 'Pukka Express').toUpperCase();
  $('#resultNumber').textContent = number;
  $('#route').innerHTML = `${origin} <span>→</span> ${destination}`;
  $('#status').textContent = data.status || 'Shipment update';
  $('#eta').innerHTML = `Estimated delivery <b>${data.eta || 'Check updates'}</b>`;
  $('#deliveryTitle').textContent = data.title || data.status || 'Shipment update';
  $('#originName').textContent = origin;
  $('#originCaption').textContent = data.events?.[0]?.[1] || 'Shipment origin';
  $('#destinationName').textContent = destination;
  $('#destinationCaption').textContent = 'Expected destination';
  $('#carrierLink').href = data.link || 'mailto:pukkaexpress.ng@gmail.com';

  const events = Array.isArray(data.events) ? data.events : [];
  $('#timeline').innerHTML = events.length
    ? events
        .map(
          (e, i) =>
            `<div class="event ${i === 0 ? 'current' : ''}"><i></i><strong>${e[0] || 'Update'}</strong><p>${e[1] || ''}</p><small>${e[2] || ''}</small></div>`
        )
        .join('')
    : '<p style="font-size:11px;color:#78869a">No shipment updates are available yet.</p>';

  $('#apiError').hidden = true;
  $('#lastUpdated').textContent =
    source === 'live'
      ? 'Live carrier data · updated just now'
      : 'Pukka Express update · updated just now';
  $('#resultShell').hidden = false;
  $('#resultShell').scrollIntoView({ behavior: 'smooth' });
}

function showLiveError(message) {
  const summary = $('.shipment-summary');
  const details = $('.detail-grid');
  summary.hidden = true;
  details.hidden = true;
  summary.style.display = 'none';
  details.style.display = 'none';
  $('#lastUpdated').textContent = 'No live result available';
  $('#apiError').textContent =
    'Tracking unavailable: ' + message + ' If this is a Pukka ID, confirm it was created in the business portal. For carrier waybills, check credentials and try again.';
  $('#apiError').hidden = false;
  $('#resultShell').hidden = false;
  $('#resultShell').scrollIntoView({ behavior: 'smooth' });
}

async function lookupLive(number, carrier) {
  const response = await fetch(
    `/api/track?carrier=${encodeURIComponent(carrier)}&trackingNumber=${encodeURIComponent(number)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The carrier did not return a tracking result.');
  return data;
}

async function lookupPukka(number) {
  const response = await fetch(
    `/api/shipments?trackingNumber=${encodeURIComponent(number)}`
  );
  if (response.status === 404 || response.status === 503) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load Pukka shipment.');
  return data;
}

function resolveCarrierKey(pukkaCarrier) {
  const value = String(pukkaCarrier || '').toLowerCase();
  if (value.includes('dhl')) return 'dhl';
  if (value.includes('fedex')) return 'fedex';
  if (value.includes('aramex')) return 'aramex';
  return '';
}

document.querySelectorAll('.carrier').forEach((button) => {
  button.addEventListener('click', () => {
    chosen = button.dataset.carrier;
    document.querySelectorAll('.carrier').forEach((el) => el.classList.toggle('selected', el === button));
  });
});

$('#trackerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const number = $('#trackingNumber').value.trim();
  const button = e.submitter;
  if (!number) return;

  button.textContent = 'Checking status...';
  button.disabled = true;

  try {
    const pukka = await lookupPukka(number);

    if (pukka) {
      const carrier = resolveCarrierKey(pukka.carrier);
      const waybill = pukka.carrierWaybill;

      if (waybill && carrier) {
        try {
          const live = await lookupLive(waybill, carrier);
          live.route = pukka.route || live.route;
          lastLookup = { number: waybill, carrier, displayNumber: number };
          show(live, number, 'live');
        } catch {
          show(pukka, number, 'pukka');
        }
      } else {
        show(pukka, number, 'pukka');
      }
      return;
    }

    const carrier = detect(number);
    const data = await lookupLive(number, carrier);
    lastLookup = { number, carrier, displayNumber: number };
    show(data, number, 'live');
  } catch (error) {
    showLiveError(error.message);
  } finally {
    button.innerHTML = 'Track shipment <span>→</span>';
    button.disabled = false;
  }
});

$('#back').addEventListener('click', () => {
  $('#resultShell').hidden = true;
  $('#trackingNumber').focus();
  scrollTo({ top: 0, behavior: 'smooth' });
});

$('#refresh').addEventListener('click', async () => {
  if (!lastLookup) return;
  const button = $('#refresh');
  button.textContent = 'Refreshing...';
  button.disabled = true;
  try {
    show(
      await lookupLive(lastLookup.number, lastLookup.carrier),
      lastLookup.displayNumber || lastLookup.number,
      'live'
    );
  } catch (error) {
    showLiveError(error.message);
  } finally {
    button.innerHTML = '↻ Refresh';
    button.disabled = false;
  }
});
