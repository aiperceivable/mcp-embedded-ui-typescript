import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_resolved = typeof __dirname !== "undefined"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

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

function buildProjectLink(projectName?: string, projectUrl?: string): string {
  if (!projectName && !projectUrl) return "";
  const name = escapeHtml(projectName ?? "");
  if (projectUrl) {
    const url = escapeHtml(projectUrl);
    return ` &middot; <a href="${url}" style="color:#888;text-decoration:none" target="_blank" rel="noopener">${name}</a>`;
  }
  return ` &middot; ${name}`;
}

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
