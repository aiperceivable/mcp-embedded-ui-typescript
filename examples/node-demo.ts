import http from "node:http";
import { createNodeHandler } from "../src/index.js";
import type { AuthHook, Tool, ToolCallHandler } from "../src/index.js";

// Mock MCP tools
const tools: Tool[] = [
  {
    name: "echo",
    description: "Replies back with your message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
  },
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
    },
  },
];

// Tool execution handler
const handleCall: ToolCallHandler = async (name, args) => {
  if (name === "echo") {
    return [
      [{ type: "text", text: `You said: ${args.message}` }],
      false,
      "trace-123",
    ];
  }
  if (name === "add") {
    const sum = (args.a as number) + (args.b as number);
    return [[{ type: "text", text: `Result: ${sum}` }], false, "trace-456"];
  }
  return [[{ type: "text", text: `Unknown tool: ${name}` }], true, undefined];
};

const DEMO_TOKEN = "demo-secret-token";

// Auth hook — guards POST /tools/{name}/call only; discovery endpoints are always public.
// In production, replace with your own logic (JWT, API key, session, etc.).
const authHook: AuthHook = async (req, next) => {
  const token = req.headers["authorization"] ?? "";
  if (token !== `Bearer ${DEMO_TOKEN}`) {
    throw new Error("Invalid token");
  }
  return next();
};

const handle = createNodeHandler(tools, handleCall, {
  prefix: "/explorer",
  title: "My MCP Explorer",
  authHook,
});

const server = http.createServer(handle);
server.listen(8000, () => {
  console.log("Running MCP Embedded UI at http://localhost:8000/explorer");
  console.log(`Auth token for demo: Bearer ${DEMO_TOKEN}`);
  console.log("Paste the token above into the UI's token field to execute tools");
});
