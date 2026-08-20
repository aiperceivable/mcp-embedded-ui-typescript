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
  ValidateResult,
  ValidationFailure,
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

  it("contains allow_execute=true when enabled", async () => {
    const resp = await request("GET", "/", {
      config: { allowExecute: true },
    });
    const text = await resp.text();
    expect(text).toContain("var executeEnabled = true;");
    expect(text).not.toContain("{{ALLOW_EXECUTE}}");
  });

  it("contains allow_execute=false when disabled", async () => {
    const resp = await request("GET", "/", {
      config: { allowExecute: false },
    });
    const text = await resp.text();
    expect(text).toContain("var executeEnabled = false;");
  });

  it("defaults allow_execute to false via config", async () => {
    const resp = await request("GET", "/");
    const text = await resp.text();
    expect(text).toContain("var executeEnabled = false;");
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
      config: { allowExecute: true },
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.isError).toBe(false);
    expect(data.content[0].text).toBe("echo: hi");
    expect(data._meta._trace_id).toBe("t1");
  });

  it("returns error call with status 500", async () => {
    const resp = await request("POST", "/tools/boom/call", { body: {}, config: { allowExecute: true } });
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.isError).toBe(true);
  });

  it("returns 404 for missing tool", async () => {
    const resp = await request("POST", "/tools/nope/call", { body: {}, config: { allowExecute: true } });
    expect(resp.status).toBe(404);
  });

  it("treats invalid JSON body as empty dict", async () => {
    const handler = createHandler(TOOLS, fakeHandler, { allowExecute: true });
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
// Validate tool — F7
// ---------------------------------------------------------------------------

describe("Validate tool", () => {
  const schemaTool = fakeTool("echo", "Echo back", {
    type: "object",
    properties: {
      city: { type: "string" },
      count: { type: "integer" },
    },
    required: ["city"],
  });
  const noSchemaTool = fakeTool("noschema", "No schema", {});
  // A schema that is itself structurally invalid — Ajv cannot compile it (F7).
  const badSchemaTool = fakeTool("badschema", "Broken schema", {
    type: "no-such-type",
  });
  const VTOOLS: Tool[] = [schemaTool, noSchemaTool, badSchemaTool];

  it("reports an uncompilable schema as a validation failure", async () => {
    // Must not crash the endpoint (500) and must not be reported valid.
    const resp = await request("POST", "/tools/badschema/validate", {
      tools: VTOOLS,
      body: { anything: 1 },
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.valid).toBe(false);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0].path).toBe("");
    expect(data.errors[0].keyword).toBe("schema");
    expect(data.errors[0].message).toMatch(/^Invalid schema:/);
  });

  it("returns valid:true for matching input", async () => {
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: { city: "Paris" },
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ valid: true });
  });

  it("returns valid:false when required field missing", async () => {
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: {},
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.valid).toBe(false);
    expect(
      data.errors.some((e: { keyword: string }) => e.keyword === "required"),
    ).toBe(true);
  });

  it("flags wrong types with /path pointer", async () => {
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: { city: "Paris", count: "not-int" },
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.valid).toBe(false);
    const typeErr = data.errors.find(
      (e: { keyword: string }) => e.keyword === "type",
    );
    expect(typeErr).toBeDefined();
    expect(typeErr.path).toBe("/count");
  });

  it("returns multiple errors in one response", async () => {
    const multi = fakeTool("multi", "M", {
      type: "object",
      properties: { a: { type: "integer" }, b: { type: "integer" } },
      required: ["a", "b"],
    });
    const resp = await request("POST", "/tools/multi/validate", {
      tools: [multi],
      body: {},
    });
    const data = await resp.json();
    expect(data.valid).toBe(false);
    expect(data.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 404 for unknown tool", async () => {
    const resp = await request("POST", "/tools/nope/validate", {
      tools: VTOOLS,
      body: {},
    });
    expect(resp.status).toBe(404);
    expect((await resp.json()).error).toContain("Tool not found");
  });

  it("returns 400 on invalid JSON body", async () => {
    const handler = createHandler(VTOOLS, fakeHandler);
    const resp = await handler(
      new Request("http://localhost/tools/echo/validate", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.valid).toBe(false);
    expect(data.errors[0].keyword).toBe("format");
    expect(data.errors[0].path).toBe("");
  });

  it("treats missing inputSchema as always-valid", async () => {
    const resp = await request("POST", "/tools/noschema/validate", {
      tools: VTOOLS,
      body: { anything: 123 },
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ valid: true });
  });

  it("ignores allowExecute=false", async () => {
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: { city: "Paris" },
      config: { allowExecute: false },
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ valid: true });
  });

  it("does not invoke authHook", async () => {
    let calls = 0;
    const auth: AuthHook = async (_req, _next) => {
      calls += 1;
      throw new Error("nope");
    };
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: { city: "Paris" },
      config: { allowExecute: true, authHook: auth },
    });
    expect(resp.status).toBe(200);
    expect(calls).toBe(0);
  });

  it("does not invoke handleCall", async () => {
    let calls = 0;
    const spy: ToolCallHandler = async (_n, _a) => {
      calls += 1;
      return [[{ type: "text", text: "ran" }], false, undefined];
    };
    await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      handleCall: spy,
      body: { city: "Paris" },
      config: { allowExecute: true },
    });
    await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      handleCall: spy,
      body: {},
      config: { allowExecute: true },
    });
    expect(calls).toBe(0);
  });

  it("omits errors key when valid", async () => {
    const resp = await request("POST", "/tools/echo/validate", {
      tools: VTOOLS,
      body: { city: "Paris" },
    });
    const data = await resp.json();
    expect("errors" in data).toBe(false);
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
      config: { allowExecute: true, authHook },
    });
    expect(resp.status).toBe(200);
  });

  it("returns 401 when auth fails", async () => {
    const authHook: AuthHook = async () => {
      throw new Error("nope");
    };

    const resp = await request("POST", "/tools/echo/call", {
      body: {},
      config: { allowExecute: true, authHook },
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
      config: { allowExecute: true, authHook },
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

    const config = { allowExecute: true, authHook };
    expect((await request("GET", "/", { config })).status).toBe(200);
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
    const resp = await request("POST", "/tools/boom/call", { body: {}, config: { allowExecute: true } });
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
      config: { allowExecute: true },
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
      config: { allowExecute: true },
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
  it("does not contain raw {{TITLE}} or {{ALLOW_EXECUTE}} placeholder", async () => {
    const resp = await request("GET", "/");
    const text = await resp.text();
    expect(text).not.toContain("{{TITLE}}");
    expect(text).not.toContain("{{ALLOW_EXECUTE}}");
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
// Project link in footer
// ---------------------------------------------------------------------------

describe("Project link", () => {
  it("no project link by default", async () => {
    const resp = await request("GET", "/");
    const text = await resp.text();
    expect(text).not.toContain("{{PROJECT_LINK}}");
    expect(text).not.toContain("&middot;");
  });

  it("renders project name only (no link)", async () => {
    const resp = await request("GET", "/", {
      config: { projectName: "my-project" },
    });
    const text = await resp.text();
    expect(text).toContain("&middot; my-project");
  });

  it("renders project name with URL as link", async () => {
    const resp = await request("GET", "/", {
      config: {
        projectName: "my-project",
        projectUrl: "https://github.com/example/my-project",
      },
    });
    const text = await resp.text();
    expect(text).toContain("my-project");
    expect(text).toContain("https://github.com/example/my-project");
  });

  it("escapes project name to prevent XSS", async () => {
    const resp = await request("GET", "/", {
      config: { projectName: "<script>alert(1)</script>" },
    });
    const text = await resp.text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("Backward compatibility", () => {
  it("buildMcpUIRoutes still works", async () => {
    const routes = buildMcpUIRoutes(TOOLS, fakeHandler);
    expect(routes).toHaveLength(5);
    const toolsRoute = routes.find((r) => r.pattern === "/tools");
    expect(toolsRoute).toBeDefined();
    const resp = await toolsRoute!.handler(
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

// F7 public type exports. Types are erased at runtime, so a `toHaveProperty`
// check cannot see them — these declarations fail `tsc` instead if the types
// stop being nameable from the package root.
{
  const _result: ValidateResult = { valid: true };
  const _resultWithErrors: ValidateResult = {
    valid: false,
    errors: [{ path: "/city", message: "is required", keyword: "required" }],
  };
  const _failure: ValidationFailure = { path: "", message: "x" };
  void _result;
  void _resultWithErrors;
  void _failure;
}

describe("project_url scheme allow-list", () => {
  // HTML escaping alone does not neutralise `javascript:`. Browsers also
  // ignore TAB/LF/CR and leading whitespace when resolving a scheme.
  const ACCEPTED = [
    "https://example.com/x",
    "http://example.com/x",
    "HTTPS://example.com/x",
    "mailto:someone@example.com",
    "/docs/index.html",
  ];
  const REJECTED = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
  ];

  function footerOf(projectUrl: string): string {
    const html = renderExplorerHtml("t", false, "proj", projectUrl);
    return html.split("mcp-embedded-ui</a>").pop() ?? "";
  }

  it("renders an anchor for accepted schemes", () => {
    for (const url of ACCEPTED) {
      expect(footerOf(url), `${url} should render an anchor`).toContain("<a href=");
    }
  });

  it("degrades rejected schemes to plain text", () => {
    for (const url of REJECTED) {
      const footer = footerOf(url);
      expect(footer, `${url} must not become an anchor`).not.toContain("<a href=");
      expect(footer, `${url} must still show the name`).toContain("proj");
      expect(footer.toLowerCase(), `${url} leaked into the page`).not.toContain("javascript");
    }
  });
});

describe("Public exports", () => {
  it("exports all expected names", async () => {
    const mod = await import("../src/index.js");
    const expected = [
      "buildMcpUIRoutes",
      "buildUIRoutes",
      "createHandler",
      "createNodeHandler",
      // Deprecated (F5: implementation detail). Still asserted so their
      // removal is a deliberate edit rather than an accident.
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

    const pkgPath = path.resolve(
      import.meta.dirname ?? ".",
      "..",
      "src",
      "explorer.html",
    );
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

    const pkgHtml = fs.readFileSync(pkgPath, "utf-8");
    const specHtml = fs.readFileSync(specPath, "utf-8");
    expect(pkgHtml).toBe(specHtml);
  });
});

// ---------------------------------------------------------------------------
// Prefill generation — F6/FR-1, criteria TC-1 / TC-17 / TC-18 / TC-19 / TC-20
//
// defaultFromSchema is JavaScript living inside explorer.html, which the
// drift check above pins byte-for-byte against the spec repo — and every SDK
// ships that same file. Executing it here therefore covers the shared
// template, not just this package.
// ---------------------------------------------------------------------------

type PrefillSchema = Record<string, unknown> | undefined;
type Prefill = (schema: PrefillSchema) => Record<string, unknown>;

async function loadDefaultFromSchema(): Promise<Prefill> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname ?? ".", "..", "src", "explorer.html"),
    "utf-8",
  );
  const match = html.match(
    /^ {2}function defaultFromSchema\(schema\) \{[\s\S]*?^ {2}\}$/m,
  );
  if (!match) throw new Error("defaultFromSchema not found in explorer.html");
  return new Function(`${match[0]}\nreturn defaultFromSchema;`)() as Prefill;
}

describe("prefill generation (FR-1)", () => {
  it("TC-1: uses a declared default, including falsy ones", async () => {
    const gen = await loadDefaultFromSchema();
    expect(gen({ properties: { a: { type: "string", default: "x" } }, required: ["a"] })).toEqual({ a: "x" });
    expect(gen({ properties: { n: { type: "integer", default: 0 } }, required: ["n"] })).toEqual({ n: 0 });
    expect(gen({ properties: { b: { type: "boolean", default: false } }, required: ["b"] })).toEqual({ b: false });
    expect(gen({ properties: { s: { type: "string", default: "" } }, required: ["s"] })).toEqual({ s: "" });
    expect(gen({ properties: { x: { type: ["string", "null"], default: null } }, required: ["x"] })).toEqual({ x: null });
  });

  it("TC-1: emits null for a required property with no default", async () => {
    const gen = await loadDefaultFromSchema();
    expect(gen({ properties: { city: { type: "string" } }, required: ["city"] })).toEqual({ city: null });
  });

  it("TC-1: never fabricates a type-based value", async () => {
    const gen = await loadDefaultFromSchema();
    expect(
      gen({
        properties: {
          s: { type: "string" }, n: { type: "integer" }, b: { type: "boolean" },
          a: { type: "array" }, o: { type: "object" },
        },
        required: ["s", "n", "b", "a", "o"],
      }),
    ).toEqual({ s: null, n: null, b: null, a: null, o: null });
  });

  it("TC-17: prefills {} when required is absent or empty", async () => {
    const gen = await loadDefaultFromSchema();
    expect(gen(undefined)).toEqual({});
    expect(gen({ type: "object", properties: { a: { type: "string" } } })).toEqual({});
    expect(gen({ properties: { a: { type: "string" } }, required: [] })).toEqual({});
  });

  it("TC-18: omits optional properties even when they declare a default", async () => {
    const gen = await loadDefaultFromSchema();
    expect(
      gen({
        properties: { a: { type: "string" }, b: { type: "string", default: "keep" } },
        required: ["a"],
      }),
    ).toEqual({ a: null });
  });

  it("TC-18: prefill size follows required.length, not the property count", async () => {
    const gen = await loadDefaultFromSchema();
    const properties: Record<string, unknown> = { url: { type: "string" } };
    for (let i = 0; i < 256; i++) properties[`opt${i}`] = { type: "string", default: "d" };
    expect(gen({ properties, required: ["url"] })).toEqual({ url: null });
  });

  it("TC-19: emits null for a required name absent from properties", async () => {
    const gen = await loadDefaultFromSchema();
    expect(gen({ properties: {}, required: ["ghost"] })).toEqual({ ghost: null });
  });

  it("TC-19: does not recurse into nested object properties", async () => {
    const gen = await loadDefaultFromSchema();
    expect(
      gen({
        properties: { o: { type: "object", properties: { i: { type: "string" } }, required: ["i"] } },
        required: ["o"],
      }),
    ).toEqual({ o: null });
  });

  it("TC-20: the untouched prefill is rejected by /validate", async () => {
    const gen = await loadDefaultFromSchema();
    const inputSchema = {
      type: "object",
      properties: { city: { type: "string" }, count: { type: "integer" } },
      required: ["city"],
    };
    const prefill = gen(inputSchema);
    expect(prefill).toEqual({ city: null });

    const resp = await request("POST", "/tools/echo/validate", {
      tools: [fakeTool("echo", "Echo back", inputSchema)],
      body: prefill,
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.valid).toBe(false);
    expect(data.errors.some((e: { path: string }) => e.path === "/city")).toBe(true);
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
    const handler = createHandler(TOOLS, fakeHandler, { allowExecute: true });
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
