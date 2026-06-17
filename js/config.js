/**
 * Editor Configuration
 *
 * Central source of truth for URLs, pack mappings, and script templates.
 * All conventions previously embedded in n8n's PrepareConfiguration node
 * now live here, on the editor host.
 */

export const CONFIG = Object.freeze({
  // ── Endpoints ────────────────────────────────────────
  R2_BASE: 'https://pics.brokertricks.com',
  WEBHOOK_BUCKET: 'https://auto.brokertricks.com/webhook/bucket',
  WEBHOOK_FULFILL: 'https://auto.brokertricks.com/webhook/fulfill',
  PHOTOPEA_URL: 'https://www.photopea.com',

  // ── Pack → Directions ────────────────────────────────
  // Maps product pack names to their constituent image directions.
  // Image filename convention: property_{direction}.png
  PACK_MAP: Object.freeze({
    overhead_only: ['overhead'],
    overhead_north: ['overhead', 'north'],
    full: ['overhead', 'north', 'east', 'south', 'west'],
  }),
});

/**
 * Build the R2 image URL for a specific direction.
 * @param {string} customerId
 * @param {string} orderId
 * @param {string} direction
 * @returns {string}
 */
export function imageUrl(customerId, orderId, direction) {
  const ts = Date.now();
  return `${CONFIG.R2_BASE}/${customerId}/${orderId}/property_${direction}.png?t=${ts}`;
}

/**
 * Build the Photopea server config for the save callback.
 * Encodes as a URI-safe hash fragment for the iframe src.
 * @param {string} customerId
 * @param {string} orderId
 * @returns {string} — hash string including the leading #
 */
export function buildServerHash(customerId, orderId) {
  const serverConfig = {
    server: {
      url: `${CONFIG.WEBHOOK_BUCKET}?customer_id=${encodeURIComponent(customerId)}&order_id=${encodeURIComponent(orderId)}`,
      formats: ['png'],
    },
  };
  return '#' + encodeURIComponent(JSON.stringify(serverConfig));
}

/**
 * Build the ExtendScript that adds an acreage text layer to every open document.
 * Yellow (#FFFF00), 120pt, positioned at [100, 200].
 * @param {string|number} acreage
 * @param {number} docCount
 * @returns {string}
 */
export function acreageScript(acreage, docCount) {
  return `
    var acreageText = "${acreage} ACRES";
    for (var i = 0; i < ${docCount}; i++) {
      app.activeDocument = app.documents[i];
      var t = app.activeDocument.artLayers.add();
      t.kind = LayerKind.TEXT;
      t.textItem.contents = acreageText;
      t.textItem.size = 120;
      var c = new SolidColor();
      c.rgb.hexValue = "FFFF00";
      t.textItem.color = c;
      t.textItem.position = [100, 200];
    }
  `.trim().replace(/\s+/g, ' ');
}

/**
 * Human-readable label for a pack type.
 * @param {string} pack
 * @returns {string}
 */
export function packLabel(pack) {
  const labels = {
    overhead_only: 'Overhead Only',
    overhead_north: 'Overhead + North',
    full: 'Full (5 directions)',
  };
  return labels[pack] || pack;
}

/**
 * Human-readable label for a direction.
 * @param {string} direction
 * @returns {string}
 */
export function directionLabel(direction) {
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}
