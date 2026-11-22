# Parasti MCP Server

Official [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server to connect Artificial Intelligence assistants (Claude Desktop, Cursor, Zed, Antigravity, etc.) directly to your **Parasti** workspace.

It allows any LLM or AI agent to:
- Create pages and import structured Markdown documents into pages and native blocks.
- Upload local `.md` files directly from disk.
- Query the workspace page hierarchy and retrieve page identifiers (`parentId`).
- Search across existing pages and blocks in Parasti.
- Inspect page details and ordered blocks by page ID.
- Upload local images into a page at a chosen position.
- Manage your personal tasks: see what is overdue and due today, create tasks with due dates, reschedule, reopen, cancel, complete, or delete them.
- Browse labels and everything tagged with them across pages, tasks and events.

Beyond pages, this server can also write your calendar, create projects, place images, and manage your tasks: it creates, lists, updates, and deletes events, builds project roots with nested sub-pages, inserts image blocks after a given block or at a given index, and keeps your task list up to date.

---

## Authentication: Generating an API Token

Parasti uses dedicated, long-lived API tokens for MCP integrations. This allows AI assistants to authenticate without requiring or exposing your account password.

You can generate a token in two ways:

1. **From the Web UI (Recommended)**:
   - Open Parasti in your browser (`http://localhost:5173`).
   - Click on your user avatar at the bottom of the sidebar.
   - Select **API / MCP Token**.
   - Click **Generate Token** and copy either the token or the pre-formatted JSON snippet.

2. **From the Terminal (CLI)**:
   ```bash
   pnpm run mcp:token
   ```

Each family member uses their own API token, created from their own account
under **Profile → API / MCP Token**. A token only grants access to the data
owned by the account that created it; use `PARASTI_API_TOKEN` instead of
sharing one username and password.

---

## Available Tools

| Tool | Arguments | Description |
|---|---|---|
| `import_markdown` | `markdown` *(string, required)*<br>`title` *(string, optional)*<br>`parentId` *(string, optional)* | Imports raw Markdown content as a new page divided into blocks (headings, todos, code blocks, tables, KaTeX, etc.). |
| `import_markdown_file` | `filePath` *(string, required)*<br>`title` *(string, optional)*<br>`parentId` *(string, optional)* | Reads a local `.md` file from disk and imports it as a new page. |
| `list_pages` | *(none)* | Returns the workspace page hierarchy with icon, title, ID, and relationship (`root` or `parent`). |
| `search_pages` | `query` *(string, required)* | Searches for text within all pages and blocks. |
| `get_page` | `pageId` *(string, required)* | Retrieves the full page object and all ordered blocks. |
| `create_event` | `title` *(string, required)*<br>`event_date` *(string, required, `YYYY-MM-DD`)*<br>`start_time` *(string, optional, `HH:MM`)*<br>`end_time` *(string, optional, `HH:MM`)* | Creates a calendar event. Omit both times for an all-day event. |
| `list_events` | `from` *(string, optional, `YYYY-MM-DD`)*<br>`to` *(string, optional, `YYYY-MM-DD`)* | Lists events, optionally restricted to an inclusive date range. Provide both bounds or neither. |
| `update_event` | `eventId` *(string, required)*<br>`title` *(string, required)*<br>`event_date` *(string, required, `YYYY-MM-DD`)*<br>`start_time` *(string, optional, `HH:MM`)*<br>`end_time` *(string, optional, `HH:MM`)* | Replaces an event. All fields must be supplied; this is not a partial update. |
| `delete_event` | `eventId` *(string, required)* | Permanently deletes an event. Destructive: only call after the user confirms. |
| `list_tasks` | `due` *(string, optional: `overdue` \| `today` \| `upcoming` \| `actionable` \| `all`, default `actionable`)*<br>`status` *(string, optional: `open` \| `done` \| `cancelled` \| `all`)* | Lists tasks. `actionable` means overdue + today; "today" follows the institution timezone. Each task includes its `priority` and `labels`. |
| `create_task` | `title` *(string, required)*<br>`due_date` *(string, required, `YYYY-MM-DD`)*<br>`due_time` *(string, optional, `HH:MM`)*<br>`pageId` *(string, optional)* | Creates a task. Omit `due_time` for an all-day task. Optionally links it to a page you own. |
| `complete_task` | `id` *(string, required)* | Marks a task as done. |
| `update_task` | `id` *(string, required)*<br>`title` *(string, optional)*<br>`due_date` *(string, optional, `YYYY-MM-DD`)*<br>`due_time` *(string, optional, `HH:MM`)*<br>`status` *(string, optional: `open` \| `done` \| `cancelled`)*<br>`pageId` *(string, optional)* | Partial update: renames, reschedules, reopens, cancels, or links/unlinks a page. Empty `due_time` clears the time; empty `pageId` unlinks. Only passed fields change. |
| `delete_task` | `id` *(string, required)* | Permanently deletes a task. Destructive: only call after the user confirms. |
| `list_labels` | *(none)* | Lists all labels with their IDs. Labels are per-user and can tag pages, tasks and events. |
| `find_by_label` | `name` *(string, required)* | Finds everything carrying a label, grouped as pages, tasks and events. Matches the exact name (case-insensitive). |
| `get_config` | *(none)* | Reads the instance configuration: enabled modules (`features`), the institution timezone that decides "today", and whether Google sync is configured. Public — no token needed. |
| `create_project` | `title` *(string, required)*<br>`icon` *(string, optional, max 32 chars)* | Creates a root page flagged as a project. |
| `list_projects` | *(none)* | Lists projects (root pages with `is_project`). |
| `create_page` | `title` *(string, required)*<br>`icon` *(string, optional, max 32 chars)*<br>`parentId` *(string, optional)* | Creates an empty page, optionally nested under a project or private page. |
| `upload_image` | `filePath` *(string, required)*<br>`pageId` *(string, required)*<br>`afterBlockId` *(string, optional)*<br>`positionIndex` *(number, optional)*<br>`caption` *(string, optional)*<br>`alt` *(string, optional)* | Uploads a local image (png, jpg, gif, webp, svg, bmp, avif; max 25 MB) as an image block. Inserts after a block, before an index, or appends at the end. |

---

## Example Questions for the Agent

- "Apa tugas yang harus saya kerjakan hari ini?"
- "Tugas apa yang sudah terlambat?"
- "Buat tugas 'Kirim laporan' untuk besok."
- "Tandai tugas <id> sebagai selesai."
- "Buka kembali tugas <id> yang tadi kuselesaikan."
- "Geser tenggat tugas <id> ke Jumat depan."
- "Hapus tugas <id>."
- "What do I have under the label 'diet'?"
- "List my labels."
- "Tugas diet apa yang harus kukerjakan hari ini?"
- "Fitur apa saja yang aktif di instansi Parasti-ku?"

The agent reads tasks through `list_tasks`; overdue and today are decided by
the server's `TIMEZONE`, so asking on a phone in another timezone still matches
the institution's calendar. `get_config` tells the agent which modules are
active and that timezone — so when a module is disabled (`FEATURES=none`), it
can explain why the task tools return 404 instead of showing a raw error.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PARASTI_URL` | Base URL of your Parasti instance (e.g. `http://localhost:3000` or `https://your-app.workers.dev`). |
| `PARASTI_API_TOKEN` | Dedicated API token generated from the UI or CLI (Recommended). |
| `PARASTI_USERNAME` | Username fallback (if no token is provided). |
| `PARASTI_PASSWORD` | Password fallback (if no token is provided). |

---

## Client Setup

### 1. Claude Desktop

Add the server definition to your configuration file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "parasti": {
      "command": "npx",
      "args": ["-y", "parasti-mcp"],
      "env": {
        "PARASTI_URL": "http://localhost:3000",
        "PARASTI_API_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```
*(Running from a fork or a local checkout instead? Use `"args": ["-y", "tsx", "path/to/parasti/mcp/index.ts"]` with your absolute path.)*

### 2. Cursor IDE

Add to `.cursor/mcp.json` or your Cursor MCP settings:

```json
{
  "mcpServers": {
    "parasti": {
      "command": "npx",
      "args": ["-y", "parasti-mcp"],
      "env": {
        "PARASTI_URL": "http://localhost:3000",
        "PARASTI_API_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```
*(Running from source: `"args": ["-y", "tsx", "mcp/index.ts"]` from the repository root.)*

---

## Development & Release

The npm package is built straight from `mcp/index.ts` — that file is the single
source of truth; nothing is duplicated.

Releases are automated through npm **trusted publishing (OIDC)** — see
[`.github/workflows/publish-mcp.yml`](../.github/workflows/publish-mcp.yml):

```bash
# bump the version in mcp/package.json first, then:
git tag mcp-v1.2.3
git push origin mcp-v1.2.3
```

The workflow verifies the tag matches the package version, compiles
`mcp/dist/index.js`, smoke-tests the stdio handshake, and publishes to npm —
no npm token and no interactive 2FA involved.

Local build, when you need one:

```bash
pnpm run mcp:build        # compile mcp/index.ts -> mcp/dist/index.js
```

---

## Automated Tests

To verify all MCP tools against a running instance:

```bash
# Ensure Parasti is running locally
pnpm run test:mcp
```

The test suite automatically validates:
1. JSON-RPC 2.0 stdio initialization and handshake.
2. Querying pages via `list_pages`.
3. Creating a page with rich Markdown elements via `import_markdown`.
4. Importing a local `.md` file as a nested subpage via `import_markdown_file`.
5. Searching content via `search_pages`.
6. Validating block integrity via `get_page`.

---

## Example Files

The [`mcp/examples/`](./examples) directory contains:
- `sample-note.md`: Sample Markdown note showcasing tables, task lists, TypeScript code blocks, and KaTeX equations.
- `claude_desktop_config.json`: Configuration snippet for Claude Desktop.
- `cursor_mcp.json`: Configuration snippet for Cursor IDE.
