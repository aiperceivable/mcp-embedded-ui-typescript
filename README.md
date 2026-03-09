# mcp-embedded-ui (TypeScript)

The TypeScript implementation of [mcp-embedded-ui](https://github.com/aipartnerup/mcp-embedded-ui) — a browser-based tool explorer for any [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server.

## What is this?

If you build an MCP server in TypeScript/JavaScript, your users interact with tools through raw JSON — no visual feedback, no schema browser, no quick way to test. This library adds a full browser UI to your server with **zero dependencies and one function call**.

```
┌───────────────────────────────────┐
│  Browser                          │
│  Tool list → Schema → Try it      │
└──────────────┬────────────────────┘
               │ HTTP / JSON
┌──────────────▼────────────────────┐
│  Your TypeScript MCP Server       │
│  + mcp-embedded-ui                │
│    (Node / Bun / Deno / Hono)     │
└───────────────────────────────────┘
```

## What does the UI provide?

- **Tool list** — browse all registered tools with descriptions and annotation badges
- **Schema inspector** — expand any tool to view its full JSON Schema (`inputSchema`)
- **Try-it console** — type JSON arguments, execute the tool, see results instantly
- **cURL export** — copy a ready-made cURL command for any execution
- **Auth support** — enter a Bearer token in the UI, sent with all requests

No build step. No CDN. No external dependencies. The entire UI is a single self-contained HTML page embedded in the package.

## Install

```bash
npm install mcp-embedded-ui
```

Requires Node.js 18+ (or Bun/Deno with Web API support). **Zero runtime dependencies.**

## Quick Start

### Web Fetch API (Bun, Deno, Hono, Cloudflare Workers)

```ts
import { createHandler } from "mcp-embedded-ui";

const handler = createHandler(tools, handleCall, { title: "My Explorer" });

// Use with any framework that supports Request/Response:
// Bun.serve({ fetch: (req) => handler(req, "/explorer") });
// Deno.serve((req) => handler(req, "/explorer"));
```

### Node.js http

```ts
import http from "node:http";
import { createNodeHandler } from "mcp-embedded-ui";

const handle = createNodeHandler(tools, handleCall, {
  prefix: "/explorer",
  title: "My Explorer",
});

http.createServer(handle).listen(3000);
// Visit http://localhost:3000/explorer
```

### Full working example

```ts
import http from "node:http";
import { createNodeHandler } from "mcp-embedded-ui";
import type { Tool, ToolCallHandler } from "mcp-embedded-ui";

// 1. Define your tools
const tools: Tool[] = [
  {
    name: "greet",
    description: "Say hello",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
  },
];

// 2. Define a handler: (name, args) -> [content, isError, traceId?]
const handleCall: ToolCallHandler = async (name, args) => {
  if (name === "greet") {
    return [
      [{ type: "text", text: `Hello, ${args.name ?? "world"}!` }],
      false,
      undefined,
    ];
  }
  return [[{ type: "text", text: `Unknown tool: ${name}` }], true, undefined];
};

// 3. Create and start the server
const handle = createNodeHandler(tools, handleCall, { prefix: "/explorer" });
http.createServer(handle).listen(3000);
```

### With auth hook

```ts
import type { AuthHook } from "mcp-embedded-ui";

const authHook: AuthHook = async (req, next) => {
  const token = req.headers["authorization"] ?? "";
  if (typeof token !== "string" || !token.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  // Verify the token with your own logic (JWT, API key, session, etc.)
  return next();
};

// Pass authHook to enable, omit to disable
const handle = createNodeHandler(tools, handleCall, {
  prefix: "/explorer",
  authHook,
});
```

Auth only guards `POST /tools/{name}/call`. Discovery endpoints are always public. The UI has a built-in token input field — enter your Bearer token there and it's sent with every execution request.

The included demo (`examples/node-demo.ts`) uses a hardcoded `Bearer demo-secret-token` — the token is printed at startup so you know what to paste into the UI.

### Dynamic tools

```ts
// Sync function — re-evaluated on every request
function getTools(): Tool[] {
  return registry.listTools();
}

// Async function
async function getTools(): Promise<Tool[]> {
  return await registry.asyncListTools();
}

const handler = createHandler(getTools, handleCall);
```

## API

### Three-tier API

| Function | Returns | Use case |
|----------|---------|----------|
| `createHandler(tools, handleCall, config?)` | `(req: Request, prefix?) => Promise<Response>` | Bun, Deno, Hono, Cloudflare Workers |
| `createNodeHandler(tools, handleCall, config?)` | `(req, res) => void` | Node.js `http.createServer` |
| `buildUIRoutes(tools, handleCall, config?)` | `Route[]` | Power users — fine-grained route control |

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tools` | `Tool[] \| () => Tool[] \| () => Promise<Tool[]>` | _required_ | MCP Tool objects |
| `handleCall` | `ToolCallHandler` | _required_ | `async (name, args) => [content, isError, traceId?]` |
| `allowExecute` | `boolean` | `true` | Enable/disable tool execution (enforced server-side) |
| `authHook` | `AuthHook` | — | Middleware: `(req, next) => Promise<Response>` |
| `title` | `string` | `"MCP Tool Explorer"` | Page title (HTML-escaped automatically) |

### Auth Hook

The `authHook` is a middleware function that receives the request and a `next` function. Throw to reject with 401. The error response is always `{"error": "Unauthorized"}` — internal details are never leaked.

```ts
const authHook: AuthHook = async (req, next) => {
  const token = req.headers["authorization"];
  if (!token || !isValid(token)) {
    throw new Error("Bad token");
  }
  return next();
};
```

Auth only guards `POST /tools/{name}/call`. Discovery endpoints (`GET /tools`, `GET /tools/{name}`, `GET /meta`) are always public.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Self-contained HTML explorer page |
| GET | `/meta` | JSON config — `{ title, allow_execute }` |
| GET | `/tools` | Summary list of all tools |
| GET | `/tools/{name}` | Full tool detail with `inputSchema` |
| POST | `/tools/{name}/call` | Execute a tool, returns MCP `CallToolResult` |

## Development

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit

# Run tests
npx vitest run

# Run the demo (auth enabled with a demo token)
npx tsx examples/node-demo.ts
# Visit http://localhost:3000/explorer
# Paste "Bearer demo-secret-token" in the UI's token field to execute tools
```

## Cross-Language Specification

This package implements the [mcp-embedded-ui](https://github.com/aipartnerup/mcp-embedded-ui) specification. The spec repo contains:

- [PROTOCOL.md](https://github.com/aipartnerup/mcp-embedded-ui/blob/main/docs/PROTOCOL.md) — endpoint spec, data shapes, security checklist
- [explorer.html](https://github.com/aipartnerup/mcp-embedded-ui/blob/main/docs/explorer.html) — shared HTML template (identical across all language implementations)
- [Feature specs](https://github.com/aipartnerup/mcp-embedded-ui/blob/main/docs/features/MANIFEST.md) — detailed requirements and test criteria

## License

Apache-2.0
