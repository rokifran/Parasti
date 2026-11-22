#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Read config from env or .dev.vars
function getEnvConfig() {
  const env = process.env;
  let url = env.PARASTI_URL || 'http://localhost:3000';
  let apiToken = env.PARASTI_API_TOKEN || env.PARASTI_TOKEN;
  let username = env.PARASTI_USERNAME || env.AUTH_USERNAME;
  let password = env.PARASTI_PASSWORD || env.AUTH_PASSWORD;

  if (!apiToken && (!username || !password)) {
    const searchPaths = [
      path.resolve(process.cwd(), '.dev.vars'),
      path.resolve(process.cwd(), '.env'),
      path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '.dev.vars'),
      path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '.env'),
    ];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const m = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
          if (!m) continue;
          const [, k, vRaw] = m;
          let v = vRaw.trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (k === 'PARASTI_API_TOKEN' && !apiToken) apiToken = v;
          if (k === 'AUTH_USERNAME' && !username) username = v;
          if (k === 'AUTH_PASSWORD' && !password) password = v;
          if (k === 'PARASTI_URL' && env.PARASTI_URL === undefined) url = v;
        }
      }
    }
  }

  return {
    url: url.replace(/\/+$/, ''),
    apiToken: apiToken || null,
    username: username || 'admin',
    password: password || 'admin',
  };
}

const config = getEnvConfig();
let cachedToken: string | null = config.apiToken;
let tokenExpiresAt = config.apiToken ? Infinity : 0;

// PARASTI_API_TOKEN wins when present: each account has its own token and only
// sees its owner's data. The username/password path stays as a fallback for
// local runs that have not created a token yet.
async function getAuthToken(): Promise<string> {
  if (config.apiToken) {
    return config.apiToken;
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const res = await fetch(`${config.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Parasti authentication failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { token: string; expiresAt?: number };
  cachedToken = data.token;
  tokenExpiresAt = data.expiresAt ? data.expiresAt * 1000 : now + 24 * 60 * 60 * 1000;
  return cachedToken;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = await getAuthToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(`${config.url}${endpoint}`, {
    ...options,
    headers,
  });

  // Retry once if token expired
  if (res.status === 401) {
    cachedToken = null;
    token = await getAuthToken();
    headers.set('Authorization', `Bearer ${token}`);
    res = await fetch(`${config.url}${endpoint}`, {
      ...options,
      headers,
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parasti API error [${res.status}] ${endpoint}: ${text}`);
  }

  return (await res.json()) as T;
}

// Supported image types for upload_image. The server stores the multipart
// part's MIME type, and the UI picks an image block from it.
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface UploadedFile {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  page_id?: string | null;
  created_at?: string;
  url: string;
}

// POST /api/files/upload is multipart, which the JSON-only apiRequest cannot
// send. Auth still comes from getAuthToken, and a 401 retries once like above.
async function uploadFile(filePath: string, pageId: string | null): Promise<UploadedFile> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = IMAGE_MIME_TYPES[ext];
  if (!mime) {
    throw new Error(`Unsupported image type: ${ext || '(no extension)'}`);
  }

  const bytes = fs.readFileSync(resolved);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('File too large (max 25MB)');
  }

  const buildForm = () => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), path.basename(resolved));
    if (pageId) form.append('page_id', pageId);
    return form;
  };

  const send = async () => {
    const token = await getAuthToken();
    return fetch(`${config.url}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: buildForm(),
    });
  };

  let res = await send();
  if (res.status === 401) {
    cachedToken = null;
    res = await send();
  }

  if (!res.ok) {
    throw new Error(`Parasti API error [${res.status}] /api/files/upload: ${await res.text()}`);
  }

  const data = (await res.json()) as { file: UploadedFile };
  return data.file;
}

// Same insertion rules as src/utils/blockTree.ts positionBetween, so images
// land where the editor itself would put them.
function positionBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}

// Create MCP server instance
const packageVersion = (() => {
  for (const rel of ['./package.json', '../package.json']) {
    try {
      return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8')).version as string;
    } catch {
      // Try the next location (source vs compiled dist/).
    }
  }
  return '0.0.0';
})();

const server = new McpServer({
  name: 'parasti-mcp',
  version: packageVersion,
});

// Tool: import_markdown
server.tool(
  'import_markdown',
  'Import raw Markdown content into Parasti as a new page with parsed blocks.',
  {
    markdown: z.string().describe('The markdown content to import'),
    title: z.string().optional().describe('Optional title for the page. If omitted, will be extracted from the first # H1 header or titled "Untitled"'),
    parentId: z.string().optional().describe('Optional parent page ID to nest this page under. Omit for root level.'),
  },
  async ({ markdown, title, parentId }) => {
    try {
      const res = await apiRequest<{ page: any }>('/api/pages/import', {
        method: 'POST',
        body: JSON.stringify({
          markdown,
          title: title || undefined,
          parent_id: parentId || null,
        }),
      });

      const page = res.page;
      return {
        content: [
          {
            type: 'text',
            text: `Successfully created page "${page.title}" (ID: ${page.id}) in Parasti with ${page.blocks?.length || 0} blocks.\nView at: ${config.url}/page/${page.id}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to import markdown: ${err.message}` }],
      };
    }
  }
);

// Tool: import_markdown_file
server.tool(
  'import_markdown_file',
  'Read a local .md file and import it into Parasti as a new page.',
  {
    filePath: z.string().describe('Absolute or relative path to the .md file'),
    title: z.string().optional().describe('Optional title for the page. If omitted, uses the filename without extension or first header.'),
    parentId: z.string().optional().describe('Optional parent page ID to nest under. Omit for root level.'),
  },
  async ({ filePath, title, parentId }) => {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `File not found: ${filePath}` }],
        };
      }

      const content = fs.readFileSync(resolved, 'utf8');
      const inferredTitle = title || path.basename(resolved, path.extname(resolved));

      const res = await apiRequest<{ page: any }>('/api/pages/import', {
        method: 'POST',
        body: JSON.stringify({
          markdown: content,
          title: inferredTitle,
          parent_id: parentId || null,
        }),
      });

      const page = res.page;
      return {
        content: [
          {
            type: 'text',
            text: `Successfully imported file "${path.basename(resolved)}" as page "${page.title}" (ID: ${page.id}) with ${page.blocks?.length || 0} blocks.\nView at: ${config.url}/page/${page.id}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to import markdown file: ${err.message}` }],
      };
    }
  }
);

// Tool: list_pages
server.tool(
  'list_pages',
  'List all pages in Parasti workspace to inspect the hierarchy and obtain page IDs.',
  {},
  async () => {
    try {
      const res = await apiRequest<{ pages: any[] }>('/api/pages');
      const pages = res.pages || [];
      if (pages.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pages found in the workspace.' }],
        };
      }

      const lines = pages.map((p) => {
        const icon = p.icon || '📄';
        const projectTag = p.is_project ? ' [project]' : '';
        const parentInfo = p.parent_id ? ` (parent: ${p.parent_id})` : ' (root)';
        return `- ${icon} [${p.title}] (ID: ${p.id})${projectTag}${parentInfo}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Workspace pages (${pages.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list pages: ${err.message}` }],
      };
    }
  }
);

// Tool: search_pages
server.tool(
  'search_pages',
  'Search page titles, block contents and label names in Parasti.',
  {
    query: z.string().describe('Search query string'),
  },
  async ({ query }) => {
    try {
      const res = await apiRequest<{ results: any[] }>(`/api/search?q=${encodeURIComponent(query)}`);
      const results = res.results || [];
      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}".` }],
        };
      }

      const formatted = results.map((r) => {
        if (r.match_type === 'label') {
          return `- [Label: ${r.title || 'Untitled'}] (Label ID: ${r.id})`;
        }
        const kind = r.match_type === 'block'
          ? (r.block_type ? `block ${r.block_type}` : 'block')
          : 'page';
        const pageId = r.page_id ? `, Page ID: ${r.page_id}` : '';
        return `- [${r.title || 'Untitled'}] (${kind}${pageId})\n  Match: ${r.snippet || ''}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Search results for "${query}" (${results.length}):\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to search pages: ${err.message}` }],
      };
    }
  }
);

// Tool: get_page
server.tool(
  'get_page',
  'Get details and blocks of a specific page by ID.',
  {
    pageId: z.string().describe('ID of the page to retrieve'),
  },
  async ({ pageId }) => {
    try {
      const res = await apiRequest<{ page: any }>(`/api/pages/${pageId}`);
      const page = res.page;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(page, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to get page: ${err.message}` }],
      };
    }
  }
);

// Tool: create_event
server.tool(
  'create_event',
  'Create a calendar event in Parasti. Times are wall-clock HH:MM strings; omit both for an all-day event.',
  {
    title: z.string().describe('Event title'),
    event_date: z.string().describe('Event date in YYYY-MM-DD format'),
    start_time: z.string().optional().describe('Start time in HH:MM (24h). Omit for an all-day event.'),
    end_time: z.string().optional().describe('End time in HH:MM (24h). Omit for an all-day event.'),
  },
  async ({ title, event_date, start_time, end_time }) => {
    try {
      const res = await apiRequest<{ event: any }>('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          title,
          event_date,
          start_time: start_time?.trim() || null,
          end_time: end_time?.trim() || null,
        }),
      });

      const event = res.event;
      const time = event.start_time
        ? event.end_time
          ? `${event.start_time}-${event.end_time}`
          : event.start_time
        : 'all-day';
      return {
        content: [
          {
            type: 'text',
            text: `Created event "${event.title}" on ${event.event_date} at ${time} (ID: ${event.id})`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to create event: ${err.message}` }],
      };
    }
  }
);

// Tool: list_events
server.tool(
  'list_events',
  'List calendar events in Parasti. Provide both from and to (YYYY-MM-DD) to filter a date range, or omit both to list every event.',
  {
    from: z.string().optional().describe('Start date of the range, inclusive, in YYYY-MM-DD format. Requires to.'),
    to: z.string().optional().describe('End date of the range, inclusive, in YYYY-MM-DD format. Requires from.'),
  },
  async ({ from, to }) => {
    try {
      const hasFrom = Boolean(from && from.trim());
      const hasTo = Boolean(to && to.trim());
      // The API rejects a range with only one bound, so ask for both instead of
      // passing through a guaranteed 400.
      if (hasFrom !== hasTo) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Provide both "from" and "to" (YYYY-MM-DD), or omit both to list every event.' }],
        };
      }

      const query = hasFrom
        ? `?from=${encodeURIComponent(from!.trim())}&to=${encodeURIComponent(to!.trim())}`
        : '';
      const res = await apiRequest<{ events: any[] }>(`/api/events${query}`);
      const events = res.events || [];
      if (events.length === 0) {
        return {
          content: [{ type: 'text', text: 'No events found.' }],
        };
      }

      const lines = events.map((e) => {
        const time = e.start_time
          ? e.end_time
            ? `${e.start_time}-${e.end_time}`
            : e.start_time
          : 'all-day';
        return `- ${e.event_date} ${time} ${e.title} (ID: ${e.id})`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `Events (${events.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list events: ${err.message}` }],
      };
    }
  }
);

// Tool: update_event
server.tool(
  'update_event',
  'Update a calendar event in Parasti. Replace total: semua field harus diisi. Bukan partial update.',
  {
    eventId: z.string().describe('ID of the event to update'),
    title: z.string().describe('New event title'),
    event_date: z.string().describe('New event date in YYYY-MM-DD format'),
    start_time: z.string().optional().describe('New start time in HH:MM (24h). Omit for an all-day event.'),
    end_time: z.string().optional().describe('New end time in HH:MM (24h). Omit for an all-day event.'),
  },
  async ({ eventId, title, event_date, start_time, end_time }) => {
    try {
      const res = await apiRequest<{ event: any }>(`/api/events/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          event_date,
          start_time: start_time?.trim() || null,
          end_time: end_time?.trim() || null,
        }),
      });

      const event = res.event;
      const time = event.start_time
        ? event.end_time
          ? `${event.start_time}-${event.end_time}`
          : event.start_time
        : 'all-day';
      return {
        content: [
          {
            type: 'text',
            text: `Updated event "${event.title}" on ${event.event_date} at ${time} (ID: ${event.id})`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to update event: ${err.message}` }],
      };
    }
  }
);

// Tool: delete_event
server.tool(
  'delete_event',
  'Delete a calendar event permanently. DESTRUKTIF dan permanen. Hanya panggil setelah user mengkonfirmasi.',
  {
    eventId: z.string().describe('ID of the event to delete'),
  },
  async ({ eventId }) => {
    try {
      const res = await apiRequest<{ success: boolean; deleted: number }>(
        `/api/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' }
      );
      return {
        content: [
          {
            type: 'text',
            text: `Deleted event ${eventId}. Response: ${JSON.stringify(res)}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to delete event: ${err.message}` }],
      };
    }
  }
);

// Tool: list_tasks
server.tool(
  'list_tasks',
  'List tasks in Parasti. Can work through overdue tasks and today\'s tasks. "Today" follows the institution\'s TIMEZONE, not the server clock or the caller\'s timezone.',
  {
    due: z.enum(['overdue', 'today', 'upcoming', 'actionable', 'all']).optional().describe('Bucket to list. "actionable" = overdue + today. Defaults to actionable.'),
    status: z.enum(['open', 'done', 'cancelled', 'all']).optional().describe('Status filter. Default: open for dated buckets, all when due is "all".'),
  },
  async ({ due, status }) => {
    try {
      const query = new URLSearchParams();
      query.set('due', due || 'actionable');
      if (status) query.set('status', status);
      const res = await apiRequest<{ tasks: any[]; today: string; timezone: string }>(
        `/api/tasks?${query.toString()}`
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list tasks: ${err.message}` }],
      };
    }
  }
);

// Tool: list_labels
server.tool(
  'list_labels',
  'List all labels in Parasti. Labels are per-user and can be attached to pages, tasks and events; use the returned IDs with the label items endpoint.',
  {},
  async () => {
    try {
      const res = await apiRequest<{ labels: Array<{ id: string; name: string; color: string | null }> }>('/api/labels');
      if (res.labels.length === 0) {
        return { content: [{ type: 'text', text: 'No labels found.' }] };
      }
      return {
        content: [
          {
            type: 'text',
            text: res.labels.map(label => `- ${label.name} (ID: ${label.id}, color: ${label.color || 'none'})`).join('\n'),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list labels: ${err.message}` }],
      };
    }
  }
);

// Tool: find_by_label
server.tool(
  'find_by_label',
  'Find everything carrying a label: pages, tasks and events grouped together. Matches the label name exactly (case-insensitive).',
  {
    name: z.string().describe('Label name, e.g. "diet"'),
  },
  async ({ name }) => {
    try {
      const { labels } = await apiRequest<{ labels: Array<{ id: string; name: string }> }>('/api/labels');
      const wanted = name.trim().toLowerCase();
      const label = labels.find(item => item.name.toLowerCase() === wanted);
      if (!label) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Label not found. Use list_labels to see the exact names.' }],
        };
      }

      const items = await apiRequest<any>(`/api/labels/${encodeURIComponent(label.id)}/items`);
      const summary = [
        `Label: ${items.label.name} (ID: ${items.label.id})`,
        `Pages: ${items.pages.length}`,
        `Tasks: ${items.tasks.length}`,
        `Events: ${items.events.length}`,
      ].join('\n');
      return {
        content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(items, null, 2)}` }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to find items for label: ${err.message}` }],
      };
    }
  }
);

// Tool: create_task
server.tool(
  'create_task',
  'Create a task in Parasti with a due date and an optional time. Tasks belong to the token\'s owner.',
  {
    title: z.string().describe('Task title, 1-200 characters'),
    due_date: z.string().describe('Due date in YYYY-MM-DD format'),
    due_time: z.string().optional().describe('Optional time in HH:MM (24h). Omit for an all-day task.'),
    pageId: z.string().optional().describe('Optional page ID to link the task to. The page must belong to the token owner (run list_pages to get IDs). Omit for an unlinked task.'),
  },
  async ({ title, due_date, due_time, pageId }) => {
    try {
      const res = await apiRequest<{ task: any }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          due_date,
          due_time: due_time?.trim() || null,
          page_id: pageId?.trim() || null,
        }),
      });
      const task = res.task;
      const time = task.due_time ? ` at ${task.due_time}` : '';
      const linked = task.page_id ? `, linked to page ${task.page_id}` : '';
      return {
        content: [
          {
            type: 'text',
            text: `Created task "${task.title}" due ${task.due_date}${time}${linked} (ID: ${task.id})`,
          },
        ],
      };
    } catch (err: any) {
      const hint = err.message.includes('Page not found')
        ? '. The pageId was not found or is not yours: run list_pages to get valid IDs.'
        : '';
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to create task: ${err.message}${hint}` }],
      };
    }
  }
);

// Tool: complete_task
server.tool(
  'complete_task',
  'Mark a Parasti task as done.',
  {
    id: z.string().describe('ID of the task to complete'),
  },
  async ({ id }) => {
    try {
      const res = await apiRequest<{ task: any }>(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Completed task "${res.task.title}" (ID: ${res.task.id})`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to complete task: ${err.message}` }],
      };
    }
  }
);

// Tool: update_task
server.tool(
  'update_task',
  'Update a Parasti task: rename it, reschedule it, reopen it, cancel it, or link/unlink a page. Partial update: only the fields you pass are changed.',
  {
    id: z.string().describe('ID of the task to update'),
    title: z.string().optional().describe('New title, 1-200 characters. Omit to keep the current one.'),
    due_date: z.string().optional().describe('New due date in YYYY-MM-DD format. Omit to keep the current one.'),
    due_time: z.string().optional().describe('New time in HH:MM (24h). Pass an empty string to clear the time (all-day task). Omit to keep the current one.'),
    status: z.enum(['open', 'done', 'cancelled']).optional().describe("New status. 'open' reopens a done or cancelled task, 'cancelled' abandons it. Omit to keep the current one."),
    pageId: z.string().optional().describe('Page ID to link the task to (must belong to the token owner). Pass an empty string to unlink. Omit to keep the current link.'),
  },
  async ({ id, title, due_date, due_time, status, pageId }) => {
    try {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (due_date !== undefined) body.due_date = due_date;
      // An empty string explicitly clears the time; the server treats it as null.
      if (due_time !== undefined) body.due_time = due_time === '' ? null : due_time;
      if (status !== undefined) body.status = status;
      if (pageId !== undefined) body.page_id = pageId === '' ? null : pageId;

      if (Object.keys(body).length === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Nothing to update: pass at least one of title, due_date, due_time, status, pageId.',
            },
          ],
        };
      }

      const res = await apiRequest<{ task: any }>(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const task = res.task;
      const time = task.due_time ? ` at ${task.due_time}` : '';
      const linked = task.page_id ? `, linked to page ${task.page_id}` : ', unlinked';
      return {
        content: [
          {
            type: 'text',
            text: `Updated task "${task.title}" (ID: ${task.id}): due ${task.due_date}${time}, status ${task.status}${linked}`,
          },
        ],
      };
    } catch (err: any) {
      const hint = err.message.includes('Page not found')
        ? '. The pageId was not found or is not yours: run list_pages to get valid IDs.'
        : '';
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to update task: ${err.message}${hint}` }],
      };
    }
  }
);

// Tool: delete_task
server.tool(
  'delete_task',
  'Delete a task permanently. DESTRUKTIF dan permanen. Hanya panggil setelah user mengkonfirmasi.',
  {
    id: z.string().describe('ID of the task to delete'),
  },
  async ({ id }) => {
    try {
      const res = await apiRequest<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return {
        content: [
          {
            type: 'text',
            text: `Deleted task ${id}. Response: ${JSON.stringify(res)}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to delete task: ${err.message}` }],
      };
    }
  }
);

// Tool: get_config
// GET /api/config is public (the client reads it before login), so this call
// works without a valid token too — which is exactly what makes it useful for
// diagnosing an instance that disabled a module (e.g. FEATURES=none).
server.tool(
  'get_config',
  'Read the Parasti instance configuration: which modules are enabled (features), the institution timezone that decides "today" for tasks, and whether Google sync is configured. No authentication required.',
  {},
  async () => {
    try {
      const res = await fetch(`${config.url}/api/config`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to read config: ${err.message}` }],
      };
    }
  }
);

// Tool: create_project
server.tool(
  'create_project',
  'Create a project in Parasti: a root page flagged as a project.',
  {
    title: z.string().describe('Project title'),
    icon: z.string().max(32).optional().describe('Optional emoji or icon, max 32 characters. Defaults to 📁.'),
  },
  async ({ title, icon }) => {
    try {
      const res = await apiRequest<{ page: any }>('/api/pages', {
        method: 'POST',
        body: JSON.stringify({
          title,
          icon: icon || '📁',
          parent_id: null,
        }),
      });

      const page = res.page;
      try {
        // POST /api/pages cannot set is_project; only PUT accepts the flag.
        await apiRequest(`/api/pages/${encodeURIComponent(page.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ is_project: true }),
        });
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Page "${page.title}" was created as a normal page (ID: ${page.id}), but marking it as a project failed: ${err.message}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Created project "${page.title}" (ID: ${page.id})\nView at: ${config.url}/page/${page.id}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to create project: ${err.message}` }],
      };
    }
  }
);

// Tool: list_projects
server.tool(
  'list_projects',
  'List all projects in Parasti (root pages flagged as projects).',
  {},
  async () => {
    try {
      const res = await apiRequest<{ pages: any[] }>('/api/pages');
      const projects = (res.pages || []).filter((p) => p.is_project === true && p.parent_id === null);
      if (projects.length === 0) {
        return {
          content: [{ type: 'text', text: 'No projects found.' }],
        };
      }

      const lines = projects.map((p) => `- ${p.icon || '📁'} ${p.title} (ID: ${p.id})`);
      return {
        content: [
          {
            type: 'text',
            text: `Projects (${projects.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list projects: ${err.message}` }],
      };
    }
  }
);

// Tool: create_page
server.tool(
  'create_page',
  'Create an empty page in Parasti. Pass parentId to make it a sub-page of a project or private page; omit parentId for a root page.',
  {
    title: z.string().describe('Page title'),
    icon: z.string().max(32).optional().describe('Optional emoji or icon, max 32 characters.'),
    parentId: z.string().optional().describe('Optional parent page ID. Omit to create a root page.'),
  },
  async ({ title, icon, parentId }) => {
    try {
      const parent = parentId?.trim() || null;
      if (parent) {
        try {
          await apiRequest(`/api/pages/${encodeURIComponent(parent)}`);
        } catch {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Parent page ID tidak ditemukan. Jalankan list_pages atau list_projects dulu untuk mengambil ID yang benar.',
              },
            ],
          };
        }
      }

      const res = await apiRequest<{ page: any }>('/api/pages', {
        method: 'POST',
        body: JSON.stringify({
          title,
          icon: icon || undefined,
          parent_id: parent,
        }),
      });

      const page = res.page;
      const location = parent ? `under parent ${parent}` : 'at root level';
      return {
        content: [
          {
            type: 'text',
            text: `Created page "${page.title}" (ID: ${page.id}) ${location}\nView at: ${config.url}/page/${page.id}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to create page: ${err.message}` }],
      };
    }
  }
);

// Tool: upload_image
server.tool(
  'upload_image',
  'Upload a local image file into a Parasti page as an image block. Insert it after a given block, at an index, or append it at the end.',
  {
    filePath: z.string().describe('Path to a local image file (png, jpg, jpeg, gif, webp, svg, bmp, avif)'),
    pageId: z.string().describe('ID of the page that will receive the image'),
    afterBlockId: z.string().optional().describe('Insert the image right after this block ID'),
    positionIndex: z.number().int().min(0).optional().describe('Insert the image before the block at this 0-based index'),
    caption: z.string().optional().describe('Optional caption stored in props.caption'),
    alt: z.string().optional().describe('Optional alt text stored in the block language field'),
  },
  async ({ filePath, pageId, afterBlockId, positionIndex, caption, alt }) => {
    try {
      let pageRes: { page: any };
      try {
        pageRes = await apiRequest<{ page: any }>(`/api/pages/${encodeURIComponent(pageId)}`);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Page ID tidak ditemukan. Jalankan list_pages dulu untuk mengambil ID yang benar.',
            },
          ],
        };
      }

      const blocks: any[] = pageRes.page?.blocks || [];
      let position: number;
      if (afterBlockId) {
        const index = blocks.findIndex((b) => b.id === afterBlockId);
        if (index === -1) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Block ID tidak ditemukan di halaman ini. Jalankan get_page untuk melihat ID blok yang valid.',
              },
            ],
          };
        }
        position = positionBetween(blocks[index].position, blocks[index + 1]?.position);
      } else if (positionIndex !== undefined) {
        const index = Math.min(positionIndex, blocks.length);
        position = positionBetween(blocks[index - 1]?.position, blocks[index]?.position);
      } else {
        position = positionBetween(blocks[blocks.length - 1]?.position, undefined);
      }

      const file = await uploadFile(filePath, pageId);
      const props: Record<string, unknown> = {};
      if (caption) props.caption = caption;

      const blockRes = await apiRequest<{ block: any }>(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'image',
          content: file.id,
          position,
          language: alt || '',
          props,
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Uploaded image "${file.name}" (${file.size} bytes) into page ${pageId} as image block ${blockRes.block.id} at position ${position}.\nImage URL: ${config.url}${file.url}\nView page: ${config.url}/page/${pageId}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to upload image: ${err.message}` }],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[parasti-mcp] Server running on stdio');
}

main().catch((err) => {
  console.error('[parasti-mcp] Fatal error:', err);
  process.exit(1);
});
