import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_resolved = typeof __dirname !== "undefined"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

/**
 * The raw HTML template.
 *
 * @deprecated Implementation detail, not part of the public surface (F5).
 * Python and Rust keep the equivalent private. Scheduled for removal in the
 * next minor release — customise the page via `title` / `projectName` /
 * `projectUrl` instead.
 */
export const EXPLORER_HTML_TEMPLATE = readFileSync(
  join(__dirname_resolved, "explorer.html"),
  "utf-8",
);

const DEFAULT_TITLE = "MCP Tool Explorer";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const ALLOWED_URL_SCHEMES = ["http://", "https://", "mailto:"];

/**
 * Whether `url` may be placed in an `href`.
 *
 * HTML escaping alone does not neutralise `javascript:` — that string contains
 * no character an escaper would touch. Browsers also ignore TAB/LF/CR and
 * surrounding whitespace while resolving a scheme, so `java\tscript:alert(1)`
 * resolves to `javascript:alert(1)`; strip those before testing, not after.
 * See PROTOCOL.md security checklist.
 */
function isSafeUrl(url: string): boolean {
  const cleaned = url.replace(/[\t\n\r]/g, "").trim();
  if (cleaned.startsWith("/")) return true;
  const lowered = cleaned.toLowerCase();
  return ALLOWED_URL_SCHEMES.some((scheme) => lowered.startsWith(scheme));
}

function buildProjectLink(projectName?: string, projectUrl?: string): string {
  if (!projectName && !projectUrl) return "";
  const name = escapeHtml(projectName ?? "");
  if (projectUrl && isSafeUrl(projectUrl)) {
    const url = escapeHtml(projectUrl);
    return ` &middot; <a href="${url}" style="color:#888;text-decoration:none" target="_blank" rel="noopener">${name}</a>`;
  }
  return ` &middot; ${name}`;
}

/**
 * Render the explorer page.
 *
 * @deprecated Implementation detail, not part of the public surface (F5).
 * Python and Rust keep the equivalent private. Scheduled for removal in the
 * next minor release — customise the page via `title` / `projectName` /
 * `projectUrl` instead.
 */
export function renderExplorerHtml(
  title: string = DEFAULT_TITLE,
  allowExecute: boolean = false,
  projectName?: string,
  projectUrl?: string,
): string {
  const escaped = escapeHtml(title);
  return EXPLORER_HTML_TEMPLATE
    .replace(/{{TITLE}}/g, () => escaped)
    .replace(/{{ALLOW_EXECUTE}}/g, () => (allowExecute ? "true" : "false"))
    .replace(/{{PROJECT_LINK}}/g, () => buildProjectLink(projectName, projectUrl));
}
