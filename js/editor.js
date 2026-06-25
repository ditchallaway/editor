/**
 * Editor — Main Orchestration
 *
 * Parses URL params, initializes the Photopea bridge with image URLs in
 * the config hash (Photopea loads them natively), runs the acreage script,
 * and wires up Save/Fulfill buttons.
 */

import { CONFIG, imageUrl, buildServerHash, acreageScript, packLabel, directionLabel } from './config.js';
import { PhotopeaBridge } from './photopea-bridge.js';

// ── Parse URL Params ────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);

const state = {
  customerId:    params.get('customer_id') || '',
  orderId:       params.get('order_id') || '',
  pack:          params.get('pack') || 'overhead_only',
  acreage:       params.get('acreage') || '',
  fulfillmentId: params.get('fulfillment_id') || '',
  // Optional property metadata
  county:        params.get('county') || '',
  elevation:     params.get('elevation') || '',
  lat:           params.get('lat') || '',
  lon:           params.get('lon') || '',
};

// ── Validate ────────────────────────────────────────────────────────

const directions = CONFIG.PACK_MAP[state.pack];

if (!state.customerId || !state.orderId) {
  showFatalError(
    '⚠️ Missing Parameters',
    'This editor requires <code>customer_id</code> and <code>order_id</code> in the URL.',
    `Example: ?customer_id=cust_123&order_id=order_456&pack=full&acreage=5.0`
  );
  throw new Error('Missing required URL parameters');
}

if (!directions) {
  showFatalError(
    '⚠️ Unknown Pack Type',
    `Pack "<code>${state.pack}</code>" is not recognized.`,
    `Valid packs: ${Object.keys(CONFIG.PACK_MAP).join(', ')}`
  );
  throw new Error(`Unknown pack: ${state.pack}`);
}

// ── Derive Image URLs ───────────────────────────────────────────────

const imageUrls = directions.map(d => imageUrl(state.customerId, state.orderId, d));

// ── DOM References ──────────────────────────────────────────────────

const iframe          = document.getElementById('photopea-frame');
const headerMeta      = document.getElementById('header-meta');
const statusDot       = document.getElementById('status-dot');
const statusText      = document.getElementById('status-text');
const saveBtn         = document.getElementById('save-btn');
const fulfillBtn      = document.getElementById('fulfill-btn');
const sidebarToggle   = document.getElementById('sidebar-toggle');
const editorLayout    = document.getElementById('editor-layout');
const orderData       = document.getElementById('order-data');
const propertyData    = document.getElementById('property-data');
const progressFill    = document.getElementById('progress-fill');
const progressText    = document.getElementById('progress-text');
const imageList       = document.getElementById('image-list');
const loadingOverlay  = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');
const loadingSubtext  = document.getElementById('loading-subtext');

// ── Populate UI ─────────────────────────────────────────────────────

document.title = `${packLabel(state.pack)} — ${state.orderId} — Property Editor`;

headerMeta.textContent = `${state.customerId} · ${state.orderId} · ${packLabel(state.pack)}`;

// Order data panel
orderData.innerHTML = [
  dataRow('Customer', state.customerId),
  dataRow('Order', state.orderId),
  dataRow('Pack', `<span class="pack-badge">${packLabel(state.pack)} <span class="pack-badge__count">${directions.length}</span></span>`),
].join('');

// Property data panel
const propertyRows = [];
if (state.acreage) propertyRows.push(dataRow('Acreage', `${state.acreage} acres`, 'highlight'));
if (state.county)    propertyRows.push(dataRow('County', state.county));
if (state.lat && state.lon) propertyRows.push(dataRow('Location', `${state.lat}, ${state.lon}`));
if (state.elevation) propertyRows.push(dataRow('Elevation', `${state.elevation} ft`));

if (propertyRows.length === 0) {
  propertyRows.push(dataRow('Acreage', 'Not provided', 'muted'));
}
propertyData.innerHTML = propertyRows.join('');

// Image list
imageList.innerHTML = directions.map(d =>
  `<div class="image-item image-item--pending" id="img-${d}">
    <span class="image-item__icon">○</span>
    <span class="image-item__label">${directionLabel(d)}</span>
  </div>`
).join('');

// Fulfill button state
if (!state.fulfillmentId) {
  fulfillBtn.disabled = true;
  fulfillBtn.title = 'No fulfillment_id in URL';
}

// ── Sidebar Toggle ──────────────────────────────────────────────────

sidebarToggle.addEventListener('click', () => {
  editorLayout.classList.toggle('sidebar-hidden');
});

// ── Initialize Photopea ─────────────────────────────────────────────

async function init() {
  try {
    // Build iframe src with server config only.
    // Files are loaded after init via app.open() — each call gets exactly
    // one "done" response, fully aligned with the Live Messaging docs.
    const serverHash = buildServerHash(state.customerId, state.orderId);
    iframe.src = CONFIG.PHOTOPEA_URL + serverHash;

    setStatus('loading', 'Starting Photopea…');
    setLoading('Starting Photopea…', 'Initializing the editor environment');

    const bridge = new PhotopeaBridge(iframe);
    await bridge.waitForReady();

    setStatus('loading', 'Loading images…');

    // Load images sequentially via app.open(url).
    // Photopea fetches each image from its iframe origin (CORS allows
    // www.photopea.com on the R2 bucket). Each runScript call is
    // serialized through the bridge's queue with exactly one "done".
    let loadedCount = 0;
    for (let i = 0; i < imageUrls.length; i++) {
      const dir = directions[i];
      const url = imageUrls[i];

      setLoading(`Loading image ${i + 1}/${imageUrls.length}…`, `${directionLabel(dir)}`);
      updateImageStatus(dir, 'loading', '◌');
      updateProgress(i, imageUrls.length);

      try {
        await bridge.runScript(`app.open("${url}");`);
        updateImageStatus(dir, 'loaded', '✓');
        loadedCount++;
      } catch (err) {
        console.error(`[Editor] Failed to load ${dir}:`, err);
        updateImageStatus(dir, 'error', '✗');
        // Continue loading other images
      }
    }

    updateProgress(loadedCount, imageUrls.length);

    // Run acreage script if acreage is provided and at least one image loaded
    if (state.acreage && loadedCount > 0) {
      setLoading('Adding acreage text…', `${state.acreage} ACRES`);
      try {
        await bridge.runScript(acreageScript(state.acreage, loadedCount));
      } catch (err) {
        console.error('[Editor] Acreage script failed:', err);
      }
    }

    // Handle zero-image case — show error state instead of "Ready"
    if (loadedCount === 0) {
      setStatus('error', 'No images');
      setLoading(
        '⚠️ No images found',
        'None of the expected images exist in storage yet. The images may not have been uploaded for this order.'
      );
      // Don't hide the loading overlay — keep the error message visible
      // Don't enable save/fulfill buttons — nothing to save
      return;
    }

    // Ready!
    setStatus('ready', 'Ready');
    hideLoading();

    // Enable save button
    saveBtn.disabled = false;

    // Enable fulfill button if we have an ID
    if (state.fulfillmentId) {
      fulfillBtn.disabled = false;
    }

    // ── Wire up Save Button ────────────────────────────────
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const originalHTML = saveBtn.innerHTML;

      saveBtn.innerHTML = spinnerIcon() + 'Saving…';

      try {
        // Trigger Photopea to save the active document.
        // Because we loaded Photopea with a server config hash,
        // saveToOE() POSTs the PNG directly to the webhook URL.
        await bridge.saveToServer('png');

        saveBtn.innerHTML = checkIcon() + 'Saved!';
        saveBtn.classList.add('btn--saved');

        setTimeout(() => {
          saveBtn.innerHTML = originalHTML;
          saveBtn.classList.remove('btn--saved');
          saveBtn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error('[Editor] Save failed:', err);
        alert(`Save failed: ${err.message}`);
        saveBtn.innerHTML = originalHTML;
        saveBtn.disabled = false;
      }
    });

    // ── Wire up Fulfill Button ─────────────────────────────
    fulfillBtn.addEventListener('click', async () => {
      if (!state.fulfillmentId) {
        alert('No fulfillment ID found in URL.');
        return;
      }

      if (!confirm('Are you sure you want to approve and fulfill this order in SureCart? This action is irreversible.')) {
        return;
      }

      fulfillBtn.disabled = true;
      const originalHTML = fulfillBtn.innerHTML;
      fulfillBtn.innerHTML = spinnerIcon() + 'Fulfilling…';

      try {
        const response = await fetch(CONFIG.WEBHOOK_FULFILL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fulfillment_id: state.fulfillmentId }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || `Server returned ${response.status}`);
        }

        fulfillBtn.innerHTML = checkIcon() + 'Fulfilled!';
        // Keep disabled — fulfillment is irreversible
      } catch (err) {
        console.error('[Editor] Fulfillment failed:', err);
        alert(`Fulfillment failed: ${err.message}`);
        fulfillBtn.innerHTML = originalHTML;
        fulfillBtn.disabled = false;
      }
    });

  } catch (err) {
    console.error('[Editor] Init failed:', err);
    setStatus('error', 'Error');
    showFatalError('❌ Failed to Load', err.message, window.location.href);
  }
}

// ── UI Helpers ──────────────────────────────────────────────────────

function setStatus(state, text) {
  statusDot.className = `status-dot status-dot--${state}`;
  statusText.textContent = text;
}

function setLoading(text, subtext) {
  if (loadingText) loadingText.textContent = text;
  if (loadingSubtext) loadingSubtext.textContent = subtext || '';
}

function hideLoading() {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  if (current >= total) {
    progressFill.classList.add('progress-bar__fill--complete');
    progressText.textContent = `All ${total} images loaded`;
  } else if (current > 0) {
    progressText.textContent = `${current} of ${total} images loaded`;
  } else {
    progressText.textContent = `0 of ${total} images loaded`;
  }
}

function updateImageStatus(direction, status, icon) {
  const el = document.getElementById(`img-${direction}`);
  if (!el) return;
  el.className = `image-item image-item--${status}`;
  el.querySelector('.image-item__icon').textContent = icon;
}

function dataRow(label, value, modifier) {
  const cls = modifier ? ` data-row__value--${modifier}` : '';
  return `<div class="data-row">
    <span class="data-row__label">${label}</span>
    <span class="data-row__value${cls}">${value}</span>
  </div>`;
}

function showFatalError(title, message, detail) {
  const overlay = loadingOverlay || document.body;
  overlay.classList?.remove('hidden');
  overlay.innerHTML = `
    <div class="error-card">
      <h2>${title}</h2>
      <p>${message}</p>
      ${detail ? `<code>${detail}</code>` : ''}
      <p style="margin-top: 1rem;">
        <a href="${window.location.href}">Reload</a> or check the browser console.
      </p>
    </div>
  `;
}

function spinnerIcon() {
  return `<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
    <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
    <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
  </svg>`;
}

function checkIcon() {
  return `<svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
}

// ── Start ───────────────────────────────────────────────────────────
init();
