#!/usr/bin/env node
// Turns monday.com board exports in data/monday/*.json into seed/rows.json:
// one array of rows per SharePoint list, keyed by the list name.
// scripts/upload_sharepoint.py then loads those rows into the IBA Boards site.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'monday');
const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#037f4c', '#ff642e', '#66ccff'];
const PERSON_COLORS = ['#4f7cff', '#e8697d', '#21a67a', '#c2410c', '#7c3aed', '#0e7490'];
// monday column type -> IBA Boards type. Anything else (email, phone, link,
// files, connected boards, mirrors…) comes over as plain text.
const TYPE_MAP = { people: 'people', 'multiple-person': 'people', long_text: 'long_text', 'long-text': 'long_text',
  dropdown: 'dropdown', status: 'status', color: 'status', date: 'date', text: 'text', numbers: 'number',
  numeric: 'number', checkbox: 'checkbox', boolean: 'checkbox' };
const SKIP = new Set(['name', 'subtasks', 'direct_doc']);

const rows = { People: [], Workspaces: [], Folders: [], Boards: [], BoardGroups: [], BoardColumns: [], Items: [], Updates: [] };
const seen = new Set();
const once = (list, row) => { const k = `${list}:${row.Key}`; if (!seen.has(k)) { seen.add(k); rows[list].push(row); } };
const peopleByName = new Map(); // name -> key
const peopleByEmail = new Map(); // email -> key

for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort()) {
  const x = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const ws = `w${x.workspace.id}`;
  const folder = x.folder ? `f${x.folder.id}` : '';
  const b = x.board;
  const boardKey = `b${b.id}`;

  for (const p of x.people ?? []) {
    const email = p.email?.toLowerCase() ?? '';
    let key = email && peopleByEmail.get(email);
    if (!key) {
      key = `p${p.id}`;
      if (email) peopleByEmail.set(email, key);
      // MondayEmail is only used to match the person to their school Microsoft account.
      once('People', { Key: key, Title: p.name, Email: '', MondayEmail: email, Color: PERSON_COLORS[rows.People.length % PERSON_COLORS.length] });
    }
    if (!peopleByName.has(p.name)) peopleByName.set(p.name, key);
  }
  once('Workspaces', { Key: ws, Title: x.workspace.name, Position: 0 });
  if (folder) once('Folders', { Key: folder, Title: x.folder.name, WorkspaceKey: ws, Position: 0 });
  once('Boards', { Key: boardKey, Title: b.name, WorkspaceKey: ws, FolderKey: folder, Description: b.description ?? '',
    ItemTerm: b.item_terminology ?? 'Item', Position: 0, MondayId: String(b.id) });

  b.groups.forEach((g, i) => once('BoardGroups', { Key: `g${b.id}_${g.id}`, Title: g.title, BoardKey: boardKey,
    Color: g.color ?? GROUP_COLORS[i % GROUP_COLORS.length], Position: i, Collapsed: 0 }));

  const colMaps = {};
  for (const [isSub, cols] of [[0, b.columns], [1, b.subItemColumns ?? []]]) {
    const map = (colMaps[isSub] = {});
    cols.filter((c) => !SKIP.has(c.type)).forEach((c, i) => {
      const key = `${isSub ? 'cs' : 'c'}${b.id}_${c.id}`;
      const type = TYPE_MAP[c.type] ?? 'text';
      const labels = (c.settings?.labels ?? [])
        .filter((l) => !l.is_deactivated)
        .sort((a, z) => (a.index ?? a.id) - (z.index ?? z.id))
        .map((l) => ({ id: l.id, label: l.label, ...(type === 'status' ? { color: l.hex ?? '#c4c4c4', done: !!l.is_done } : {}) }));
      map[c.id] = { key, type, labels };
      once('BoardColumns', { Key: key, Title: c.title, BoardKey: boardKey, IsSub: isSub, ColType: type,
        Settings: JSON.stringify(labels.length ? { labels } : {}), Width: null, Position: i });
    });
  }

  const convert = (values, map) => {
    const out = {};
    for (const [k, raw] of Object.entries(values ?? {})) {
      const col = map[k];
      if (!col || raw === null || raw === undefined) continue;
      const text = typeof raw === 'object' ? raw.text ?? null : String(raw);
      if (text === null || text === '') continue;
      const byLabel = (name) => col.labels.find((l) => l.label.toLowerCase() === name.trim().toLowerCase())?.id;
      if (col.type === 'status') { const id = byLabel(text); if (id !== undefined) out[col.key] = id; }
      else if (col.type === 'dropdown') { const ids = text.split(',').map(byLabel).filter((v) => v !== undefined); if (ids.length) out[col.key] = ids; }
      else if (col.type === 'people') {
        const ids = text.split(',').map((n) => peopleByName.get(n.trim())).filter(Boolean);
        if (ids.length) out[col.key] = ids;
      } else if (col.type === 'number') out[col.key] = Number(text);
      else if (col.type === 'checkbox') out[col.key] = text === 'v' || text === 'true';
      else out[col.key] = text;
    }
    return out;
  };

  const addUpdates = (itemKey, list) => (list ?? []).forEach((u, k) => {
    const author = (u.author_email && peopleByEmail.get(u.author_email.toLowerCase())) || peopleByName.get(u.author) || '';
    once('Updates', { Key: `u${itemKey}_${k}`, Title: '', ItemKey: itemKey, BoardKey: boardKey, AuthorKey: author, Body: u.body, CreatedAt: u.created_at });
  });
  const item = (key, group, parent, name, vals, pos, created) =>
    once('Items', { Key: key, Title: name.slice(0, 255), BoardKey: boardKey, GroupKey: group, ParentKey: parent,
      Vals: JSON.stringify(vals), Position: pos, CreatedBy: '', CreatedAt: created, UpdatedAt: created });

  x.items.forEach((it, i) => {
    const itemKey = `i${it.id}`;
    item(itemKey, `g${b.id}_${it.group}`, '', it.name, convert(it.values, colMaps[0]), i, it.created_at);
    addUpdates(itemKey, it.updates);
    (it.subitems ?? []).forEach((s, j) => {
      item(`i${s.id}`, '', itemKey, s.name, convert(s.values, colMaps[1]), j, s.created_at);
      addUpdates(`i${s.id}`, s.updates);
    });
  });
}

mkdirSync(join(root, 'seed'), { recursive: true });
writeFileSync(join(root, 'seed', 'rows.json'), JSON.stringify(rows));
console.error('Wrote seed/rows.json: ' + Object.entries(rows).map(([k, v]) => `${v.length} ${k}`).join(', '));
