/**
 * admin.js — Thanzi Content Desk
 *
 * A standalone CMS for the `education_articles` Appwrite collection that
 * backs the Learn panel's dynamic library (see js/thanzi-education.js).
 * Not linked from the main app — reachable only by URL (/admin/).
 *
 * Real access control happens in two places:
 *   1. The `role: "admin"` user preference checked below — a client-side
 *      UI gate only. Set it on your account from the Appwrite console:
 *      Auth → Users → (your account) → Preferences → add {"role":"admin"}.
 *      No email or ID is hardcoded here, so this file is safe to keep in
 *      a public repo — granting/revoking access is done entirely from
 *      the console, on any account, without touching code.
 *   2. Appwrite collection permissions — the actual security boundary.
 *      Set Create/Update/Delete on `education_articles` to your specific
 *      user (not "any authenticated user") in the Appwrite console, or
 *      anyone who registers a Thanzi account could write articles. A
 *      preference is self-editable by the signed-in user, so it's not a
 *      real lock by itself — the collection permission is what actually
 *      keeps other accounts out.
 *
 * Depends on: Appwrite Web SDK (CDN), js/config.js, js/thanzi-education.js
 */
'use strict';

const client  = new Appwrite.Client()
  .setEndpoint(THANZI_CONFIG.endpoint)
  .setProject(THANZI_CONFIG.projectId);
const account = new Appwrite.Account(client);
const db      = new Appwrite.Databases(client);

const DB_ID   = THANZI_CONFIG.databaseId;
const COL_ID  = THANZI_CONFIG.collections.educationArticles;

let _docs   = [];
let _status = 'all';
let _cat    = 'All';
let _query  = '';
let _editingId = null;
let _userId = null;

/** Explicit per-document permissions for new articles: anyone can read
 *  (so the Learn panel works for guests too), only this admin account
 *  can edit/delete. Required because the `education_articles` collection
 *  has Document Security enabled — collection-level permissions alone
 *  aren't applied per document in that mode, so createDocument() must
 *  say who can access each document it creates. */
function _docPermissions() {
  return [
    Appwrite.Permission.read(Appwrite.Role.any()),
    Appwrite.Permission.update(Appwrite.Role.user(_userId)),
    Appwrite.Permission.delete(Appwrite.Role.user(_userId)),
  ];
}

// ── DOM refs ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const gate       = $('gate');
const desk       = $('desk');
const listEl     = $('list');
const countLine  = $('count-line');
const seedLog    = $('seed-log');

// ── Auth ───────────────────────────────────────────────────────────────

async function checkSession() {
  let user;
  try {
    user = await account.get();
  } catch (e) {
    showGate('');
    return;
  }

  const label = user.email || user.name || user.$id;
  _userId = user.$id;
  try {
    const prefs = await account.getPrefs();
    if (prefs.role === 'admin') {
      $('acct-email').textContent = label;
      showDesk();
      return;
    }
    showGate(`Signed in as ${label}, but this account isn't marked as admin. Add {"role":"admin"} to its preferences in the Appwrite console.`);
  } catch (e) {
    showGate(`Signed in as ${label}, but couldn't check admin status: ${e.message}`);
  }
}

function showGate(err) {
  gate.style.display = 'block';
  desk.style.display = 'none';
  $('gate-err').textContent = err || '';
}

function showDesk() {
  gate.style.display = 'none';
  desk.style.display = 'block';
  loadDocs();
}

$('gate-submit').addEventListener('click', async () => {
  const email = $('gate-email').value.trim();
  const pass  = $('gate-password').value;
  if (!email || !pass) { $('gate-err').textContent = 'Enter email and password.'; return; }
  $('gate-submit').disabled = true;
  try {
    await account.createEmailPasswordSession(email, pass);
    await checkSession();
  } catch (e) {
    $('gate-err').textContent = e.message || 'Sign-in failed.';
  }
  $('gate-submit').disabled = false;
});

$('btn-logout').addEventListener('click', async () => {
  try { await account.deleteSession('current'); } catch (e) {}
  location.reload();
});

// ── Load + render ──────────────────────────────────────────────────────

async function loadDocs() {
  countLine.textContent = 'Loading…';
  try {
    const res = await db.listDocuments(DB_ID, COL_ID, [
      Appwrite.Query.orderDesc('$createdAt'),
      Appwrite.Query.limit(200),
    ]);
    _docs = res.documents;
  } catch (e) {
    countLine.textContent = '';
    listEl.innerHTML = `<div class="empty"><span class="big">Couldn't load articles</span>${escapeHTML(e.message || '')}<br><br>Check that the <code>education_articles</code> collection exists and your account has read access.</div>`;
    return;
  }
  renderCategoryChips();
  render();
}

function renderCategoryChips() {
  const cats = ['All', ...new Set(_docs.map(d => d.category).filter(Boolean))];
  $('category-filters').innerHTML = cats.map(c => `
    <button class="chip ${c === _cat ? 'active' : ''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>
  `).join('');
  $('category-filters').querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => { _cat = btn.dataset.cat; renderCategoryChips(); render(); });
  });
}

function render() {
  let docs = _docs;
  if (_status !== 'all') docs = docs.filter(d => (d.status || 'draft') === _status);
  if (_cat !== 'All')    docs = docs.filter(d => d.category === _cat);
  if (_query.trim()) {
    const q = _query.trim().toLowerCase();
    docs = docs.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.summary || '').toLowerCase().includes(q));
  }

  countLine.textContent = `${docs.length} article${docs.length === 1 ? '' : 's'}`;

  if (!docs.length) {
    listEl.innerHTML = `<div class="empty"><span class="big">Nothing here</span>Try a different filter, or add a new article.</div>`;
    return;
  }

  listEl.innerHTML = docs.map(d => {
    const status = d.status || 'draft';
    const tags = d.tags || [];
    return `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-eyebrow">
              <span class="card-category">${escapeHTML(d.category || 'Uncategorized')}</span>
              <span class="stamp ${status}">${status}</span>
            </div>
            <h3 class="card-title">${escapeHTML(d.title || 'Untitled')}</h3>
          </div>
        </div>
        <p class="card-summary">${escapeHTML(d.summary || '')}</p>
        <div class="card-meta">
          <span>${d.read_min || '?'} min</span>
          ${tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('')}
        </div>
        <div class="card-actions">
          <button class="btn small" data-edit="${d.$id}">Edit</button>
          <button class="btn small ${status === 'published' ? '' : 'accent'}" data-toggle="${d.$id}">
            ${status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openEditor(btn.dataset.edit)));
  listEl.querySelectorAll('[data-toggle]').forEach(btn =>
    btn.addEventListener('click', () => toggleStatus(btn.dataset.toggle)));
}

async function toggleStatus(id) {
  const doc = _docs.find(d => d.$id === id);
  if (!doc) return;
  const next = (doc.status || 'draft') === 'published' ? 'draft' : 'published';
  try {
    await db.updateDocument(DB_ID, COL_ID, id, { status: next });
    doc.status = next;
    render();
  } catch (e) {
    alert('Could not update status: ' + e.message);
  }
}

// ── Filters ────────────────────────────────────────────────────────────

$('status-filters').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.chip');
  if (!btn) return;
  _status = btn.dataset.status;
  $('status-filters').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === btn));
  render();
});

$('search').addEventListener('input', (ev) => { _query = ev.target.value; render(); });
$('btn-refresh').addEventListener('click', loadDocs);

// ── Editor drawer ──────────────────────────────────────────────────────

const drawer = $('drawer');
const backdrop = $('drawer-backdrop');

function openDrawer() { drawer.classList.add('show'); backdrop.classList.add('show'); }
function closeDrawer() { drawer.classList.remove('show'); backdrop.classList.remove('show'); $('drawer-err').textContent = ''; }

$('drawer-close').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);

function setStatusToggle(val) {
  $('f-status-draft').classList.toggle('active', val === 'draft');
  $('f-status-draft').classList.toggle('draft', val === 'draft');
  $('f-status-published').classList.toggle('active', val === 'published');
  $('f-status-published').classList.toggle('published', val === 'published');
  $('f-status-draft').dataset.selected = val === 'draft' ? '1' : '';
  $('f-status-published').dataset.selected = val === 'published' ? '1' : '';
}
$('f-status-draft').addEventListener('click', () => setStatusToggle('draft'));
$('f-status-published').addEventListener('click', () => setStatusToggle('published'));

function openEditor(id) {
  _editingId = id || null;
  const doc = id ? _docs.find(d => d.$id === id) : null;

  // Populate the category datalist from what's already in use.
  $('category-list').innerHTML = [...new Set(_docs.map(d => d.category).filter(Boolean))]
    .map(c => `<option value="${escapeHTML(c)}">`).join('');

  $('drawer-title').textContent = doc ? 'Edit article' : 'New article';
  $('f-doc-id').value    = doc ? doc.$id : '';
  $('f-title').value     = doc ? (doc.title || '') : '';
  $('f-category').value  = doc ? (doc.category || '') : '';
  $('f-read-min').value  = doc ? (doc.read_min || 3) : 3;
  $('f-tags').value      = doc ? (doc.tags || []).join(', ') : '';
  $('f-summary').value   = doc ? (doc.summary || '') : '';
  $('f-topic-seed').value = doc ? (doc.topic_seed || '') : '';
  $('f-body').value      = doc ? (doc.body || []).join('\n\n') : '';
  setStatusToggle(doc ? (doc.status || 'draft') : 'draft');
  $('btn-delete').style.display = doc ? 'block' : 'none';
  $('drawer-err').textContent = '';
  openDrawer();
}

$('btn-new').addEventListener('click', () => openEditor(null));

$('btn-save').addEventListener('click', async () => {
  const title    = $('f-title').value.trim();
  const category = $('f-category').value.trim();
  const readMin  = parseInt($('f-read-min').value, 10) || 3;
  const tags     = $('f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const summary  = $('f-summary').value.trim();
  const topicSeed = $('f-topic-seed').value.trim() || title;
  const body     = $('f-body').value.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const status   = $('f-status-published').dataset.selected ? 'published' : 'draft';

  if (!title || !category || !summary || !body.length) {
    $('drawer-err').textContent = 'Title, category, summary and body are required.';
    return;
  }

  const data = { title, category, read_min: readMin, tags, summary, body, status, topic_seed: topicSeed };
  $('btn-save').disabled = true;
  try {
    if (_editingId) {
      const updated = await db.updateDocument(DB_ID, COL_ID, _editingId, data);
      const idx = _docs.findIndex(d => d.$id === _editingId);
      if (idx > -1) _docs[idx] = updated;
    } else {
      const created = await db.createDocument(DB_ID, COL_ID, Appwrite.ID.unique(), data, _docPermissions());
      _docs.unshift(created);
    }
    closeDrawer();
    renderCategoryChips();
    render();
  } catch (e) {
    $('drawer-err').textContent = e.message || 'Save failed.';
  }
  $('btn-save').disabled = false;
});

$('btn-delete').addEventListener('click', async () => {
  if (!_editingId) return;
  if (!confirm('Delete this article? This cannot be undone.')) return;
  try {
    await db.deleteDocument(DB_ID, COL_ID, _editingId);
    _docs = _docs.filter(d => d.$id !== _editingId);
    closeDrawer();
    renderCategoryChips();
    render();
  } catch (e) {
    $('drawer-err').textContent = e.message || 'Delete failed.';
  }
});

// ── Seed static library into Appwrite ─────────────────────────────────
//
// Pushes ThanziEducation.ARTICLES (the hand-written library baked into
// js/thanzi-education.js) into the education_articles collection, using
// each article's own `id` as the Appwrite document ID so re-running this
// is safe — already-seeded articles just get skipped (409).

$('btn-seed').addEventListener('click', async () => {
  const articles = (typeof ThanziEducation !== 'undefined') ? ThanziEducation.ARTICLES : [];
  if (!articles.length) {
    alert('ThanziEducation.ARTICLES not found — is js/thanzi-education.js loading?');
    return;
  }
  if (!confirm(`Seed ${articles.length} static articles into Appwrite as published documents? Already-seeded ones are skipped.`)) return;

  $('btn-seed').disabled = true;
  seedLog.classList.add('show');
  seedLog.textContent = `Seeding ${articles.length} articles…\n`;

  let created = 0, skipped = 0, failed = 0;
  for (const a of articles) {
    try {
      await db.createDocument(DB_ID, COL_ID, a.id, {
        title:      a.title,
        category:   a.category,
        tags:       a.tags || [],
        read_min:   a.read_min,
        summary:    a.summary,
        body:       a.body || [],
        status:     'published',
        topic_seed: a.title,
      }, _docPermissions());
      created++;
      seedLog.textContent += `✓ ${a.id}\n`;
    } catch (e) {
      if (e.code === 409) {
        skipped++;
        seedLog.textContent += `– ${a.id} (already exists)\n`;
      } else {
        failed++;
        seedLog.textContent += `✗ ${a.id}: ${e.message}\n`;
      }
    }
    seedLog.scrollTop = seedLog.scrollHeight;
  }

  seedLog.textContent += `\nDone — ${created} created, ${skipped} skipped, ${failed} failed.`;
  $('btn-seed').disabled = false;
  loadDocs();
});

// ── Utils ──────────────────────────────────────────────────────────────

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Boot ───────────────────────────────────────────────────────────────

checkSession();
