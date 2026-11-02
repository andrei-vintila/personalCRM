import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { defineHandler } from "nitro/h3";
import { useDb } from "../utils/db";
import { createMcpServer } from "../utils/mcpServer";

/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses). Works the same on
 * Node and Workers. Auth: `Authorization: Bearer <API token>` (see middleware/auth.ts).
 */
export default defineHandler(async (event) => {
  const server = createMcpServer(await useDb(event));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(event.req);
});
