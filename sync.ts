/**
 * Granola Sync
 *
 * Syncs meeting notes from Granola (https://granola.ai) to Google Drive
 * as Google Docs. Reads Granola's local credentials automatically.
 *
 * Supports syncing all notes or specific Granola folders, and preserves
 * folder structure in Google Drive.
 *
 * Usage:
 *   npm run sync                        # Run continuously
 *   npm run sync -- --once              # Sync once and exit
 *   npm run sync -- --date 2026-04-01   # Sync notes from a specific date
 *   npm run sync -- --all               # Sync all notes (no date filter)
 *   npm run sync -- --discover          # Show Granola API fields (for debugging)
 */

import { config } from 'dotenv';
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

config();

// ─────────────────────────────────────────────────────────────
// Configuration (from .env)
// ─────────────────────────────────────────────────────────────

const GRANOLA_CREDS_PATH = join(
  homedir(),
  'Library/Application Support/Granola/supabase.json'
);

const SYNC_INTERVAL_MIN = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);
const SYNC_DAYS_BACK = parseInt(process.env.SYNC_DAYS_BACK || '3', 10);

// Granola folder sync mode: "all" syncs everything, "folders" syncs only listed folders
const GRANOLA_SYNC_MODE = (process.env.GRANOLA_SYNC_MODE || 'all').toLowerCase();
// Comma-separated list of Granola folder names to sync (when mode = "folders")
const GRANOLA_FOLDERS = (process.env.GRANOLA_FOLDERS || '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

// Google Drive root folder for synced docs (empty = Drive root)
// e.g., "meetingnotes" places all docs under a "meetingnotes" folder
const DRIVE_ROOT = process.env.DRIVE_ROOT || '';

// ─────────────────────────────────────────────────────────────
// Google Drive Setup
// ─────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const docs = google.docs({ version: 'v1', auth: oauth2Client });

// ─────────────────────────────────────────────────────────────
// Granola API
// ─────────────────────────────────────────────────────────────

interface GranolaDocument {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_viewed_panel?: {
    content?: any; // ProseMirror JSON
  };
  // Folder info — field names discovered from API
  folder_name?: string;
  folder_id?: string;
  folder?: { name?: string; id?: string } | string;
  group_name?: string;
  group?: { name?: string } | string;
  [key: string]: unknown; // allow unknown fields
}

interface TranscriptUtterance {
  source: 'microphone' | 'system';
  text: string;
  start_time?: number;
  end_time?: number;
}

/**
 * Extract the folder name from a Granola document.
 * The API field name varies — we check several common patterns.
 */
function getDocFolder(doc: GranolaDocument): string | null {
  // Direct field
  if (doc.folder_name && typeof doc.folder_name === 'string') return doc.folder_name;
  if (doc.group_name && typeof doc.group_name === 'string') return doc.group_name;

  // Nested object
  if (doc.folder && typeof doc.folder === 'object' && 'name' in doc.folder) return doc.folder.name || null;
  if (doc.folder && typeof doc.folder === 'string') return doc.folder;
  if (doc.group && typeof doc.group === 'object' && 'name' in doc.group) return doc.group.name || null;
  if (doc.group && typeof doc.group === 'string') return doc.group;

  return null;
}

function getGranolaToken(): string | null {
  if (!existsSync(GRANOLA_CREDS_PATH)) {
    console.log('❌ Granola credentials not found at:', GRANOLA_CREDS_PATH);
    console.log('   Make sure Granola is installed and you are logged in.');
    return null;
  }

  try {
    const data = readFileSync(GRANOLA_CREDS_PATH, 'utf-8');
    const creds = JSON.parse(data);

    let token = creds.workos_tokens;

    if (typeof token === 'string' && token.startsWith('{')) {
      try {
        const parsed = JSON.parse(token);
        token = parsed.accessToken || parsed.access_token || token;
      } catch {
        // Not JSON, use as-is
      }
    }

    if (!token || typeof token !== 'string') {
      console.log('❌ No access token found in Granola credentials');
      return null;
    }

    console.log(`   Found token (${token.length} chars, starts with: ${token.slice(0, 20)}...)`);
    return token;
  } catch (err) {
    console.log('❌ Failed to parse Granola credentials:', err);
    return null;
  }
}

async function fetchGranolaDocuments(token: string): Promise<GranolaDocument[]> {
  const response = await fetch('https://api.granola.ai/v2/get-documents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Granola/5.354.0',
      'X-Client-Version': '5.354.0',
    },
    body: JSON.stringify({
      limit: 100,
      offset: 0,
      include_last_viewed_panel: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Granola API error: ${response.status} ${response.statusText} - ${text}`);
  }

  const data = await response.json();
  return data.docs || [];
}

async function fetchDocumentTranscript(token: string, documentId: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.granola.ai/v1/get-document-transcript', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Granola/5.354.0',
        'X-Client-Version': '5.354.0',
      },
      body: JSON.stringify({ document_id: documentId }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const utterances: TranscriptUtterance[] = data.transcript || [];

    if (utterances.length === 0) return null;

    return utterances
      .map((u) => {
        const speaker = u.source === 'microphone' ? '[You]' : '[Other]';
        return `${speaker} ${u.text}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// ProseMirror → Text Conversion
// ─────────────────────────────────────────────────────────────

function proseMirrorToText(content: any): string {
  if (!content) return '';

  const lines: string[] = [];

  function processNode(node: any, depth = 0): void {
    if (!node) return;

    if (node.type === 'text') {
      lines.push(node.text || '');
    } else if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level) + ' ';
      const text = (node.content || []).map((n: any) => n.text || '').join('');
      lines.push('\n' + prefix + text + '\n');
    } else if (node.type === 'paragraph') {
      const text = (node.content || []).map((n: any) => n.text || '').join('');
      lines.push(text + '\n');
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      (node.content || []).forEach((item: any, i: number) => {
        const prefix = node.type === 'bulletList' ? '• ' : `${i + 1}. `;
        const text = (item.content || [])
          .flatMap((p: any) => (p.content || []).map((n: any) => n.text || ''))
          .join('');
        lines.push(prefix + text);
      });
      lines.push('');
    } else if (node.content) {
      node.content.forEach((child: any) => processNode(child, depth + 1));
    }
  }

  processNode(content);
  return lines.join('\n').trim();
}

// ─────────────────────────────────────────────────────────────
// Google Drive Operations
// ─────────────────────────────────────────────────────────────

// Cache folder IDs to avoid repeated lookups
const folderIdCache = new Map<string, string>();

async function getOrCreateFolder(folderPath: string): Promise<string> {
  if (folderIdCache.has(folderPath)) return folderIdCache.get(folderPath)!;

  const parts = folderPath.split('/').filter(Boolean);
  let parentId = 'root';

  // Build up path incrementally, caching each segment
  let pathSoFar = '';
  for (const part of parts) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;

    if (folderIdCache.has(pathSoFar)) {
      parentId = folderIdCache.get(pathSoFar)!;
      continue;
    }

    const query = `name='${part}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
    });

    if (response.data.files && response.data.files.length > 0) {
      parentId = response.data.files[0].id!;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      });
      parentId = folder.data.id!;
    }

    folderIdCache.set(pathSoFar, parentId);
  }

  folderIdCache.set(folderPath, parentId);
  return parentId;
}

async function buildExistingDocsMap(rootFolderId: string): Promise<{
  existing: Map<string, string>;
  deletedTitles: Set<string>;
  deletedGranolaIds: Set<string>;
}> {
  const map = new Map<string, string>();

  async function scan(folderId: string): Promise<void> {
    const docsRes = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
      fields: 'files(id, name)',
      pageSize: 1000,
    });
    for (const f of docsRes.data.files || []) {
      if (!map.has(f.name!)) {
        map.set(f.name!, f.id!);
      }
    }
    const foldersRes = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      pageSize: 100,
    });
    for (const f of foldersRes.data.files || []) {
      await scan(f.id!);
    }
  }

  await scan(rootFolderId);

  const trashedRes = await drive.files.list({
    q: `appProperties has { key='source' and value='granola-sync' } and trashed=true`,
    fields: 'files(id, name, appProperties)',
    pageSize: 1000,
  });
  const deletedGranolaIds = new Set<string>();
  const deletedTitles = new Set<string>();
  for (const f of trashedRes.data.files || []) {
    if (f.appProperties?.granolaId) {
      deletedGranolaIds.add(f.appProperties.granolaId);
    }
    if (f.name) {
      deletedTitles.add(f.name);
    }
  }

  return { existing: map, deletedTitles, deletedGranolaIds };
}

async function isDocEmpty(docId: string): Promise<boolean> {
  try {
    const doc = await docs.documents.get({ documentId: docId });
    const content = doc.data.body?.content || [];

    let totalText = '';
    for (const element of content) {
      if (element.paragraph?.elements) {
        for (const e of element.paragraph.elements) {
          if (e.textRun?.content) {
            totalText += e.textRun.content;
          }
        }
      }
    }

    return totalText.trim().length < 100;
  } catch {
    return false;
  }
}

async function updateDocContent(docId: string, content: string): Promise<void> {
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

  if (endIndex > 2) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            deleteContentRange: {
              range: { startIndex: 1, endIndex: endIndex - 1 },
            },
          },
        ],
      },
    });
  }

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content,
          },
        },
      ],
    },
  });
}

/**
 * Determine the Google Drive destination folder for a document.
 * If the doc has a Granola folder, mirror that structure in Drive.
 */
function getDriveFolderPath(doc: GranolaDocument): string {
  const folder = getDocFolder(doc);
  const parts: string[] = [];

  if (DRIVE_ROOT) parts.push(DRIVE_ROOT);

  if (folder) {
    parts.push(folder);
  } else {
    // No folder — place in "Unsorted" subfolder
    parts.push('Unsorted');
  }

  return parts.join('/');
}

async function createOrUpdateDoc(
  doc: GranolaDocument,
  token: string,
  existingDocs: { existing: Map<string, string>; deletedTitles: Set<string>; deletedGranolaIds: Set<string> }
): Promise<void> {
  const dateStr = doc.created_at.split('T')[0];
  const safeTitle = (doc.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-');
  const title = `${dateStr} - ${safeTitle}`;

  // Skip notes deleted by user
  if (existingDocs.deletedGranolaIds.has(doc.id) || existingDocs.deletedTitles.has(title)) {
    console.log(`   🗑️  Skipping (deleted): ${title}`);
    return;
  }

  const existingDocId = existingDocs.existing.get(title) ?? null;

  let shouldUpdate = false;
  if (existingDocId) {
    const empty = await isDocEmpty(existingDocId);
    if (empty) {
      console.log(`   🔄 Existing doc is empty, will update: ${title}`);
      shouldUpdate = true;
    } else {
      console.log(`   ⏭️  Skipping (exists with content): ${title}`);
      return;
    }
  }

  // Extract notes content from ProseMirror format
  let notesContent = doc.last_viewed_panel?.content
    ? proseMirrorToText(doc.last_viewed_panel.content)
    : '';

  // If notes are empty, try to fetch the transcript
  let transcriptContent: string | null = null;
  if (!notesContent || notesContent.trim().length < 10) {
    console.log(`   📝 Notes empty, fetching transcript for: ${title}`);
    transcriptContent = await fetchDocumentTranscript(token, doc.id);
  }

  const content = formatDocContent(doc, notesContent, transcriptContent);

  if (content.trim().length < 50) {
    console.log(`   ⚠️  Skipping (no content): ${title}`);
    return;
  }

  if (shouldUpdate && existingDocId) {
    await updateDocContent(existingDocId, content);
    console.log(`   ✅ Updated: ${title}`);
  } else {
    // Determine destination folder and ensure it exists
    const folderPath = getDriveFolderPath(doc);
    const folderId = await getOrCreateFolder(folderPath);
    const folderLabel = getDocFolder(doc) || 'Unsorted';

    const newDoc = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
        appProperties: { source: 'granola-sync', granolaId: doc.id },
      },
      fields: 'id',
    });

    if (newDoc.data.id) {
      await docs.documents.batchUpdate({
        documentId: newDoc.data.id,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      });
      console.log(`   ✅ Created: ${title} → ${folderLabel}/`);
    }
  }
}

function formatDocContent(
  doc: GranolaDocument,
  notesContent: string,
  transcriptContent: string | null = null
): string {
  const folder = getDocFolder(doc);
  const parts = [
    doc.title || 'Untitled Meeting',
    '',
    `Date: ${new Date(doc.created_at).toLocaleString()}`,
  ];

  if (folder) parts.push(`Folder: ${folder}`);

  parts.push('', '---', '');

  if (notesContent && notesContent.trim()) {
    parts.push('## Notes', '', notesContent, '');
  }

  if (transcriptContent && transcriptContent.trim()) {
    parts.push('---', '', '## Transcript', '', transcriptContent);
  }

  if (!notesContent?.trim() && !transcriptContent?.trim()) {
    parts.push('(No content available)');
  }

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Sync Logic
// ─────────────────────────────────────────────────────────────

function isRecent(dateStr: string, daysBack: number): boolean {
  const docDate = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  cutoff.setHours(0, 0, 0, 0);
  return docDate >= cutoff;
}

async function sync(options: {
  filterDate?: string;
  daysBack?: number;
  all?: boolean;
}): Promise<void> {
  console.log(`\n🔄 Starting sync at ${new Date().toLocaleTimeString()}`);

  const token = getGranolaToken();
  if (!token) {
    console.log('   Skipping sync - no credentials');
    return;
  }

  try {
    // Determine the root folder for dedup scanning
    const scanRootId = DRIVE_ROOT
      ? await getOrCreateFolder(DRIVE_ROOT)
      : 'root';

    if (DRIVE_ROOT) {
      console.log(`📁 Drive root: ${DRIVE_ROOT}/`);
    }

    console.log('🗂️  Indexing existing docs...');
    const existingDocs = await buildExistingDocsMap(scanRootId);
    console.log(`   Indexed ${existingDocs.existing.size} existing docs`);

    console.log('📥 Fetching meeting notes...');
    let documents = await fetchGranolaDocuments(token);

    // Apply folder filter
    if (GRANOLA_SYNC_MODE === 'folders' && GRANOLA_FOLDERS.length > 0) {
      const totalCount = documents.length;
      const folderSet = new Set(GRANOLA_FOLDERS.map((f) => f.toLowerCase()));
      documents = documents.filter((doc) => {
        const folder = getDocFolder(doc);
        return folder && folderSet.has(folder.toLowerCase());
      });
      console.log(`   Folder filter: ${GRANOLA_FOLDERS.join(', ')}`);
      console.log(`   ${totalCount} total → ${documents.length} in selected folders`);
    }

    // Apply date filter
    if (options.filterDate) {
      const totalCount = documents.length;
      documents = documents.filter((doc) => doc.created_at.startsWith(options.filterDate!));
      console.log(`   Found ${documents.length} documents from ${options.filterDate} (of ${totalCount})`);
    } else if (!options.all && options.daysBack && options.daysBack > 0) {
      const totalCount = documents.length;
      documents = documents.filter((doc) => isRecent(doc.created_at, options.daysBack!));
      console.log(`   Found ${documents.length} documents from last ${options.daysBack} days (of ${totalCount})`);
    } else {
      console.log(`   Found ${documents.length} documents (no date filter)`);
    }

    // Group by folder for logging
    const byFolder = new Map<string, number>();
    for (const doc of documents) {
      const folder = getDocFolder(doc) || 'Unsorted';
      byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
    }
    if (byFolder.size > 1 || (byFolder.size === 1 && !byFolder.has('Unsorted'))) {
      for (const [folder, count] of byFolder) {
        console.log(`   📂 ${folder}: ${count} notes`);
      }
    }

    console.log('📤 Syncing to Google Drive...');
    for (const doc of documents) {
      try {
        await createOrUpdateDoc(doc, token, existingDocs);
      } catch (err: any) {
        console.log(`   ❌ Failed to sync "${doc.title}": ${err.message}`);
      }
    }

    console.log('✅ Sync complete');
  } catch (err: any) {
    console.log(`❌ Sync failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Discovery (--discover flag)
// ─────────────────────────────────────────────────────────────

async function discover(): Promise<void> {
  console.log('🔍 Discovering Granola API document structure...\n');

  const token = getGranolaToken();
  if (!token) return;

  const documents = await fetchGranolaDocuments(token);
  if (documents.length === 0) {
    console.log('No documents found.');
    return;
  }

  // Show all keys on first few docs
  console.log(`Found ${documents.length} documents. Inspecting first 3:\n`);
  for (const doc of documents.slice(0, 3)) {
    console.log(`─── ${doc.title} ───`);
    console.log(`  Keys: ${Object.keys(doc).join(', ')}`);

    // Show folder-related fields
    for (const key of Object.keys(doc)) {
      const lower = key.toLowerCase();
      if (lower.includes('folder') || lower.includes('group') || lower.includes('parent') || lower.includes('workspace') || lower.includes('collection')) {
        console.log(`  ${key}: ${JSON.stringify((doc as any)[key])}`);
      }
    }

    const folder = getDocFolder(doc);
    console.log(`  → Detected folder: ${folder || '(none)'}`);
    console.log();
  }

  // Summary of all folders found
  const folders = new Map<string, number>();
  for (const doc of documents) {
    const folder = getDocFolder(doc) || '(none)';
    folders.set(folder, (folders.get(folder) || 0) + 1);
  }

  console.log('── Folder Summary ──');
  for (const [folder, count] of folders) {
    console.log(`  ${folder}: ${count} notes`);
  }
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const specificDate = dateIdx >= 0 ? args[dateIdx + 1] : null;
  const once = args.includes('--once');
  const all = args.includes('--all');
  const discoverMode = args.includes('--discover');

  // Discovery mode — show API fields and exit
  if (discoverMode) {
    await discover();
    return;
  }

  // One-time sync for a specific date
  if (specificDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(specificDate)) {
      console.error('Invalid date format. Use YYYY-MM-DD (e.g., --date 2026-04-01)');
      process.exit(1);
    }
    console.log(`🔄 One-time sync for date: ${specificDate}\n`);
    await sync({ filterDate: specificDate });
    return;
  }

  // One-time sync with default date filter
  if (once) {
    console.log(`🔄 One-time sync (last ${SYNC_DAYS_BACK} days)\n`);
    await sync({ daysBack: SYNC_DAYS_BACK });
    return;
  }

  // Sync all notes once
  if (all) {
    console.log('🔄 One-time sync (all notes)\n');
    await sync({ all: true });
    return;
  }

  // Continuous mode
  const modeLabel = GRANOLA_SYNC_MODE === 'folders' && GRANOLA_FOLDERS.length > 0
    ? `Folders: ${GRANOLA_FOLDERS.join(', ')}`
    : 'All folders';

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Granola Sync                                              ║');
  console.log('║  Syncing meeting notes to Google Drive                    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${modeLabel}`);
  console.log(`║  Interval: ${SYNC_INTERVAL_MIN} minutes`);
  console.log(`║  Days back: ${SYNC_DAYS_BACK}`);
  console.log(`║  Drive root: ${DRIVE_ROOT || '(Drive root)'}`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  async function runCycle(): Promise<void> {
    await sync({ daysBack: SYNC_DAYS_BACK });
    console.log(`\n⏰ Next sync in ${SYNC_INTERVAL_MIN} minutes...`);
    setTimeout(runCycle, SYNC_INTERVAL_MIN * 60 * 1000);
  }

  await runCycle();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
