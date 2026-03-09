/**
 * Core route handler and app factories for mcp-embedded-ui.
 *
 * Framework-agnostic — works with any HTTP server that can dispatch
 * by method + pathname (Node http, Express, Hono, etc.).
 */

import { renderExplorerHtml } from "./html.js";
import type {
  CallResult,
  IncomingRequest,
  TextContent,
  Tool,
  ToolCallHandler,
  ToolsProvider,
  UIConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveTools(tools: ToolsProvider): Promise<Tool[]> {
  if (Array.isArray(tools)) return tools;
  const result = tools();
  return result instanceof Promise ? await result : result;
}

function toolSummary(tool: Tool): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: tool.name,
    description: tool.description,
  };
  if (tool.annotations) {
    result.annotations = tool.annotations;
  }
  return result;
}

function toolDetail(tool: Tool): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
  if (tool.annotations) {
    result.annotations = tool.annotations;
  }
  return result;
}

async function resolveToolsByName(
  tools: ToolsProvider,
): Promise<Map<string, Tool>> {
  const list = await resolveTools(tools);
  const map = new Map<string, Tool>();
  for (const t of list) {
    map.set(t.name, t);
  }
  return map;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function doCall(
  name: string,
  body: Record<string, unknown>,
  handler: ToolCallHandler,
): Promise<Response> {
  try {
    const [content, isError, traceId] = await handler(name, body);
    const result: CallResult = { content, isError };
    if (traceId) {
      result._meta = { _trace_id: traceId };
    }
    return jsonResponse(result, isError ? 500 : 200);
  } catch (exc: unknown) {
    console.warn("[mcp-embedded-ui] call_tool error for %s: %s", name, exc);
    const message = exc instanceof Error ? exc.message : String(exc);
    return jsonResponse(
      {
        content: [{ type: "text", text: message } satisfies TextContent],
        isError: true,
      },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Route handler type
// ---------------------------------------------------------------------------

/** A single route definition returned by `buildUIRoutes`. */
export interface Route {
  method: "GET" | "POST";
  /** Pattern like `/`, `/meta`, `/tools`, `/tools/:name`, `/tools/:name/call`. */
  pattern: string;
  handler: (req: IncomingRequest, params: Record<string, string>) => Promise<Response>;
}

// ---------------------------------------------------------------------------
// Route builder (low-level)
// ---------------------------------------------------------------------------

/**
 * Build an array of route definitions for the MCP Embedded UI.
 *
 * Each route has a `method`, `pattern`, and async `handler` function.
 * The caller is responsible for matching incoming requests and extracting
 * path parameters.
 */
export function buildUIRoutes(
  tools: ToolsProvider,
  handleCall: ToolCallHandler,
  config: UIConfig = {},
): Route[] {
  const {
    allowExecute = true,
    authHook,
    title = "MCP Tool Explorer",
  } = config;

  const htmlPage = renderExplorerHtml(title);

  const explorerPage: Route = {
    method: "GET",
    pattern: "/",
    handler: async () => htmlResponse(htmlPage),
  };

  const meta: Route = {
    method: "GET",
    pattern: "/meta",
    handler: async () =>
      jsonResponse({ title, allow_execute: allowExecute }),
  };

  const listTools: Route = {
    method: "GET",
    pattern: "/tools",
    handler: async () => {
      const list = await resolveTools(tools);
      return jsonResponse(list.map(toolSummary));
    },
  };

  const toolDetailRoute: Route = {
    method: "GET",
    pattern: "/tools/:name",
    handler: async (_req, params) => {
      const byName = await resolveToolsByName(tools);
      const tool = byName.get(params.name);
      if (!tool) {
        return jsonResponse({ error: `Tool not found: ${params.name}` }, 404);
      }
      return jsonResponse(toolDetail(tool));
    },
  };

  const callTool: Route = {
    method: "POST",
    pattern: "/tools/:name/call",
    handler: async (req, params) => {
      if (!allowExecute) {
        return jsonResponse({ error: "Tool execution is disabled." }, 403);
      }

      const byName = await resolveToolsByName(tools);
      const tool = byName.get(params.name);
      if (!tool) {
        return jsonResponse({ error: `Tool not found: ${params.name}` }, 404);
      }

      let body: Record<string, unknown> = {};
      if ("body" in req && req.body != null) {
        try {
          body =
            typeof req.body === "string"
              ? JSON.parse(req.body as string)
              : (req.body as Record<string, unknown>);
        } catch {
          body = {};
        }
      }

      if (authHook) {
        try {
          return await authHook(req, () => doCall(params.name, body, handleCall));
        } catch (err: unknown) {
          console.warn("[mcp-embedded-ui] Auth hook failed for tool %s: %s", params.name, err);
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
      }

      return doCall(params.name, body, handleCall);
    },
  };

  return [explorerPage, meta, listTools, callTool, toolDetailRoute];
}

// ---------------------------------------------------------------------------
// High-level: standalone request handler
// ---------------------------------------------------------------------------

/**
 * Create a standalone request handler for the MCP Embedded UI.
 *
 * Returns a function compatible with the Web Fetch API `Request`/`Response`:
 * ```ts
 * const handler = createHandler(tools, handleCall);
 * const response = await handler(request);
 * ```
 *
 * Works natively with Bun, Deno, Cloudflare Workers, and any framework
 * that supports Web `Request`/`Response` (Hono, SvelteKit, etc.).
 */
export function createHandler(
  tools: ToolsProvider,
  handleCall: ToolCallHandler,
  config: UIConfig = {},
): (req: Request, prefix?: string) => Promise<Response> {
  const routes = buildUIRoutes(tools, handleCall, config);

  return async (req: Request, prefix = ""): Promise<Response> => {
    const url = new URL(req.url);
    let pathname = url.pathname;
    if (prefix && pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length) || "/";
    }
    // Normalize: strip trailing slash (except root)
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    for (const route of routes) {
      if (req.method !== route.method) continue;

      const params = matchRoute(route.pattern, pathname);
      if (params === null) continue;

      // Convert Web Request to IncomingRequest shape
      const incomingReq: IncomingRequest & { body?: unknown } = {
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
      };

      if (req.method === "POST") {
        try {
          incomingReq.body = await req.json();
        } catch {
          incomingReq.body = {};
        }
      }

      return route.handler(incomingReq, params);
    }

    return new Response("Not Found", { status: 404 });
  };
}

/**
 * Create a Node.js-compatible HTTP request handler.
 *
 * Usage with `node:http`:
 * ```ts
 * import http from "node:http";
 * const handle = createNodeHandler(tools, handleCall);
 * http.createServer(handle).listen(3000);
 * ```
 */
export function createNodeHandler(
  tools: ToolsProvider,
  handleCall: ToolCallHandler,
  config: UIConfig & { prefix?: string } = {},
): (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => void {
  const { prefix = "", ...uiConfig } = config;
  const routes = buildUIRoutes(tools, handleCall, uiConfig);

  return (req, res) => {
    void (async () => {
      let pathname = req.url ?? "/";
      // Strip query string
      const qIdx = pathname.indexOf("?");
      if (qIdx !== -1) pathname = pathname.slice(0, qIdx);
      // Strip prefix
      if (prefix && pathname.startsWith(prefix)) {
        pathname = pathname.slice(prefix.length) || "/";
      }
      // Normalize trailing slash
      if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }

      const method = (req.method ?? "GET").toUpperCase();

      for (const route of routes) {
        if (method !== route.method) continue;

        const params = matchRoute(route.pattern, pathname);
        if (params === null) continue;

        const incomingReq: IncomingRequest & { body?: unknown } = {
          method,
          url: req.url,
          headers: req.headers as Record<string, string | string[] | undefined>,
        };

        if (method === "POST") {
          incomingReq.body = await readJsonBody(req);
        }

        const response = await route.handler(incomingReq, params);
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(await response.text());
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
    })().catch((err: unknown) => {
      console.warn("[mcp-embedded-ui] Unhandled error in Node handler:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Internal: route matching & body reading
// ---------------------------------------------------------------------------

function matchRoute(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i];
    const val = pathParts[i];
    if (pat.startsWith(":")) {
      params[pat.slice(1)] = decodeURIComponent(val);
    } else if (pat !== val) {
      return null;
    }
  }
  return params;
}

function readJsonBody(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use {@link buildUIRoutes} instead.
 */
export function buildMcpUIRoutes(
  tools: ToolsProvider,
  handleCall: ToolCallHandler,
  config: UIConfig = {},
): Route[] {
  console.warn(
    "buildMcpUIRoutes is deprecated, use buildUIRoutes instead",
  );
  return buildUIRoutes(tools, handleCall, config);
}
