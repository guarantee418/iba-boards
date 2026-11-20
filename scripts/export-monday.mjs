#!/usr/bin/env node
// Exports every board in a monday.com workspace to data/monday/<board>.json,
// in the format scripts/import-monday.mjs reads: columns, groups, items,
// subitems and updates (comments).
//
//   node scripts/export-monday.mjs [workspaceId ...]     (default: 5439613, the IBA workspace)
//
// Needs MONDAY_API_TOKEN, from the environment or ~/claude-remote/env/.env.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'monday');

function token() {
  if (process.env.MONDAY_API_TOKEN) return process.env.MONDAY_API_TOKEN;
  const envFile = join(homedir(), 'claude-remote', 'env', '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*MONDAY_API_TOKEN\s*=\s*"?([^"\n]+)"?/m);
    if (m) return m[1].trim();
  }
  console.error('MONDAY_API_TOKEN is not set. Add it to ~/claude-remote/env/.env.');
  process.exit(1);
}
const TOKEN = token();

async function gql(query, variables = {}, tries = 4) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json', 'API-Version': '2025-04' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  const err = body.errors?.[0]?.message || body.error_message;
  if ((res.status === 429 || /complexity|rate limit/i.test(err ?? '')) && tries > 0) {
    const wait = (body.errors?.[0]?.extensions?.retry_in_seconds ?? 20) * 1000;
    console.error(`  monday asked us to slow down; waiting ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return gql(query, variables, tries - 1);
  }
  if (!res.ok || err) throw new Error(`monday API: ${err ?? res.status}`);
  return body.data;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'board';

/** monday's settings_str -> [{id, label, hex, index, is_done}] */
function labelsFrom(type, settingsStr) {
  let s = {};
  try { s = JSON.parse(settingsStr || '{}'); } catch { /* keep empty */ }
  if (type === 'status' || type === 'color') {
    const done = new Set((s.done_colors ?? []).map(Number));
    const order = s.labels_positions_v2 ?? {};
    return Object.entries(s.labels ?? {})
      .filter(([, label]) => label)
      .map(([id, label]) => ({
        id: Number(id), label, hex: s.labels_colors?.[id]?.color ?? '#c4c4c4',
        index: order[id] ?? Number(id), is_done: done.has(Number(id)),
      }));
  }
  if (type === 'dropdown') {
    return (s.labels ?? []).filter((l) => !l.is_deactivated).map((l) => ({ id: l.id, label: l.name ?? l.label }));
  }
  return [];
}

/** A column value as plain text the importer understands. */
function valueText(cv) {
  if (cv.type === 'date') {
    try { const v = JSON.parse(cv.value || 'null'); if (v?.date) return v.date; } catch { /* fall through */ }
  }
  if (cv.type === 'checkbox') {
    try { return JSON.parse(cv.value || 'null')?.checked ? 'true' : null; } catch { return null; }
  }
  return cv.text || null;
}

const SKIP_TYPES = new Set(['subtasks', 'direct_doc', 'doc', 'button', 'formula', 'name']);
const ITEM_FIELDS = `id name created_at group { id }
  column_values { id type text value }
  updates(limit: 100) { text_body created_at creator { name email } }`;

async function exportBoard(b, workspace, folders, people) {
  const columns = b.columns.filter((c) => !SKIP_TYPES.has(c.type));
  // Subitem columns live on a hidden "Subitems of …" board.
  const subCol = b.columns.find((c) => c.type === 'subtasks');
  let subColumns = [];
  if (subCol) {
    const ids = JSON.parse(subCol.settings_str || '{}').boardIds ?? [];
    if (ids.length) {
      const d = await gql('query ($ids: [ID!]) { boards(ids: $ids) { columns { id title type settings_str } } }', { ids: ids.map(String) });
      subColumns = (d.boards[0]?.columns ?? []).filter((c) => !SKIP_TYPES.has(c.type));
    }
  }

  const items = [];
  let page = (await gql(`query ($id: [ID!]) { boards(ids: $id) { items_page(limit: 100) { cursor items {
      ${ITEM_FIELDS} subitems { ${ITEM_FIELDS} } } } } }`, { id: [b.id] })).boards[0].items_page;
  for (;;) {
    for (const it of page.items) items.push(it);
    if (!page.cursor) break;
    page = (await gql(`query ($c: String!) { next_items_page(limit: 100, cursor: $c) { cursor items {
      ${ITEM_FIELDS} subitems { ${ITEM_FIELDS} } } } }`, { c: page.cursor })).next_items_page;
  }

  const vals = (it, cols) => Object.fromEntries(it.column_values
    .filter((cv) => cols.some((c) => c.id === cv.id))
    .map((cv) => [cv.id, valueText(cv)]).filter(([, v]) => v !== null));
  const updates = (it) => (it.updates ?? []).filter((u) => u.text_body?.trim())
    .map((u) => ({ body: u.text_body.trim(), created_at: u.created_at, author: u.creator?.name ?? null, author_email: u.creator?.email ?? null }));

  const folder = folders.find((f) => String(f.id) === String(b.board_folder_id));
  const out = {
    _source: `Exported from monday.com through the API on ${new Date().toISOString().slice(0, 10)}.`,
    workspace,
    folder: folder ? { id: folder.id, name: folder.name } : null,
    people,
    board: {
      id: b.id, name: b.name, description: b.description, item_terminology: b.item_terminology || 'Item',
      columns: columns.map((c) => ({ id: c.id, title: c.title, type: c.type, settings: { labels: labelsFrom(c.type, c.settings_str) } })),
      subItemColumns: subColumns.map((c) => ({ id: c.id, title: c.title, type: c.type, settings: { labels: labelsFrom(c.type, c.settings_str) } })),
      groups: [...b.groups].sort((a, z) => Number(a.position) - Number(z.position)).map((g) => ({ id: g.id, title: g.title, color: g.color })),
    },
    items: items.map((it) => ({
      id: it.id, name: it.name, group: it.group?.id, created_at: it.created_at,
      values: vals(it, columns), updates: updates(it),
      subitems: (it.subitems ?? []).map((s) => ({ id: s.id, name: s.name, created_at: s.created_at, values: vals(s, subColumns), updates: updates(s) })),
    })),
  };
  const file = join(outDir, `${slug(b.name)}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  const subs = out.items.reduce((n, i) => n + i.subitems.length, 0);
  const ups = out.items.reduce((n, i) => n + i.updates.length + i.subitems.reduce((m, s) => m + s.updates.length, 0), 0);
  console.error(`  ${b.name}: ${out.items.length} items, ${subs} subitems, ${ups} updates`);
}

const workspaceIds = process.argv.slice(2).length ? process.argv.slice(2) : ['5439613'];
mkdirSync(outDir, { recursive: true });
const users = (await gql('{ users(limit: 500) { id name email } }')).users;
const people = users.map((u) => ({ id: u.id, name: u.name, email: u.email }));

for (const wsId of workspaceIds) {
  const ws = (await gql('query ($ids: [ID!]) { workspaces(ids: $ids) { id name } }', { ids: [wsId] })).workspaces[0];
  if (!ws) { console.error(`No workspace ${wsId}`); continue; }
  const folders = (await gql('query ($ids: [ID!]) { folders(workspace_ids: $ids, limit: 100) { id name } }', { ids: [wsId] })).folders;
  const boards = (await gql(`query ($ids: [ID!]) { boards(workspace_ids: $ids, limit: 500, state: active, order_by: created_at) {
      id name description type board_folder_id item_terminology
      columns { id title type settings_str } groups { id title color position } } }`, { ids: [wsId] })).boards
    .filter((b) => b.type === 'board');
  console.error(`${ws.name}: ${boards.length} boards`);
  for (const b of boards) await exportBoard(b, { id: ws.id, name: ws.name }, folders, people);
}
console.error('Done. Now run: npm run db:import');
