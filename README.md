# granola-sync

Sync your [Granola](https://granola.ai) meeting notes to Google Drive as Google Docs.

Granola is a meeting notes app that records and transcribes meetings. This tool reads your notes from Granola's local API and creates Google Docs in your Drive, preserving your Granola folder structure.

## Quickstart

```bash
git clone https://github.com/JM-elastic/granola-sync.git
cd granola-sync
npm install
cp .env.example .env
# Edit .env with your Google OAuth2 credentials (see below)
npm run sync:once
```

That's it. Your recent Granola notes are now in Google Drive.

To run continuously (syncs every 30 minutes):

```bash
npm run sync
```

## Google OAuth2 Setup

You need a Google Cloud project with OAuth2 credentials. If you already have one with Drive access, skip to step 4.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project (or use an existing one)
3. Enable the **Google Drive API** and **Google Docs API** under APIs & Services
4. Create an **OAuth 2.0 Client ID** (application type: Desktop or Web)
5. Note your **Client ID** and **Client Secret**
6. Generate a **refresh token** with these scopes:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/documents`
7. Add all four values to your `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
   GOOGLE_REFRESH_TOKEN=your-refresh-token
   ```

> **Tip:** Tools like [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs) or the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) can help generate refresh tokens.

## Usage

```bash
# Run continuously (syncs every 30 minutes)
npm run sync

# Sync once and exit
npm run sync:once

# Sync notes from a specific date
npm run sync:date -- 2026-04-01

# Sync all notes (ignores date filter)
npm run sync:all

# Show Granola API fields (debug folder detection)
npm run sync:discover
```

## Configuration

All settings are in `.env`. See [`.env.example`](.env.example) for the full template.

### Folder Sync

By default, all Granola notes are synced. To sync only specific folders:

```env
GRANOLA_SYNC_MODE=folders
GRANOLA_FOLDERS=Elastic,Personal
```

Granola folder structure is mirrored in Google Drive:

```
meetingnotes/              ← DRIVE_ROOT
├── Elastic/               ← Granola folder
│   ├── 2026-04-01 - Sprint Planning
│   └── 2026-04-02 - 1:1 with Manager
├── Personal/
│   └── 2026-04-01 - Doctor Appointment
└── Unsorted/              ← notes without a folder
    └── 2026-04-02 - Quick Call
```

### Google Drive Destination

```env
# Root folder in Drive (created automatically if it doesn't exist)
DRIVE_ROOT=meetingnotes
```

Leave `DRIVE_ROOT` empty to place docs directly in Drive root.

### Sync Behavior

```env
# Minutes between syncs in continuous mode
SYNC_INTERVAL_MINUTES=30

# Only sync notes from the last N days (0 = all notes)
SYNC_DAYS_BACK=3
```

### All Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | — | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth2 redirect URI |
| `GOOGLE_REFRESH_TOKEN` | — | OAuth2 refresh token |
| `GRANOLA_SYNC_MODE` | `all` | `all` or `folders` |
| `GRANOLA_FOLDERS` | — | Comma-separated folder names |
| `DRIVE_ROOT` | _(empty)_ | Google Drive root folder |
| `SYNC_INTERVAL_MINUTES` | `30` | Sync interval (continuous mode) |
| `SYNC_DAYS_BACK` | `3` | Date filter window (0 = no filter) |

## How It Works

1. Reads Granola's auth token from `~/Library/Application Support/Granola/supabase.json`
2. Fetches documents via Granola's private API
3. Filters by folder and date
4. For each document:
   - Extracts notes from ProseMirror JSON, falling back to transcript
   - Creates a Google Doc in the matching Drive folder
   - Tags with `source=granola-sync` for tracking
5. Skips docs that already exist or were previously trashed

## Troubleshooting

**Folder detection not working?** Run `npm run sync:discover` to see what fields the Granola API returns on your documents. This helps you find the correct folder names to use in `GRANOLA_FOLDERS`.

**401 Unauthorized from Granola?** Make sure the Granola desktop app is running and you're logged in. The tool reads credentials from the app's local storage.

**No documents found?** Check `SYNC_DAYS_BACK` — if set to 3, only notes from the last 3 days are synced. Use `npm run sync:all` to sync everything.

## Requirements

- macOS (reads Granola credentials from `~/Library/Application Support/Granola/`)
- Node.js 18+
- Granola desktop app, logged in

## License

MIT
