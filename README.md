# granola-sync

Sync your [Granola](https://granola.ai) meeting notes to Google Drive as Google Docs.

Granola is a meeting notes app that records and transcribes meetings. This tool reads your notes from Granola's local API and creates/updates Google Docs in a specified Drive folder, preserving your Granola folder structure.

## Features

- Syncs meeting notes (ProseMirror content) and transcripts to Google Docs
- Preserves Granola folder structure in Google Drive
- Sync all folders or filter to specific ones
- Deduplicates — won't re-create docs that already exist
- Respects deleted docs — won't re-sync notes you've trashed
- Scans entire folder tree to detect docs moved between subfolders
- Configurable date filtering (last N days, specific date, or all)
- Runs continuously with configurable sync interval, or as a one-shot

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Granola](https://granola.ai) desktop app installed and logged in (macOS)
- Google Cloud project with Drive and Docs APIs enabled
- Google OAuth2 credentials with a refresh token

## Setup

1. Clone this repo:
   ```bash
   git clone https://github.com/JM-elastic/granola-sync.git
   cd granola-sync
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Set up Google OAuth2:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create an OAuth2 Client ID (Desktop or Web application)
   - Enable the **Google Drive API** and **Google Docs API**
   - Generate a refresh token with scopes:
     - `https://www.googleapis.com/auth/drive`
     - `https://www.googleapis.com/auth/documents`

## Usage

```bash
# Run continuously (syncs every 30 minutes by default)
npm run sync

# Sync once and exit
npm run sync:once

# Sync notes from a specific date
npm run sync:date -- 2026-04-01

# Sync all notes (no date filter)
npm run sync:all

# Discover API structure (useful for debugging folder detection)
npm run sync -- --discover
```

## Configuration

All configuration is via environment variables in `.env`:

### Google OAuth2

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth2 redirect URI |
| `GOOGLE_REFRESH_TOKEN` | — | OAuth2 refresh token |

### Folder Sync

| Variable | Default | Description |
|----------|---------|-------------|
| `GRANOLA_SYNC_MODE` | `all` | `all` = sync everything, `folders` = only listed folders |
| `GRANOLA_FOLDERS` | — | Comma-separated Granola folder names (e.g., `Elastic,Personal`) |

### Google Drive Destination

| Variable | Default | Description |
|----------|---------|-------------|
| `DRIVE_ROOT` | _(empty)_ | Root folder in Drive (e.g., `meetingnotes`). Created if missing. |

Granola folder structure is preserved under the root:
```
DRIVE_ROOT/
├── Elastic/
│   ├── 2026-04-01 - Sprint Planning.gdoc
│   └── 2026-04-02 - 1:1 with Manager.gdoc
├── Personal/
│   └── 2026-04-01 - Doctor Appointment.gdoc
└── Unsorted/
    └── 2026-04-02 - Quick Call.gdoc
```

Notes without a Granola folder go into `Unsorted/`.

### Sync Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNC_INTERVAL_MINUTES` | `30` | Minutes between sync cycles (continuous mode) |
| `SYNC_DAYS_BACK` | `3` | Only sync notes from the last N days (0 = all) |

## How It Works

1. Reads Granola's auth token from `~/Library/Application Support/Granola/supabase.json`
2. Fetches meeting documents via Granola's API
3. Filters by folder and date as configured
4. For each document:
   - Determines the Google Drive destination folder (matching Granola folder structure)
   - Extracts notes from ProseMirror JSON format
   - Falls back to transcript if notes are empty
   - Creates a Google Doc (or updates if existing doc is empty)
   - Tags the doc with `source=granola-sync` for tracking
5. Skips documents that already exist or have been trashed

## Debugging

If folder detection isn't working, run:
```bash
npm run sync -- --discover
```

This shows the raw API fields on your documents and which folder name was detected, helping you configure `GRANOLA_FOLDERS` correctly.

## Notes

- Granola credentials are read-only from the local app — this tool does **not** modify your Granola data
- Google Docs are created with an `appProperties` tag so the tool can track what it has synced
- Currently macOS only (reads from `~/Library/Application Support/Granola/`)

## License

MIT
