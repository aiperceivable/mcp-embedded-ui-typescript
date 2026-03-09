# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-03-09

### Added

- Core route builder (`buildUIRoutes`) with 5 endpoints:
  - `GET /` — self-contained HTML explorer page
  - `GET /meta` — JSON config (`allow_execute`, `title`)
  - `GET /tools` — tool summary list
  - `GET /tools/{name}` — tool detail with input schema
  - `POST /tools/{name}/call` — tool execution
- `createHandler()` — Web Fetch API-compatible handler (Bun, Deno, Hono, Cloudflare Workers)
- `createNodeHandler()` — Node.js `http.createServer` compatible handler
- Dynamic tools support — static array, sync function, or async function
- Auth hook — middleware pattern `(req, next) => Promise<Response>`
- Configurable title with XSS-safe HTML escaping
- `annotations` field omitted (not `null`) when absent
- `_meta` with `_trace_id` omitted when trace ID is empty
- `allowExecute=false` blocks at handler level, not just UI
- Auth error responses return only `{"error": "Unauthorized"}` — no detail leaking
- Zero runtime dependencies
- 30+ tests covering all endpoints, auth, dynamic tools, security, and exports
