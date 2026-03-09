import { describe, it, expect } from "vitest";
import {
  buildMcpUIRoutes,
  buildUIRoutes,
  createHandler,
  EXPLORER_HTML_TEMPLATE,
  renderExplorerHtml,
} from "../src/index.js";
import type {
  AuthHook,
  IncomingRequest,
  TextContent,
  Tool,
  ToolCallHandler,
  ToolsProvider,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeTool(
  name: string,
  description = "",
  inputSchema?: Record<string, unknown>,
  annotations?: Record<string, unknown> | null,
): Tool {
  return {
    name,
    description,
    inputSchema: inputSchema ?? {
      type: "object",
      properties: { msg: { type: "string" } },
    },
    annotations,
  };
}

const TOOLS: Tool[] = [
  fakeTool("echo", "Echo back", undefined, { readOnlyHint: true }),
  fakeTool("boom", "Always errors"),
];

const fakeHandler: ToolCallHandler = async (name, args) => {
  if (name === "echo") {
    return [
      [{ type: "text", text: `echo: ${(args.msg as string) ?? ""}` }],
      false,
      "t1",
    ];
  }
  if (name === "boom") {
    return [[{ type: "text", text: "kaboom" }], true, undefined];
  }
  throw new Error(`Unknown tool: ${name}`);
};

/** Helper: build a handler and make a request against it. */
async function request(
  method: string,
  path: string,
  options: {
    tools?: ToolsProvider;
    handleCall?: ToolCallHandler;
    config?: Parameters<typeof createHandler>[2];
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const handler = createHandler(
    options.tools ?? TOOLS,
    options.handleCall ?? fakeHandler,
    options.config ?? {},
  );

  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (options.headers) {
    init.headers = options.headers;
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { ...init.headers as Record<string, string>, "content-type": "application/json" };
  }

  return handler(new Request(url, init));
}

// ---------------------------------------------------------------------------
// Explorer page
// ---------------------------------------------------------------------------

describe("Explorer page", () => {
  it("returns HTML", async () => {
    const resp = await request("GET", "/");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    const text = await resp.text();
    expect(text).toContain("MCP Tool Explorer");
  });

  it("uses custom title", async () => {
    const resp = await request("GET", "/", {
      config: { title: "My Custom Explorer" },
    });
    const text = await resp.text();
    expect(text).toContain("My Custom Explorer");
    expect(text).not.toContain("MCP Tool Explorer");
  });
});

// ---------------------------------------------------------------------------
// Meta endpoint
// ---------------------------------------------------------------------------

describe("Meta endpoint", () => {
  it("returns config", async () => {
    const resp = await request("GET", "/meta");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.allow_execute).toBe(true);
    expect(data.title).toBe("MCP Tool Explorer");
  });

  it("reflects allowExecute=false", async () => {
    const resp = await request("GET", "/meta", {
      config: { allowExecute: false },
    });
    const data = await resp.json();
    expect(data.allow_execute).toBe(false);
  });

  it("reflects custom title", async () => {
    const resp = await request("GET", "/meta", {
      config: { title: "Custom" },
    });
    const data = await resp.json();
    expect(data.title).toBe("Custom");
  });
});

// ---------------------------------------------------------------------------
// List tools
// ---------------------------------------------------------------------------

describe("List tools", () => {
  it("returns all tools", async () => {
    const resp = await request("GET", "/tools");
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { name: string }[];
    expect(data).toHaveLength(2);
    const names = new Set(data.map((t) => t.name));
    expect(names).toEqual(new Set(["echo", "boom"]));
  });

  it("includes annotations when present", async () => {
    const resp = await request("GET", "/tools");
    const data = (await resp.json()) as { name: string; annotations?: Record<string, unknown> }[];
    const echo = data.find((t) => t.name === "echo");
    expect(echo?.annotations?.readOnlyHint).toBe(true);
  });

  it("omits annotations when absent", async () => {
    const resp = await request("GET", "/tools");
    const data = (await resp.json()) as { name: string; annotations?: unknown }[];
    const boom = data.find((t) => t.name === "boom");
    expect(boom).not.toHaveProperty("annotations");
  });
});

// ---------------------------------------------------------------------------
// Tool detail
// ---------------------------------------------------------------------------

describe("Tool detail", () => {
  it("returns existing tool", async () => {
    const resp = await request("GET", "/tools/echo");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.name).toBe("echo");
    expect(data).toHaveProperty("inputSchema");
  });

  it("returns 404 for missing tool", async () => {
    const resp = await request("GET", "/tools/nonexistent");
    expect(resp.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Call tool
// ---------------------------------------------------------------------------

describe("Call tool", () => {
  it("succeeds with content and trace id", async () => {
    const resp = await request("POST", "/tools/echo/call", {
      body: { msg: "hi" },
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.isError).toBe(false);
    expect(data.content[0].text).toBe("echo: hi");
    expect(data._meta._trace_id).toBe("t1");
  });

  it("returns error call with status 500", async () => {
    const resp = await request("POST", "/tools/boom/call", { body: {} });
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.isError).toBe(true);
  });

  it("returns 404 for missing tool", async () => {
    const resp = await request("POST", "/tools/nope/call", { body: {} });
    expect(resp.status).toBe(404);
  });

  it("treats invalid JSON body as empty dict", async () => {
    const handler = createHandler(TOOLS, fakeHandler);
    const resp = await handler(
      new Request("http://localhost/tools/echo/call", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// allow_execute=false
// ---------------------------------------------------------------------------

describe("Execution disabled", () => {
  it("returns 403 on call", async () => {
    const resp = await request("POST", "/tools/echo/call", {
      body: {},
      config: { allowExecute: false },
    });
    expect(resp.status).toBe(403);
  });

  it("still allows list and detail", async () => {
    const toolsResp = await request("GET", "/tools", {
      config: { allowExecute: false },
    });
    expect(toolsResp.status).toBe(200);

    const detailResp = await request("GET", "/tools/echo", {
      config: { allowExecute: false },
    });
    expect(detailResp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Auth hook
// ---------------------------------------------------------------------------

describe("Auth hook", () => {
  it("passes when auth succeeds", async () => {
    const authHook: AuthHook = async (req, next) => {
      const auth = req.headers["authorization"] ?? "";
      const token = Array.isArray(auth) ? auth[0] : auth;
      if (!token.includes("valid")) {
        throw new Error("bad token");
      }
      return next();
    };

    const resp = await request("POST", "/tools/echo/call", {
      body: { msg: "hi" },
      headers: { Authorization: "Bearer valid-token" },
      config: { authHook },
    });
    expect(resp.status).toBe(200);
  });

  it("returns 401 when auth fails", async () => {
    const authHook: AuthHook = async () => {
      throw new Error("nope");
    };

    const resp = await request("POST", "/tools/echo/call", {
      body: {},
      config: { authHook },
    });
    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error).toContain("Unauthorized");
  });

  it("does not leak auth error details", async () => {
    const authHook: AuthHook = async () => {
      throw new Error("DB connection failed at /var/secrets/db.key");
    };

    const resp = await request("POST", "/tools/echo/call", {
      body: {},
      config: { authHook },
    });
    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error).toBe("Unauthorized");
    expect(JSON.stringify(data)).not.toContain("db.key");
  });

  it("does not invoke auth hook on GET endpoints", async () => {
    let callCount = 0;
    const authHook: AuthHook = async () => {
      callCount++;
      throw new Error("no auth");
    };

    const config = { authHook };
    expect((await request("GET", "/", { config })).status).toBe(200);
    expect((await request("GET", "/meta", { config })).status).toBe(200);
    expect((await request("GET", "/tools", { config })).status).toBe(200);
    expect((await request("GET", "/tools/echo", { config })).status).toBe(200);
    expect(callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trace ID omitted when undefined
// ---------------------------------------------------------------------------

describe("Trace ID", () => {
  it("omits _meta when trace_id is undefined", async () => {
    const resp = await request("POST", "/tools/boom/call", { body: {} });
    const data = await resp.json();
    expect(data).not.toHaveProperty("_meta");
  });
});

// ---------------------------------------------------------------------------
// Dynamic tools (sync callable)
// ---------------------------------------------------------------------------

describe("Sync tools callable", () => {
  it("resolves sync callable tools", async () => {
    let callCount = 0;
    const getTools = (): Tool[] => {
      callCount++;
      return [fakeTool("dynamic", "A dynamic tool")];
    };

    const resp = await request("GET", "/tools", { tools: getTools });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { name: string }[];
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("dynamic");
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("resolves sync callable for tool detail", async () => {
    const getTools = (): Tool[] => [fakeTool("dynamic", "A dynamic tool")];
    const resp = await request("GET", "/tools/dynamic", { tools: getTools });
    expect(resp.status).toBe(200);
    expect((await resp.json()).name).toBe("dynamic");
  });
});

// ---------------------------------------------------------------------------
// Dynamic tools (async callable)
// ---------------------------------------------------------------------------

describe("Async tools callable", () => {
  it("resolves async callable tools", async () => {
    const getTools = async (): Promise<Tool[]> => [
      fakeTool("async-tool", "An async tool"),
    ];

    const resp = await request("GET", "/tools", { tools: getTools });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { name: string }[];
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("async-tool");
  });

  it("resolves async callable for tool call", async () => {
    const getTools = async (): Promise<Tool[]> => [
      fakeTool("echo", "Echo"),
    ];
    const resp = await request("POST", "/tools/echo/call", {
      tools: getTools,
      body: { msg: "hello" },
    });
    expect(resp.status).toBe(200);
    expect((await resp.json()).content[0].text).toBe("echo: hello");
  });
});

// ---------------------------------------------------------------------------
// Handler exception
// ---------------------------------------------------------------------------

describe("Handler exception", () => {
  it("returns 500 with isError when handler throws", async () => {
    const throwingHandler: ToolCallHandler = async () => {
      throw new Error("internal failure");
    };

    const resp = await request("POST", "/tools/echo/call", {
      body: { msg: "hi" },
      handleCall: throwingHandler,
    });
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.isError).toBe(true);
    expect(data.content[0].type).toBe("text");
    expect(data.content[0].text).toContain("internal failure");
  });
});

// ---------------------------------------------------------------------------
// Security: XSS prevention in title
// ---------------------------------------------------------------------------

describe("Title XSS prevention", () => {
  it("escapes script tags in title", async () => {
    const resp = await request("GET", "/", {
      config: { title: '<script>alert("xss")</script>' },
    });
    const text = await resp.text();
    expect(text).not.toContain("<script>alert");
    expect(text).toContain("&lt;script&gt;");
  });

  it("escapes HTML entities in title", async () => {
    const resp = await request("GET", "/", {
      config: { title: 'A & B "quoted"' },
    });
    const text = await resp.text();
    expect(text).toContain("&amp;");
  });
});

// ---------------------------------------------------------------------------
// {{TITLE}} placeholder absent from served HTML
// ---------------------------------------------------------------------------

describe("Title placeholder absent", () => {
  it("does not contain raw {{TITLE}} placeholder", async () => {
    const resp = await request("GET", "/");
    const text = await resp.text();
    expect(text).not.toContain("{{TITLE}}");
  });

  it("replaces placeholder with custom title", async () => {
    const resp = await request("GET", "/", {
      config: { title: "Custom Title" },
    });
    const text = await resp.text();
    expect(text).not.toContain("{{TITLE}}");
    expect(text).toContain("Custom Title");
  });

  it("handles $ replacement patterns in title literally", async () => {
    const resp = await request("GET", "/", {
      config: { title: "My $& App $' $` $1" },
    });
    const text = await resp.text();
    expect(text).not.toContain("{{TITLE}}");
    expect(text).toContain("My $&amp; App $&#x27; $` $1");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("Backward compatibility", () => {
  it("buildMcpUIRoutes still works", async () => {
    const routes = buildMcpUIRoutes(TOOLS, fakeHandler);
    expect(routes).toHaveLength(5);
    // Verify it produces working routes by checking the meta endpoint
    const metaRoute = routes.find((r) => r.pattern === "/meta");
    expect(metaRoute).toBeDefined();
    const resp = await metaRoute!.handler(
      { headers: {} },
      {},
    );
    expect(resp.status).toBe(200);
  });

  it("buildMcpUIRoutes emits deprecation warning", async () => {
    const warns: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warns.push(args);
    try {
      buildMcpUIRoutes(TOOLS, fakeHandler);
    } finally {
      console.warn = origWarn;
    }
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const msg = String(warns[0]);
    expect(msg).toContain("buildUIRoutes");
  });
});

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

describe("Public exports", () => {
  it("exports all expected names", async () => {
    const mod = await import("../src/index.js");
    const expected = [
      "buildMcpUIRoutes",
      "buildUIRoutes",
      "createHandler",
      "createNodeHandler",
      "EXPLORER_HTML_TEMPLATE",
      "renderExplorerHtml",
    ];
    for (const name of expected) {
      expect(mod).toHaveProperty(name);
    }
  });
});

// ---------------------------------------------------------------------------
// HTML template drift check
// ---------------------------------------------------------------------------

describe("HTML template drift", () => {
  it("embedded template matches spec repo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const specPath = path.resolve(
      import.meta.dirname ?? ".",
      "..",
      "..",
      "mcp-embedded-ui",
      "docs",
      "explorer.html",
    );

    if (!fs.existsSync(specPath)) {
      // Skip if spec repo is not co-located (e.g., CI without sibling checkout)
      return;
    }

    const specHtml = fs.readFileSync(specPath, "utf-8");
    expect(EXPLORER_HTML_TEMPLATE).toBe(specHtml);
  });
});

// ---------------------------------------------------------------------------
// createHandler with prefix
// ---------------------------------------------------------------------------

describe("createHandler with prefix", () => {
  it("strips prefix before routing", async () => {
    const handler = createHandler(TOOLS, fakeHandler);
    const resp = await handler(
      new Request("http://localhost/explorer/tools"),
      "/explorer",
    );
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { name: string }[];
    expect(data).toHaveLength(2);
  });

  it("serves HTML at prefix root", async () => {
    const handler = createHandler(TOOLS, fakeHandler);
    const resp = await handler(
      new Request("http://localhost/ui/"),
      "/ui",
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
  });

  it("handles tool call with prefix", async () => {
    const handler = createHandler(TOOLS, fakeHandler);
    const resp = await handler(
      new Request("http://localhost/explorer/tools/echo/call", {
        method: "POST",
        body: JSON.stringify({ msg: "prefixed" }),
        headers: { "content-type": "application/json" },
      }),
      "/explorer",
    );
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.content[0].text).toBe("echo: prefixed");
  });
});
