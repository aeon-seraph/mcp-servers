# Puppeteer MCP Server

An MCP server that provides browser automation capabilities using Puppeteer.

## Installation & Usage

```bash
npm install
npm run build
node build/index.js  # or use 'puppeteer-server' after installation
```

## Available Tools

- `launchBrowser`: Start a new browser instance (params: headless, defaultViewport)
- `newPage`: Create a new page (params: viewportWidth, viewportHeight)
- `navigate`: Go to a URL (params: pageId, url, timeout, waitUntil)
- `screenshot`: Take a screenshot (params: pageId, fullPage, type, quality)
- `getContent`: Get HTML content (params: pageId, selector)
- `click`: Click on an element (params: pageId, selector, clickCount, delay)
- `type`: Type text into a field (params: pageId, selector, text, delay)
- `evaluate`: Run JavaScript (params: pageId, expression)
- `closePage`: Close a specific page (params: pageId)
- `closeBrowser`: Close browser and all pages

## Example Usage Flow

1. Launch browser → 2. Create page → 3. Navigate → 4. Interact/Screenshot → 5. Close

## Response Format

All responses include:
- `content`: Array of text content parts
- Screenshots return a separate `screenshot` field with base64 data

## Troubleshooting

- Browser runs in headless mode by default
- All pages are tracked with unique IDs
- For debugging, set `headless: false`
- Ensure responses follow MCP protocol format 