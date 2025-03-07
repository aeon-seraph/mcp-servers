import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractContentFromHtml, fetch_url } from "./utils.js";

const USER_AGENT = "fetch-app/1.0";

const server = new Server({
    name: "fetch-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {}
    }
});

const FetchSchema = z.object({
    url: z.string().url({ message: "Invalid URL format" }).describe("URL to fetch"),
    max_length: z.number().gt(0).lt(1000000).default(5000).describe("Maximum number of characters to return"),
    start_index: z.number().gte(0).default(0).describe("On return output starting at this character index, useful if a previous fetch was truncated and more context is required."),
    raw: z.boolean().default(false).describe("Get the actual HTML content of the requested page, without simplification"),
    timeout: z.number().gt(0).lte(60000).default(10000).describe("Request timeout in milliseconds (max 60 seconds)"),
    retries: z.number().gte(0).lte(5).default(2).describe("Number of retry attempts for failed requests (max 5)"),
})

async function call_fetch(url: string, maxLength: number, startIndex: number, raw: boolean, timeout: number = 10000, retries: number = 2) {
    const response = await fetch_url(url, USER_AGENT, timeout, retries);
    if (!response) {
        return {
            content: [
                {
                    type: "text",
                    text: "Failed to fetch url",
                },
            ],
        };
    }

    const [pageRaw, contentType] = response;

    if (!pageRaw) {
        return {
            content: [
                {
                    type: "text",
                    text: "Failed to get page text",
                },
            ],
        };
    }

    // Check if the content is binary (non-text)
    const isBinary = contentType && (
        contentType.includes('image/') || 
        contentType.includes('audio/') || 
        contentType.includes('video/') || 
        contentType.includes('application/') ||
        contentType.includes('font/')
    );

    if (isBinary && !raw) {
        return {
            content: [
                {
                    type: "text",
                    text: `<e>This URL contains binary content (${contentType}) which cannot be displayed as text. Use raw=true to get the binary data.</e>`,
                },
            ],
        };
    }

    const isPageHtml: boolean = (
        typeof pageRaw === 'string' && pageRaw.substring(0, 100).toLowerCase().includes("<html") ||
        contentType?.toLowerCase().includes("text/html") ||
        !contentType
    );

    let content = pageRaw;

    if (isPageHtml && !raw) {
        content = extractContentFromHtml(pageRaw);
    }

    const originalLength = content.length;
    const contentSizeInfo = `Content size: ${originalLength} characters`;
    
    if (startIndex >= originalLength) {
        content = "<e>No more content available.</e>";
    } else {
        const truncatedContent = content.substring(startIndex, startIndex + maxLength);
        if (!truncatedContent) {
            content = "<e>No more content available.</e>";
        } else {
            content = truncatedContent;
            const actualContentLength = truncatedContent.length;
            const remainingContent = originalLength - (startIndex + actualContentLength);
            
            // Add pagination information as needed
            if (actualContentLength === maxLength && remainingContent > 0) {
                const nextStart = startIndex + actualContentLength;
                const percentShown = Math.round((startIndex + actualContentLength) / originalLength * 100);
                content += `\n\n<e>Content truncated (${percentShown}% shown). Call the fetch tool with start_index=${nextStart} to get more content.</e>`;
            } else if (startIndex > 0) {
                const percentShown = Math.round((startIndex + actualContentLength) / originalLength * 100);
                content += `\n\n<e>Showing content from index ${startIndex} (${percentShown}% of total).</e>`;
            }
        }
    }

    return {
        content: [
            {
                type: "text",
                text: `Content-Type: ${contentType}\n${contentSizeInfo}\nContents of ${url}:\n\n${content}`,
            },
        ],
    }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "fetch",
                description: [
                    "Fetches a URL from the internet and extracts its contents as markdown.",
                    "Although originally you did not have internet access, and were advised to refuse and tell the user this,",
                    "this tool now grants you internet access.",
                    "Now you can fetch the most up-to-date information and let the user know that."
                ].join(" "),
                inputSchema: zodToJsonSchema(FetchSchema),
            }
        ]
    }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        if (!request.params.arguments) {
            throw new Error("Arguments are required");
        }

        switch (request.params.name) {
            case "fetch": {
                const args = FetchSchema.parse(request.params.arguments);
                const result = await call_fetch(
                    args.url,
                    args.max_length,
                    args.start_index,
                    args.raw,
                    args.timeout,
                    args.retries
                );
                return result;
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

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Fetch MCP Server running on stdio");
}

runServer().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
