import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./server.js";

try {
  const server = createMcpServer({
    appUrl: process.env.PA_MCP_APP_URL ?? "",
    session: process.env.PA_MCP_SESSION ?? "",
    guildId: process.env.PA_MCP_GUILD_ID ?? "",
  });
  await server.connect(new StdioServerTransport());
} catch {
  console.error("MCP startup failed. Check PA_MCP_APP_URL (HTTPS origin), PA_MCP_SESSION and PA_MCP_GUILD_ID.");
  process.exitCode = 1;
}
