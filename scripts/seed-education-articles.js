#!/usr/bin/env node
/**
 * scripts/seed-education-articles.js
 *
 * Seeds the static article library (js/thanzi-education.js → ARTICLES)
 * into the `education_articles` Appwrite collection using the SERVER
 * SDK + an API key. Server API keys bypass collection/document
 * permissions entirely, so this works no matter how Document Security
 * or collection permissions are configured — no browser, no client
 * auth session needed.
 *
 * Safe to re-run: each article's own `id` is used as the Appwrite
 * document ID, so already-seeded articles are skipped (409), not
 * duplicated.
 *
 * Setup (once):
 *   cd scripts
 *   npm install
 *
 * Usage:
 *   APPWRITE_API_KEY=your_key_here node scripts/seed-education-articles.js
 *
 * Getting an API key: Appwrite console → your project → Overview →
 * "Integrate with your server" (or Settings → API Keys) → Create API
 * Key → give it the Databases read + write scopes → copy the key.
 * Treat it like a password — never commit it, never paste it into the
 * repo. Run the command above with it inline each time instead.
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let sdk;
try {
  sdk = require('node-appwrite');
} catch (e) {
  console.error('node-appwrite isn\'t installed yet. Run:\n  cd scripts && npm install\nthen try again from the repo root.');
  process.exit(1);
}

const API_KEY = process.env.APPWRITE_API_KEY;
if (!API_KEY) {
  console.error('Missing API key. Run:\n  APPWRITE_API_KEY=your_key_here node scripts/seed-education-articles.js');
  process.exit(1);
}

const ENDPOINT   = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = 'thanzi-app';
const DB_ID      = 'thanzi-db';
const COL_ID     = 'education_articles';

// ── Load ARTICLES straight from the app's own source of truth ──────────
// thanzi-education.js is a plain browser IIFE (`const ThanziEducation =
// (() => {...})();`) with no module.exports. We copy it to a temp file
// with one line appended to export it, then require() that — this runs
// the file exactly as authored (top-level `const` works fine inside
// Node's CommonJS function wrapper, unlike vm sandboxing) and can never
// drift from what the app actually ships, since it's the same file.

const eduPath = path.join(__dirname, '..', 'js', 'thanzi-education.js');
const tmpPath = path.join(os.tmpdir(), `thanzi-education-${Date.now()}.js`);
fs.writeFileSync(tmpPath, fs.readFileSync(eduPath, 'utf8') + '\nmodule.exports = ThanziEducation;\n');
let articles;
try {
  articles = require(tmpPath).ARTICLES;
} finally {
  fs.unlinkSync(tmpPath);
}

const client = new sdk.Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);
const databases = new sdk.Databases(client);

async function main() {
  console.log(`Seeding ${articles.length} articles into "${COL_ID}"…\n`);
  let created = 0, skipped = 0, failed = 0;

  for (const a of articles) {
    try {
      await databases.createDocument(DB_ID, COL_ID, a.id, {
        title:    a.title,
        category: a.category,
        tags:     a.tags || [],
        read_min: a.read_min,
        summary:  a.summary,
        body:     a.body || [],
        status:   'published',
      });
      created++;
      console.log(`  \u2713 ${a.id}`);
    } catch (e) {
      if (e.code === 409) {
        skipped++;
        console.log(`  \u2013 ${a.id} (already exists, skipped)`);
      } else {
        failed++;
        console.log(`  \u2717 ${a.id}: ${e.message}`);
      }
    }
  }

  console.log(`\nDone \u2014 ${created} created, ${skipped} skipped, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
