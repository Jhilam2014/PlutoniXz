export function createLocalGothamMcpServer({ executeWorkflow, emit } = {}) {
  if (typeof executeWorkflow !== "function") {
    throw new Error("Local Gotham MCP server requires an executeWorkflow function.");
  }

  const server = {
    id: process.env.GOTHAM_LOCAL_MCP_ID || "plutonix-local-gotham-mcp",
    name: "PlutoniX Local Gotham MCP",
    version: "1.0.0",
    transport: "in-process",
    tools: {
      "gotham.generate": {
        name: "gotham.generate",
        description: "Run a PlutoniX-owned Gotham workflow through the local MCP execution boundary.",
        inputSchema: {
          type: "object",
          required: ["orchestratedRequest", "options", "orchestrationEnvelope", "adaptiveRoute"],
          additionalProperties: false
        }
      }
    }
  };

  function status() {
    return {
      id: server.id,
      name: server.name,
      version: server.version,
      transport: server.transport,
      status: "ready",
      tools: Object.keys(server.tools)
    };
  }

  async function callTool(toolName, payload = {}) {
    if (toolName !== "gotham.generate") {
      throw new Error(`Unknown local Gotham MCP tool: ${toolName}`);
    }
    emit?.("gotham-mcp-tool-start", "Local Gotham MCP tool gotham.generate started", {
      mcpServerId: server.id,
      toolName,
      projectId: payload.options?.projectId || "",
      projectName: payload.options?.projectName || ""
    });
    const result = await executeWorkflow(payload);
    emit?.("gotham-mcp-tool-complete", "Local Gotham MCP tool gotham.generate completed", {
      mcpServerId: server.id,
      toolName,
      projectId: payload.options?.projectId || "",
      projectName: payload.options?.projectName || "",
      buildId: result?.buildId || "",
      changedFiles: result?.files?.length || 0
    });
    return {
      ...result,
      executionMode: "mcp",
      mcpServer: status(),
      mcpTool: toolName
    };
  }

  return {
    status,
    callTool
  };
}
