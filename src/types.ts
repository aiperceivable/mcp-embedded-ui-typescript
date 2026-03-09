/** Minimal MCP Tool interface — any object matching this shape works. */
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown> | null;
}

/** MCP text content item. */
export interface TextContent {
  type: "text";
  text: string;
}

/** Result returned from a tool call endpoint. */
export interface CallResult {
  content: TextContent[];
  isError: boolean;
  _meta?: { _trace_id: string };
}

/**
 * Provides the list of tools. Can be a static array, a sync function,
 * or an async function — re-evaluated on each request when callable.
 */
export type ToolsProvider =
  | Tool[]
  | (() => Tool[])
  | (() => Promise<Tool[]>);

/**
 * Executes a tool by name with the given arguments.
 * Returns [content, isError, traceId?].
 */
export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<[TextContent[], boolean, string?]>;

/**
 * Auth middleware — receives the incoming request, calls `next()` to proceed.
 * Throw to reject with 401.
 */
export type AuthHook = (
  req: IncomingRequest,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Configuration options for the UI routes. */
export interface UIConfig {
  allowExecute?: boolean;
  authHook?: AuthHook;
  title?: string;
}

/**
 * Minimal incoming request abstraction (framework-agnostic).
 * Compatible with Node.js `http.IncomingMessage` and most frameworks.
 */
export interface IncomingRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
