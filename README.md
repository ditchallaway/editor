# BrokerTricks Property Editor

The human-in-the-loop editor for reviewing and adjusting property images before order fulfillment. Built on [Photopea](https://www.photopea.com)'s iframe postMessage API.

## Architecture

```
n8n workflow                     Editor (this repo)                   Photopea (iframe)
─────────────                    ──────────────────                   ─────────────────
PrepareConfiguration             index.html + js/                    www.photopea.com
  ↓ generates short URL            ↓ parses params
  ↓ (~150 chars)                   ↓ derives image URLs
  ↓                                ↓ fetches from R2 (ArrayBuffer)
ShortenEditorUrl (Sink)            ↓ sends via postMessage ──────────→ opens as documents
  ↓                                ↓ runs acreage script ────────────→ adds text layers
  ↓ shortLink in notification      ↓
  ↓                                ↓ Save button ────────────────────→ saveToOE("png")
Human clicks link ──────────────→ ↓                                  → POSTs to webhook
                                   ↓ Fulfill button ──→ webhook/fulfill
```

## URL Parameters

| Param | Required | Example | Description |
|-------|----------|---------|-------------|
| `customer_id` | ✅ | `cust_42` | R2 path segment |
| `order_id` | ✅ | `order_abc123` | R2 path segment |
| `pack` | ✅ | `full` | Product pack type (see below) |
| `acreage` | ❌ | `5.2` | Auto-added as yellow text layer |
| `fulfillment_id` | ❌ | `ful_xyz` | Enables the Fulfill button |
| `county` | ❌ | `Kern` | Shown in sidebar |
| `elevation` | ❌ | `2847` | Shown in sidebar |
| `lat` | ❌ | `35.37` | Shown in sidebar |
| `lon` | ❌ | `-118.95` | Shown in sidebar |

### Pack Types

| Pack | Images | Directions |
|------|--------|------------|
| `overhead_only` | 1 | overhead |
| `overhead_north` | 2 | overhead, north |
| `full` | 5 | overhead, north, east, south, west |

### Example URL

```
https://app.brokertricks.com/editor/?customer_id=cust_42&order_id=order_abc&pack=full&acreage=5.2&fulfillment_id=ful_xyz
```

## File Structure

```
editor/
├── index.html              Main editor page
├── css/
│   └── editor.css          Dark theme, sidebar, progress bar
├── js/
│   ├── config.js           URLs, pack map, script templates
│   ├── photopea-bridge.js  postMessage API wrapper
│   └── editor.js           Main orchestration
└── README.md
```

## How It Works

1. **Parse params** — `editor.js` reads the URL query params
2. **Derive images** — Maps `pack` → directions → R2 image URLs via conventions in `config.js`
3. **Load Photopea** — Iframe loads `photopea.com` with a minimal hash containing only the `server` config (for save-to-webhook)
4. **Load images** — Fetches each image from R2 as `ArrayBuffer`, sends to Photopea via `postMessage`
5. **Add acreage** — Runs ExtendScript via `postMessage` to add yellow text layer
6. **Save** — Calls `saveToOE("png")` which POSTs directly to the n8n webhook (via Photopea's built-in server config)
7. **Fulfill** — Separate button, POSTs `{ fulfillment_id }` to the fulfill webhook

## Deployment

This repo is cloned to the VPS web root for `app.brokertricks.com/editor/` (managed by CloudPanel). A GitHub webhook triggers an auto-pull on push.

```bash
# On the VPS (already set up):
cd /path/to/webroot/editor
git pull --ff-only
```

## Development

Open `index.html` locally with test params:

```
index.html?customer_id=cust_test&order_id=order_test&pack=overhead_only&acreage=5.0
```

The Photopea iframe will load. Image fetches will fail (no real R2 data) but the UI, sidebar, and controls can be tested.

## Photopea postMessage API

The `PhotopeaBridge` class (`js/photopea-bridge.js`) wraps the protocol:

- **`bridge.waitForReady()`** — resolves when Photopea sends its init `"done"`
- **`bridge.loadFile(arrayBuffer)`** — opens a file as a new document tab
- **`bridge.runScript(script)`** — executes ExtendScript inside Photopea
- **`bridge.saveToServer(format)`** — triggers `saveToOE` which POSTs to the configured server URL
- **`bridge.exportActiveDocument(format)`** — for client-side export (without server config)

Operations are serialized — each waits for `"done"` before the next runs.