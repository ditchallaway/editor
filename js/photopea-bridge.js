/**
 * PhotopeaBridge — Promise-based wrapper for Photopea's postMessage API.
 *
 * Photopea communicates via the browser's postMessage protocol:
 *   Send a String      → executed as ExtendScript inside Photopea
 *   Send an ArrayBuffer → opened as a file (PSD, PNG, JPG, etc.)
 *   Photopea replies    → data (ArrayBuffer/String) followed by "done"
 *
 * All operations are serialized — each waits for "done" before the next runs.
 *
 * Usage:
 *   const bridge = new PhotopeaBridge(document.getElementById('pp'));
 *   await bridge.waitForReady();
 *   await bridge.runScript('app.open("https://example.com/img.png");');
 *   await bridge.runScript('app.activeDocument.rotateCanvas(90);');
 */
export class PhotopeaBridge {
  /** @type {HTMLIFrameElement} */
  #iframe;

  /**
   * Queue of pending operations. Each entry:
   *   { resolve: Function, data: any }
   * The `data` field captures any non-"done" message (e.g., ArrayBuffer from export).
   * @type {Array<{resolve: Function, data: *}>}
   */
  #queue = [];

  /** @type {Function|null} */
  #readyResolve = null;

  /** @type {Promise<void>} */
  #readyPromise;

  /**
   * @param {HTMLIFrameElement} iframeElement — must already have its `src` set
   */
  constructor(iframeElement) {
    this.#iframe = iframeElement;

    // Capture the initialization "done" Photopea sends when fully loaded.
    // This promise is set up before the iframe starts loading so we never miss it.
    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });

    window.addEventListener('message', (e) => this.#onMessage(e));
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Resolves when Photopea has fully initialized (first "done" message).
   * Always call this before sending any commands.
   * @returns {Promise<void>}
   */
  waitForReady() {
    return this.#readyPromise;
  }

  /**
   * Open a file in Photopea by sending its binary data.
   * Creates a new document tab for the file.
   * @param {ArrayBuffer} arrayBuffer — raw file bytes (PNG, PSD, JPG, etc.)
   * @returns {Promise<void>}
   */
  async loadFile(arrayBuffer) {
    return this.#send(arrayBuffer);
  }

  /**
   * Execute an ExtendScript string inside Photopea.
   * @param {string} script — valid ExtendScript / JavaScript code
   * @returns {Promise<*>} — resolves with any data sent before "done", or null
   */
  async runScript(script) {
    return this.#send(script);
  }

  /**
   * Export the active document and receive the file data.
   * Only works when Photopea has NO server config (no hash `server` field).
   * With a server config, use runScript('app.activeDocument.saveToOE("png")') instead.
   * @param {string} format — "png", "jpg", "psd", "gif", etc.
   * @returns {Promise<ArrayBuffer>} — the exported file data
   */
  async exportActiveDocument(format = 'png') {
    return this.#send(`app.activeDocument.saveToOE("${format}");`);
  }

  /**
   * Trigger a save to the configured server (from the URL hash `server` field).
   * Photopea POSTs the file directly to the server URL.
   * Resolves when the save completes (receives "done").
   * @param {string} format — "png", "jpg", etc.
   * @returns {Promise<void>}
   */
  async saveToServer(format = 'png') {
    return this.#send(`app.activeDocument.saveToOE("${format}");`);
  }

  // ── Internals ──────────────────────────────────────────

  /**
   * Central message handler. Routes messages from the Photopea iframe.
   * @param {MessageEvent} event
   */
  #onMessage(event) {
    // Ignore messages from other sources
    if (event.source !== this.#iframe.contentWindow) return;

    const msg = event.data;

    // Phase 1: waiting for Photopea initialization
    if (this.#readyResolve !== null) {
      if (msg === 'done') {
        const resolve = this.#readyResolve;
        this.#readyResolve = null;
        resolve();
      }
      return;
    }

    // Phase 2: processing queued operations
    const handler = this.#queue[0];
    if (!handler) return;

    if (msg === 'done') {
      this.#queue.shift();
      handler.resolve(handler.data);
    } else {
      // Data message (ArrayBuffer for exports, string for echoToOE)
      handler.data = msg;
    }
  }

  /**
   * Send a message to Photopea and return a Promise that resolves on "done".
   * @param {string|ArrayBuffer} message
   * @returns {Promise<*>}
   */
  #send(message) {
    return new Promise((resolve) => {
      this.#queue.push({ resolve, data: null });
      this.#iframe.contentWindow.postMessage(message, '*');
    });
  }
}
