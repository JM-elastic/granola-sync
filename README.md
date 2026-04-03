# granola-sync

Sync your [Granola](https://granola.ai) meeting notes to Google Drive as Google Docs.

Granola is a meeting notes app that records and transcribes meetings. This tool reads your notes from Granola's local API and creates/updates Google Docs in a specified Drive folder, making your meeting notes searchable and accessible from anywhere.

## Features

- Syncs meeting notes (ProseMirror content) and transcripts to Google Docs
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

2. Copy `.env.example` to `.env` and fill in your Google OAuth2 credentials:
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
```

## Configuration

All configuration is via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth2 redirect URI |
| `GOOGLE_REFRESH_TOKEN` | — | OAuth2 refresh token |
| `DRIVE_FOLDER` | `meetingnotes/Unsorted` | Google Drive destination path |
| `SYNC_INTERVAL_MINUTES` | `30` | Minutes between sync cycles |
| `SYNC_DAYS_BACK` | `3` | Only sync notes from the last N days (0 = all) |

## How It Works

1. Reads Granola's auth token from `~/Library/Application Support/Granola/supabase.json`
2. Fetches meeting documents via Granola's API
3. For each document:
   - Extracts notes from ProseMirror JSON format
   - Falls back to transcript if notes are empty
   - Creates a Google Doc in the destination folder (or updates if empty)
   - Tags the doc with `source=granola-sync` for tracking
4. Skips documents that already exist or have been trashed

## Notes

- Granola credentials are read-only from the local app — this tool does **not** modify your Granola data
- Google Docs are created with an `appProperties` tag so the tool can track what it has synced
- Currently macOS only (reads from `~/Library/Application Support/Granola/`)

## License

MIT
