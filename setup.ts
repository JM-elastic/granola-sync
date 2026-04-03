/**
 * Interactive setup script for granola-sync
 *
 * Walks you through creating Google OAuth2 credentials and generating
 * a refresh token. Run with: npm run setup
 */

import { createServer } from 'http';
import { URL } from 'url';
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as readline from 'readline';

const ENV_FILE = '.env';
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];
const REDIRECT_PORT = 3456;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/callback`;

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printStep(step: number, total: number, title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Step ${step}/${total}: ${title}`);
  console.log('─'.repeat(60));
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  granola-sync setup                                        ║
║  Configure Google Drive access for syncing Granola notes   ║
╚════════════════════════════════════════════════════════════╝
`);

  // Step 1: Check Granola
  printStep(1, 5, 'Check Granola Installation');

  const granolaCredsPath = join(homedir(), 'Library/Application Support/Granola/supabase.json');
  if (existsSync(granolaCredsPath)) {
    console.log('  ✅ Granola credentials found');
  } else {
    console.log('  ⚠️  Granola credentials not found at:');
    console.log(`     ${granolaCredsPath}`);
    console.log('');
    console.log('  Make sure Granola is installed and you are logged in.');
    console.log('  Download: https://granola.ai');
    const cont = await ask('\n  Continue anyway? (y/n) ');
    if (cont.toLowerCase() !== 'y') process.exit(0);
  }

  // Step 2: Google Cloud Project
  printStep(2, 5, 'Google Cloud Project');

  console.log(`
  You need a Google Cloud project with the Drive and Docs APIs enabled.
  If you already have one, skip ahead. Otherwise, follow these steps:

  1. Go to: https://console.cloud.google.com/projectcreate
     - Project name: "granola-sync" (or anything you like)
     - Organization: select your org if prompted
     - Click "Create"

  2. Enable APIs — visit BOTH of these links and click "Enable":
     - Drive API:  https://console.cloud.google.com/apis/library/drive.googleapis.com
     - Docs API:   https://console.cloud.google.com/apis/library/docs.googleapis.com

     (Make sure your new project is selected in the top dropdown)

  3. Configure OAuth consent screen:
     - Go to: https://console.cloud.google.com/apis/credentials/consent
     - User type: "Internal" (for Workspace accounts) or "External"
     - App name: "granola-sync"
     - User support email: your email
     - Scopes: add "Google Drive API ../auth/drive" and "Google Docs API ../auth/documents"
     - Save
`);

  await ask('  Press Enter when your project is ready...');

  // Step 3: OAuth Credentials
  printStep(3, 5, 'Create OAuth Credentials');

  console.log(`
  Now create OAuth credentials:

  1. Go to: https://console.cloud.google.com/apis/credentials
  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"
  3. Application type: "Web application"
     - Name: "granola-sync"
     - Authorized redirect URIs: add exactly this URL:
       ${REDIRECT_URI}
  4. Click "Create"
  5. You'll see a Client ID and Client Secret — copy them below.
`);

  const clientId = await ask('  Client ID: ');
  const clientSecret = await ask('  Client Secret: ');

  if (!clientId || !clientSecret) {
    console.log('\n  ❌ Client ID and Secret are required.');
    process.exit(1);
  }

  // Step 4: Generate Refresh Token
  printStep(4, 5, 'Generate Refresh Token');

  console.log('  Opening browser for Google authorization...');
  console.log('  (If it doesn\'t open, copy the URL below into your browser)\n');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.log(`  ${authUrl}\n`);

  // Try to open the browser
  const { exec } = await import('child_process');
  exec(`open "${authUrl}"`);

  // Start local server to catch the callback
  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('No authorization code received');
          return;
        }

        const { tokens } = await oauth2Client.getToken(code);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
            <h1>✅ Authorization successful!</h1>
            <p>You can close this tab and return to the terminal.</p>
          </body></html>
        `);

        server.close();

        if (!tokens.refresh_token) {
          reject(new Error('No refresh token received. Try revoking access at https://myaccount.google.com/permissions and running setup again.'));
          return;
        }

        resolve(tokens.refresh_token);
      } catch (err) {
        res.writeHead(500);
        res.end('Authorization failed');
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`  Waiting for authorization callback on port ${REDIRECT_PORT}...`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization'));
    }, 5 * 60 * 1000);
  });

  console.log('  ✅ Refresh token received!');

  // Step 5: Write .env
  printStep(5, 5, 'Save Configuration');

  const driveRoot = await ask('  Google Drive root folder (e.g., "meetingnotes", or leave empty for Drive root): ');
  const syncMode = await ask('  Sync mode — "all" folders or "folders" for specific ones? (all/folders) [all]: ') || 'all';

  let granolaFolders = '';
  if (syncMode === 'folders') {
    granolaFolders = await ask('  Folder names to sync (comma-separated, e.g., "Work,Personal"): ');
  }

  const envContent = `# Generated by granola-sync setup
# ${new Date().toISOString()}

# Google OAuth2
GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
GOOGLE_REDIRECT_URI=${REDIRECT_URI}
GOOGLE_REFRESH_TOKEN=${refreshToken}

# Folder sync
GRANOLA_SYNC_MODE=${syncMode}
GRANOLA_FOLDERS=${granolaFolders}

# Google Drive destination
DRIVE_ROOT=${driveRoot}

# Sync behavior
SYNC_INTERVAL_MINUTES=30
SYNC_DAYS_BACK=3
`;

  if (existsSync(ENV_FILE)) {
    const overwrite = await ask(`  .env already exists. Overwrite? (y/n) `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('\n  Skipped. Here are your credentials to add manually:\n');
      console.log(envContent);
      return;
    }
  }

  writeFileSync(ENV_FILE, envContent);
  console.log('  ✅ Saved to .env');

  // Done!
  console.log(`
${'═'.repeat(60)}

  ✅ Setup complete! Run your first sync:

    npm run sync:once

  Or run continuously:

    npm run sync

${'═'.repeat(60)}
`);
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message);
  process.exit(1);
});
