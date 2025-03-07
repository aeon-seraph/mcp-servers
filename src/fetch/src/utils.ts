import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

export async function fetch_url(url: string, user_agent: string, timeout: number = 10000, retries: number = 2): Promise<[string, string] | null> {
    const headers = {
        "User-Agent": user_agent,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            return [await response.text(), contentType];
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error');

            // Only retry on network errors, not HTTP errors
            const isNetworkError = !(lastError.message.includes('HTTP error'));
            const isTimeout = lastError.name === 'AbortError';

            if (attempt < retries && (isNetworkError || isTimeout)) {
                console.error(`Fetch attempt ${attempt + 1}/${retries + 1} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            break;
        }
    }

    // All retries exhausted
    console.error("Error making HTTP request:", lastError);
    if (lastError) {
        const message = lastError.name === 'AbortError'
            ? 'Request timed out'
            : lastError.message;
        return [`<e>Failed to fetch: ${message} after ${retries + 1} attempts</e>`, "text/plain"];
    }
    return [`<e>Failed to fetch: Unknown error</e>`, "text/plain"];
}


export function extractContentFromHtml(html: string): string {
    try {
        const dom = new JSDOM(html);

        const reader = new Readability(dom.window.document, {
            charThreshold: 20,           // Minimum number of characters for content to be considered an article
            classesToPreserve: ['code'], // Preserve code blocks for better markdown conversion
            keepClasses: false,          // Remove most classes for cleaner output
            debug: false
        });

        const article = reader.parse();

        if (!article || !article.content) {
            return "<e>Page failed to be simplified from HTML</e>";
        }

        const documentTitle = article.title || dom.window.document.title || "Untitled Page";
        const siteName = article.siteName || "";

        // Convert to markdown
        const turndownService = new TurndownService({
            headingStyle: 'atx',    // Use # style headings
            codeBlockStyle: 'fenced', // Use ``` for code blocks
            bulletListMarker: '-',  // Use - for bullet lists
            emDelimiter: '_',       // Use _ for emphasis
            strongDelimiter: '**'   // Use ** for strong
        });

        turndownService.addRule('codeBlocks', {
            filter: ['pre', 'code'],
            replacement: function(content, node) {
                return '\n```\n' + content + '\n```\n';
            }
        });

        const markdownContent = turndownService.turndown(article.content);
        const titleSection = `# ${documentTitle}${siteName ? ` | ${siteName}` : ''}\n\n`;

        return titleSection + markdownContent;
    } catch (error) {
        console.error("Error processing HTML content:", error);
        if (error instanceof Error) {
            return `<e>Page failed to be simplified from HTML: ${error.message}</e>`;
        }
        return "<e>Page failed to be simplified from HTML</e>";
    }
}

