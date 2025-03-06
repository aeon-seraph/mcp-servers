import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as alerts from './alerts.js';


const server = new Server({
    name: "weather-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {}
    }
});

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_alerts",
                description: "Get weather alerts for a state",
                inputSchema: zodToJsonSchema(alerts.GetAlertsSchema),
            },
        ]
    }
})

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        if (!request.params.arguments) {
            throw new Error("Arguments are required");
        }

        switch (request.params.name) {
            case "get_alerts": {
                const args = alerts.GetAlertsSchema.parse(request.params.arguments);
                const result = await alerts.getAlerts(
                    args.state
                );
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }

            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }

    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new Error(`Invalid input: ${JSON.stringify(error.errors)}`);
        }
        throw error;
    }
});


// Start the server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather MCP Server running on stdio");
}

runServer().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
