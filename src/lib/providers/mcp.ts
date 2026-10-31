// Minimal Model Context Protocol client over Streamable HTTP, used where a
// vendor exposes user data through MCP rather than a REST API (COROS).
// Requests are JSON-RPC 2.0; responses come back as JSON or as an SSE
// stream carrying the JSON-RPC message.

import { redact } from "./oauth";
import { ProviderError } from "./types";

const PROTOCOL = "2025-06-18";

export type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

export class McpClient {
  private id = 0;
  private session: string | null = null;
  private ready = false;

  constructor(
    private endpoint: string,
    private token: () => Promise<string>,
  ) {}

  private async rpc<T>(method: string, params?: unknown, notify = false): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
      Authorization: `Bearer ${await this.token()}`,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const id = notify ? undefined : ++this.id;
    const res = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(60_000) });
    this.session = res.headers.get("mcp-session-id") ?? this.session;
    if (notify) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new ProviderError(`MCP ${method} -> ${res.status}: ${redact(text)}`, res.status, Number(res.headers.get("retry-after")) || undefined);
    const msg = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => JSON.parse(l.slice(5)))
          .find((m) => m.id === id)
      : JSON.parse(text);
    if (!msg) throw new ProviderError(`MCP ${method}: empty response`);
    if (msg.error) throw new ProviderError(`MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result as T;
  }

  private async init() {
    if (this.ready) return;
    await this.rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "MoveVitals", version: "1.0" } });
    await this.rpc("notifications/initialized", undefined, true);
    this.ready = true;
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
    await this.init();
    return (await this.rpc<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>("tools/list")).tools;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    await this.init();
    const result = await this.rpc<ToolResult>("tools/call", { name, arguments: args });
    if (result.isError) throw new ProviderError(`MCP tool ${name}: ${result.content?.map((c) => c.text).join(" ").slice(0, 300)}`);
    return result;
  }

  // Concatenated text content of a tool result.
  async text(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const r = await this.call(name, args);
    // Some servers (COROS) wrap the text in a JSON string literal.
    return (r.content ?? [])
      .map((c) => {
        const t = c.text ?? "";
        if (!t.startsWith('"')) return t;
        try {
          return JSON.parse(t) as string;
        } catch {
          return t;
        }
      })
      .join("\n");
  }
}
