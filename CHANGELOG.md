# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-08-20

### Changed

- **BREAKING (spec F6/FR-1): the Try-It editor prefill no longer fabricates values.**
  Synced `explorer.html` from the spec repo at 0.5.0. The prefill now emits exactly
  the keys listed in `inputSchema.required`, using each property's declared
  `default` when it has one and `null` otherwise. Optional properties are omitted
  entirely, generation does not recurse into nested objects, and a schema with no
  `required` prefills `{}`.

  The previous rule invented a type-based value for *every* property
  (`"string"` → `""`, `"number"` → `0`, …), which had two consequences. First,
  size: a 257-property schema produced a 259-line prefill inside a 120px editor.
  Second, and more seriously, it emitted a key for every property and drew every
  value from the declared type, so it satisfied `required` and the type
  constraints unconditionally — making the 0.4.0 Validate button incapable of
  failing on a fresh prefill for any schema. `null` supplies the key without
  asserting a value and is rejected wherever the schema does not admit it.

### Fixed

- **`project_url` is now scheme-checked before being placed in `href`.** Only
  `http://`, `https://`, `mailto:` and a leading `/` are accepted; anything else
  renders the project name as plain text. TAB/LF/CR are stripped and the value
  trimmed before the check, because browsers ignore those while resolving a
  scheme. Not an exploitable vulnerability — `project_url` is deployment
  configuration, not caller input — but HTML escaping alone never stopped
  `javascript:`.

- **`/validate` no longer mishandles a tool whose `inputSchema` cannot be
  compiled.** Such a schema is now reported as a single `keyword: "schema"`
  validation failure at HTTP 200, per the new F7 contract.
  Previously `ajv.compile` threw uncaught and the endpoint answered 500.
- An explicit `default: null` in a schema is now honoured. The previous guard
  (`props[key]['default'] != null`) discarded it and fell through to a fabricated
  type default.

### Added

- **`ValidateResult` and `ValidationFailure` exported from the package root**
  (F7). The private `ValidationError` interface moved to `types.ts` and was
  renamed per the spec — the API returned a shape its own users could not name.

### Deprecated

- **`EXPLORER_HTML_TEMPLATE` and `renderExplorerHtml`** — implementation
  details per F5, kept private by Python and Rust. Scheduled for removal in the
  next minor release; customise the page via `title` / `projectName` /
  `projectUrl`.

### Tests

- Added a `/validate` case for a tool whose `inputSchema` cannot be compiled by
  Ajv — asserts 200 with a single `keyword: "schema"` failure, not a 500.

- Added prefill generation tests covering spec criteria TC-1, TC-17, TC-18, TC-19
  and TC-20. `defaultFromSchema` is extracted from `explorer.html` and executed
  directly, so these exercise the shared template every SDK ships — not a
  re-implementation. TC-20 runs the untouched prefill through `/validate` and
  asserts it is rejected.

## [0.4.0] - 2026-04-28

### Added

- **`POST /tools/:name/validate` endpoint** — implements F7 from the spec. Validates request args against the tool's `inputSchema` without invoking the handler, returns `{valid: true}` or `{valid: false, errors: [...]}`. Not gated by `allowExecute` or `authHook` (per F7 spec). Adds `ajv` + `ajv-formats` dependencies.
- **`explorer.html`** — synced from spec repo; gains the Validate button next to Execute.

### Changed

- `createHandler` and `createNodeHandler` now flag `bodyParseError` on the internal request when JSON parsing fails. The `/call` route still falls back to `{}` (unchanged); the new `/validate` route uses the flag to return 400.

## [0.3.2] - 2026-03-26

### Changed

- Update `explorer.html` — sync cross-language implementation links from relative paths to absolute GitHub URLs.

## [0.3.1] - 2026-03-22

### Changed
- Rebrand: aipartnerup → aiperceivable

## [0.3.0] - 2026-03-11

### Added

- **Dark mode** — theme toggle button with light/dark switching, `localStorage` persistence, and system preference auto-detection (from updated shared HTML template).

### Changed

- **`allowExecute` default changed to `false`** — secure by default; callers must explicitly pass `allowExecute: true` to enable tool execution.
- README and CHANGELOG updated to reflect new default.

## [0.2.0] - 2026-03-10

### Removed

- **`/meta` endpoint** — configuration is now baked into the HTML via `{{ALLOW_EXECUTE}}` template variable.

### Added

- **ToolCallHandler 3-param support** — `handleCall(name, args, request)` is auto-detected via `handler.length`. Existing 2-param handlers continue to work unchanged.
- **`allowExecute`** config option — defaults to `true`; set to `false` to disable tool execution server-side.
- **`projectName` / `projectUrl`** config options — optional footer link for downstream projects (e.g., `projectName: "apcore-mcp"`).
- **`ImageContent` / `Content` types** — `CallResult.content` now accepts `TextContent | ImageContent` instead of `TextContent` only.
- **`ToolCallHandler2` / `ToolCallHandler3` union types** — exported for consumers who need specific handler signatures.
- **Package resource HTML** — `explorer.html` is now shipped as a resource file read via `readFileSync`, replacing the embedded template literal constant.
- **Tool search/filter, multi-content-type rendering, execution time display, cURL escaping fix** — all from updated shared HTML template.

### Changed

- `html.ts` rewritten from ~430 lines to ~46 lines (reads HTML from resource file, builds project link).
- Build script copies `explorer.html` to `dist/` (cross-platform via Node.js `fs.cpSync`).
- `package.json` includes `src/explorer.html` in published files.
- Default port in examples and README changed from 3000 to 8000.
- README updated: removed `/meta` from endpoints table, added `projectName`/`projectUrl` to config parameters.

## [0.1.0] - 2025-12-01

### Added

- Initial implementation with framework-agnostic route builder, Node.js handler, and Web API handler.
- Tool discovery, execution, and auth hook support.
- Express and Hono compatibility.
