import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import chalk from 'chalk';
import { description } from "./desc.js";

const SequentialThinkingSchema = z.object({
    thought: z.string().describe("Your current thinking step"),
    nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
    thoughtNumber: z.number().min(1).describe("Current sequential thought number"),
    totalThoughts: z.number().min(1).describe("Estimated total thoughts needed"),
    isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
    revisesThought: z.number().min(1).optional().describe("Which thought is being reconsidered"),
    branchFromThought: z.number().min(1).optional().describe("Branching point thought number"),
    branchId: z.string().optional().describe("Branch identifier"),
    needsMoreThoughts: z.boolean().optional().describe("If more thoughts are needed"),
});

type ThoughtData = z.infer<typeof SequentialThinkingSchema>;

class SequentialThinking {
    thoughtHistory: ThoughtData[] = [];
    branches: Record<string, ThoughtData[]> = {};

    private formatThought(thoughtData: ThoughtData): string {
        const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

        let icon, label, color, context;

        if (isRevision) {
            icon = '🔄';
            label = 'Revision';
            color = chalk.yellow;
            context = ` (revising thought ${revisesThought})`;
        } else if (branchFromThought) {
            icon = '🌿';
            label = 'Branch';
            color = chalk.green;
            context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
        } else {
            icon = '💭';
            label = 'Thought';
            color = chalk.blue;
            context = '';
        }

        const header = `${color(`${icon} ${label}`)} ${thoughtNumber}/${totalThoughts}${context}`;

        const lines = thought.split('\n');

        const headerLength = header.replace(/\u001b\[\d+m/g, '').length;
        const contentWidth = Math.max(headerLength, ...lines.map(line => line.length));
        const border = '─'.repeat(contentWidth + 4);

        const formattedContent = lines
            .map(line => `│ ${line.padEnd(contentWidth + 2)} │`)
            .join('\n');

        return `
┌${border}┐
│ ${header.padEnd(contentWidth + 2)} │
├${border}┤
${formattedContent}
└${border}┘`;
    }

    public processThought(thoughtData: ThoughtData) {
        try {

            if (thoughtData.thoughtNumber > thoughtData.totalThoughts) {
                thoughtData.totalThoughts = thoughtData.thoughtNumber;
            }

            this.thoughtHistory.push(thoughtData);

            if (thoughtData.branchFromThought && thoughtData.branchId) {
                if (!this.branches[thoughtData.branchId]) {
                    this.branches[thoughtData.branchId] = [];
                }
                this.branches[thoughtData.branchId].push(thoughtData);
            }

            const formattedThought = this.formatThought(thoughtData);
            // console.error(formattedThought);

            if (thoughtData.needsMoreThoughts && !thoughtData.nextThoughtNeeded) {
                thoughtData.nextThoughtNeeded = true;
            }

            const thoughtResponse = JSON.stringify({
                thoughtNumber: thoughtData.thoughtNumber,
                totalThoughts: thoughtData.totalThoughts,
                nextThoughtNeeded: thoughtData.nextThoughtNeeded,
                branches: Object.keys(this.branches),
                thoughtHistoryLength: this.thoughtHistory.length,
                needsMoreThoughts: thoughtData.needsMoreThoughts || false
            }, null, 2);
            // console.error(thoughtResponse);

            return {
                content: [
                    {
                        type: "text",
                        text: thoughtResponse
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to proccess thought. ${error}`
                    }
                ]
            }
        }
    }
}


const server = new Server({
    name: "thinking-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {}
    }
});

const sequentialThinking = new SequentialThinking();

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "sequential_thinking",
                description: description,
                inputSchema: zodToJsonSchema(SequentialThinkingSchema),
            }
        ]
    }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        if (!request.params.arguments) {
            throw new Error("Arguments are required");
        }

        if (request.params.name === "sequential_thinking") {
            const args = SequentialThinkingSchema.parse(request.params.arguments);

            if (args.isRevision && !args.revisesThought) {
                throw new Error("revisesThought is required when isRevision is true");
            }

            if (args.branchFromThought && !args.branchId) {
                throw new Error("branchId is required when branchFromThought is specified");
            }

            const result = sequentialThinking.processThought(args);
            return result;
        }

        throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
        console.error("Error in CallToolRequestSchema handler:", error);

        if (error instanceof z.ZodError) {
            throw new Error(`Invalid input: ${JSON.stringify(error.errors)}`);
        }

        throw error;
    }
});


async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Thinking MCP Server running on stdio");
}

runServer().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
