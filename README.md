# granola-sync

Sync your [Granola](https://granola.ai) meeting notes to Google Drive as Google Docs.

Granola is a meeting notes app that records and transcribes meetings. This tool reads your notes from Granola's local API and creates Google Docs in your Drive, preserving your Granola folder structure. Once in Drive, your notes are searchable, shareable, and available as sources in tools like [Google NotebookLM](#using-with-google-notebooklm).

## Quickstart

```bash
git clone https://github.com/JM-elastic/granola-sync.git
cd granola-sync
npm install
npm run setup     # Interactive — walks you through Google OAuth
npm run sync:once # Sync your recent notes
```

The setup script will:
1. Check that Granola is installed
2. Guide you through creating a Google Cloud project and OAuth credentials
3. Open your browser to authorize Drive access
4. Save everything to `.env`

After setup, run `npm run sync` to start continuous syncing.

## Usage

```bash
npm run sync                     # Run continuously (every 30 min)
npm run sync:once                # Sync once and exit
npm run sync:date -- 2026-04-01  # Sync a specific date
npm run sync:all                 # Sync all notes (no date filter)
npm run sync:discover            # Show API fields (debug folders)
npm run setup                    # Re-run setup
```

## Configuration

All settings are in `.env` (created by `npm run setup`). See [`.env.example`](.env.example) for the full template.

### Folder Sync

By default, all Granola notes are synced. To sync only specific folders:

```env
GRANOLA_SYNC_MODE=folders
GRANOLA_FOLDERS=Elastic,Personal
```

Granola folder structure is mirrored in Google Drive:

```
meetingnotes/              <- DRIVE_ROOT
├── Elastic/               <- Granola folder
│   ├── 2026-04-01 - Sprint Planning
│   └── 2026-04-02 - 1:1 with Manager
├── Personal/
│   └── 2026-04-01 - Doctor Appointment
└── Unsorted/              <- notes without a folder
    └── 2026-04-02 - Quick Call
```

Notes without a Granola folder go into `Unsorted/`.

### Google Drive Destination

```env
# Root folder in Drive (created automatically if it doesn't exist)
DRIVE_ROOT=meetingnotes
```

Leave `DRIVE_ROOT` empty to place docs directly in Drive root.

### Sync Behavior

```env
SYNC_INTERVAL_MINUTES=30   # Minutes between syncs in continuous mode
SYNC_DAYS_BACK=3           # Only sync notes from the last N days (0 = all)
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

## Using with Google NotebookLM

Once your notes are synced to Google Drive, you can use them as sources in [Google NotebookLM](https://notebooklm.google.com/):

1. Run `npm run sync` to get your notes into Drive
2. Open [NotebookLM](https://notebooklm.google.com/)
3. Create a new notebook (or open an existing one)
4. Click **Add source** → **Google Drive**
5. Navigate to your `DRIVE_ROOT` folder (e.g., `meetingnotes/`) and select the docs you want
6. NotebookLM can now answer questions about your meetings, summarize across notes, and find connections

**Tip:** Create a NotebookLM notebook per project or topic, and add the matching Granola folder's docs as sources. As you sync new notes, add them to the notebook to keep it current.

## Manual Google OAuth Setup

If you prefer to set up OAuth manually instead of using `npm run setup`:

1. **Create a Google Cloud project:**
   - Go to [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
   - Name it anything (e.g., "granola-sync")

2. **Enable APIs** (visit both links and click "Enable"):
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)

3. **Configure OAuth consent screen:**
   - Go to [APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
   - User type: **Internal** (for Workspace/corporate accounts) or **External**
   - App name: "granola-sync"
   - Add scopes: `../auth/drive` and `../auth/documents`

4. **Create OAuth credentials:**
   - Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
   - Click **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Application type: **Web application**
   - Add authorized redirect URI: `http://localhost:3456/oauth/callback`
   - Copy the Client ID and Client Secret

5. **Generate a refresh token:**
   - Use the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), or
   - Run `npm run setup` and paste your Client ID and Secret when prompted — it handles the rest

6. **Add to `.env`:**
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3456/oauth/callback
   GOOGLE_REFRESH_TOKEN=your-refresh-token
   ```

## Troubleshooting

**Stuck on Google OAuth setup?** Run `npm run setup` — it walks you through each step interactively and opens the right links.

**"No refresh token received"?** Google only gives a refresh token on the first authorization. If you've authorized before, revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), find "granola-sync", remove it, then run `npm run setup` again.

**Folder detection not working?** Run `npm run sync:discover` to see what fields the Granola API returns on your documents. This helps you find the correct folder names for `GRANOLA_FOLDERS`.

**401 Unauthorized from Granola?** Make sure the Granola desktop app is running and you're logged in. The tool reads credentials from the app's local storage.

**No documents found?** Check `SYNC_DAYS_BACK` — if set to 3, only notes from the last 3 days are synced. Use `npm run sync:all` to sync everything.

**Corporate Google account issues?** Your Workspace admin may need to allow the OAuth app, or you may need to set the consent screen to "Internal". Ask your admin to approve the app if you see "This app isn't verified."

## How It Works

1. Reads Granola's auth token from `~/Library/Application Support/Granola/supabase.json`
2. Fetches documents via Granola's private API
3. Filters by folder and date
4. For each document:
   - Extracts notes from ProseMirror JSON, falling back to transcript
   - Creates a Google Doc in the matching Drive folder (created automatically)
   - Tags with `source=granola-sync` for tracking
5. Skips docs that already exist or were previously trashed

## Requirements

- macOS (reads Granola credentials from `~/Library/Application Support/Granola/`)
- Node.js 18+
- Granola desktop app, logged in

## License

MIT
