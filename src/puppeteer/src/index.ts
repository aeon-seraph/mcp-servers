#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";

let browser: Browser | null = null;

// Map to store active pages with their IDs
const pages = new Map<string, Page>();

const server = new Server(
  {
    name: "puppeteer-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}
    },
  }
);

async function ensureBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
    });
    
    browser.on("disconnected", () => {
      browser = null;
      pages.clear();
    });
  }
  return browser;
}

const LaunchBrowserSchema = z.object({
  headless: z.boolean().default(true).describe("Whether to run browser in headless mode"),
  defaultViewport: z.object({
    width: z.number().positive().default(1280).describe("Viewport width"),
    height: z.number().positive().default(800).describe("Viewport height"),
  }).optional().describe("Default viewport settings"),
});

const NewPageSchema = z.object({
  viewportWidth: z.number().positive().default(1280).describe("Viewport width"),
  viewportHeight: z.number().positive().default(800).describe("Viewport height"),
});

const NavigateSchema = z.object({
  pageId: z.string().describe("ID of the page to navigate"),
  url: z.string().url().describe("URL to navigate to"),
  timeout: z.number().positive().default(30000).describe("Navigation timeout in milliseconds"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).default("load").describe("When to consider navigation successful"),
});

const ScreenshotSchema = z.object({
  pageId: z.string().describe("ID of the page to screenshot"),
  fullPage: z.boolean().default(false).describe("Whether to take a screenshot of the full scrollable page"),
  type: z.enum(["png", "jpeg"]).default("png").describe("Screenshot type"),
  quality: z.number().min(0).max(100).optional().describe("Quality of the image (0-100), only applies to jpeg"),
  encoding: z.enum(["binary", "base64"]).default("base64").describe("Encoding of the image"),
});

const GetContentSchema = z.object({
  pageId: z.string().describe("ID of the page to get content from"),
  selector: z.string().optional().describe("CSS selector to get specific element content (optional)"),
});

const ClickSchema = z.object({
  pageId: z.string().describe("ID of the page to click on"),
  selector: z.string().describe("CSS selector to click on"),
  clickCount: z.number().positive().default(1).describe("Number of clicks"),
  delay: z.number().nonnegative().default(0).describe("Delay between clicks in milliseconds"),
});

const TypeSchema = z.object({
  pageId: z.string().describe("ID of the page to type on"),
  selector: z.string().describe("CSS selector to type into"),
  text: z.string().describe("Text to type"),
  delay: z.number().nonnegative().default(0).describe("Delay between keystrokes in milliseconds"),
});

const EvaluateSchema = z.object({
  pageId: z.string().describe("ID of the page to evaluate JavaScript on"),
  expression: z.string().describe("JavaScript expression to evaluate"),
});

const ClosePageSchema = z.object({
  pageId: z.string().describe("ID of the page to close"),
});

const CloseBrowserSchema = z.object({});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "launchBrowser",
        description: "Launch a new browser instance (if not already launched)",
        inputSchema: zodToJsonSchema(LaunchBrowserSchema),
      },
      {
        name: "newPage",
        description: "Create a new page in the browser",
        inputSchema: zodToJsonSchema(NewPageSchema),
      },
      {
        name: "navigate",
        description: "Navigate to a URL",
        inputSchema: zodToJsonSchema(NavigateSchema),
      },
      {
        name: "screenshot",
        description: "Take a screenshot of the page",
        inputSchema: zodToJsonSchema(ScreenshotSchema),
      },
      {
        name: "getContent",
        description: "Get HTML content from the page or a specific element",
        inputSchema: zodToJsonSchema(GetContentSchema),
      },
      {
        name: "click",
        description: "Click on an element",
        inputSchema: zodToJsonSchema(ClickSchema),
      },
      {
        name: "type",
        description: "Type text into an input field",
        inputSchema: zodToJsonSchema(TypeSchema),
      },
      {
        name: "evaluate",
        description: "Evaluate JavaScript code on the page",
        inputSchema: zodToJsonSchema(EvaluateSchema),
      },
      {
        name: "closePage",
        description: "Close a page",
        inputSchema: zodToJsonSchema(ClosePageSchema),
      },
      {
        name: "closeBrowser",
        description: "Close the browser and all pages",
        inputSchema: zodToJsonSchema(CloseBrowserSchema),
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: params } = request.params;
    
    switch (name) {
      case "launchBrowser": {
        const { headless, defaultViewport } = LaunchBrowserSchema.parse(params);
        
        if (browser) {
          await browser.close();
          browser = null;
          pages.clear();
        }
        
        browser = await puppeteer.launch({
          headless: headless,
          defaultViewport: defaultViewport || null,
        });
        
        browser.on("disconnected", () => {
          browser = null;
          pages.clear();
        });
        
        return {
          content: [
            {
              type: "text",
              text: "Browser launched successfully",
            },
          ],
        };
      }
      
      case "newPage": {
        const { viewportWidth, viewportHeight } = NewPageSchema.parse(params);
        const browser = await ensureBrowser();
        
        const page = await browser.newPage();
        await page.setViewport({
          width: viewportWidth,
          height: viewportHeight,
        });
        
        const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        pages.set(pageId, page);
        
        return {
          content: [
            {
              type: "text",
              text: `New page created with ID: ${pageId}`,
            },
          ],
          pageId,
        };
      }
      
      case "navigate": {
        const { pageId, url, timeout, waitUntil } = NavigateSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          const response = await page.goto(url, {
            timeout,
            waitUntil: waitUntil as any,
          });
          
          const title = await page.title();
          const finalUrl = page.url();
          const status = response?.status() || null;
          
          return {
            content: [
              {
                type: "text",
                text: `Navigated to "${title}" (${finalUrl}) with status: ${status}`,
              },
            ],
            status,
            url: finalUrl,
            title,
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Navigation failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "screenshot": {
        const { pageId, fullPage, type, quality, encoding } = ScreenshotSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          const screenshot = await page.screenshot({
            fullPage,
            type,
            quality,
            encoding,
          });
          
          // Convert Buffer to base64 string if necessary
          const base64Data = encoding === 'base64' 
            ? screenshot.toString() 
            : Buffer.from(screenshot as Buffer).toString('base64');
          
          const mimeType = type === 'png' ? 'image/png' : 'image/jpeg';
          
          return {
            content: [
              {
                type: "text",
                text: `Screenshot captured (${fullPage ? 'full page' : 'viewport'})`,
              }
            ],
            screenshot: {
              type: "image",
              data: base64Data,
              media_type: mimeType
            }
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Screenshot failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "getContent": {
        const { pageId, selector } = GetContentSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          let extractedContent: string;
          if (selector) {
            await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
            
            const content = await page.evaluate((sel: string) => {
              const element = document.querySelector(sel);
              return element ? element.outerHTML : null;
            }, selector);
            
            if (!content) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Element with selector "${selector}" not found`,
                  },
                ],
              };
            }
            
            extractedContent = content;
          } else {
            extractedContent = await page.content();
          }
          
          const title = await page.title();
          const url = page.url();
          
          return {
            content: [
              {
                type: "text",
                text: `Content from "${title}" (${url}):\n\n${extractedContent.length > 300 ? extractedContent.substring(0, 300) + '...' : extractedContent}`,
              },
            ],
            extractedContent,
            url,
            title,
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Getting content failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "click": {
        const { pageId, selector, clickCount, delay } = ClickSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          
          await page.click(selector, {
            clickCount,
            delay,
          });
          
          return {
            content: [
              {
                type: "text",
                text: `Clicked on "${selector}" successfully`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Click failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "type": {
        const { pageId, selector, text, delay } = TypeSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          
          await page.evaluate((sel: string) => {
            const element = document.querySelector(sel);
            if (element) {
              (element as HTMLInputElement).value = '';
            }
          }, selector);
          
          await page.type(selector, text, { delay });
          
          return {
            content: [
              {
                type: "text",
                text: `Typed "${text}" into "${selector}" successfully`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Type failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "evaluate": {
        const { pageId, expression } = EvaluateSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          const result = await page.evaluate(expression);
          const resultText = typeof result === 'object' ? JSON.stringify(result) : String(result);
          
          return {
            content: [
              {
                type: "text",
                text: `Evaluation result: ${resultText}`,
              },
            ],
            result: resultText,
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Evaluation failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "closePage": {
        const { pageId } = ClosePageSchema.parse(params);
        
        const page = pages.get(pageId);
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Page with ID ${pageId} not found`,
              },
            ],
          };
        }
        
        try {
          await page.close();
          pages.delete(pageId);
          
          return {
            content: [
              {
                type: "text",
                text: `Page ${pageId} closed successfully`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Closing page failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      case "closeBrowser": {
        if (!browser) {
          return {
            content: [
              {
                type: "text",
                text: "Browser was not running",
              },
            ],
          };
        }
        
        try {
          await browser.close();
          browser = null;
          pages.clear();
          
          return {
            content: [
              {
                type: "text",
                text: "Browser closed successfully",
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Closing browser failed: ${error.message}`,
              },
            ],
          };
        }
      }
      
      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
        };
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid input: ${JSON.stringify(error.errors)}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Puppeteer MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}); 