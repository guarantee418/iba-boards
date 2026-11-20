// The data layer: everything is stored in SharePoint lists on the private
// "IBA Boards" site, read and written through Microsoft Graph as the signed-in
// staff member. Nobody can see or change data their SharePoint access doesn't allow.
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import config from './config.json';

const SCOPES = ['User.Read', 'Sites.ReadWrite.All'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SITE = config.siteId;

const msal = new PublicClientApplication({
  auth: {
    clientId: config.clientId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
    redirectUri: location.origin + import.meta.env.BASE_URL,
  },
  cache: { cacheLocation: 'localStorage' },
});

let ready: Promise<AccountInfo | null> | null = null;

/** Signs the person in with their school Microsoft account (redirects if needed). */
export function signIn(): Promise<AccountInfo | null> {
  ready ??= (async () => {
    await msal.initialize();
    const res = await msal.handleRedirectPromise();
    const account = res?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0];
    if (!account) {
      await msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
      return null;
    }
    msal.setActiveAccount(account);
    return account;
  })();
  return ready;
}

export async function signOut() {
  await msal.logoutRedirect({ postLogoutRedirectUri: location.origin + import.meta.env.BASE_URL });
}

async function token(): Promise<string> {
  const account = await signIn();
  if (!account) return new Promise(() => {}); // redirecting to sign in
  try {
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: SCOPES, account });
      return new Promise(() => {});
    }
    throw e;
  }
}

async function graph<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith('http') ? path : GRAPH + path;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 5) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('Retry-After') || 2 + attempt * 2) * 1000));
      continue;
    }
    if (res.status === 403) throw new Error("You don't have access to the IBA Boards SharePoint site. Ask Mr. Greene to add you.");
    if (!res.ok) throw new Error(`SharePoint said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
}

/** Sends up to 20 requests at a time through Graph's $batch. */
async function batch(reqs: { method: string; url: string; body?: unknown }[]) {
  for (let i = 0; i < reqs.length; i += 20) {
    let pending = reqs.slice(i, i + 20).map((r, n) => ({ id: String(n), ...r, headers: r.body ? { 'Content-Type': 'application/json' } : undefined }));
    for (let attempt = 0; pending.length; attempt++) {
      const { responses } = await graph<{ responses: { id: string; status: number }[] }>('POST', '/$batch', { requests: pending });
      const failed = responses.find((r) => r.status >= 400 && r.status !== 429 && r.status !== 404);
      if (failed) throw new Error(`SharePoint said ${failed.status} while saving`);
      const retry = new Set(responses.filter((r) => r.status === 429).map((r) => r.id));
      pending = pending.filter((p) => retry.has(p.id));
      if (pending.length) {
        if (attempt > 5) throw new Error('SharePoint is busy; try again in a minute');
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
}

// ---------- Lists ----------
type ListName = 'People' | 'Workspaces' | 'Folders' | 'Boards' | 'BoardGroups' | 'BoardColumns' | 'Items' | 'Updates';
let listIds: Promise<Record<string, string>> | null = null;
const listId = async (name: ListName) => {
  listIds ??= graph<{ value: { id: string; displayName: string }[] }>('GET', `/sites/${SITE}/lists?$select=id,displayName`)
    .then((d) => Object.fromEntries(d.value.map((l) => [l.displayName, l.id])));
  const id = (await listIds)[name];
  if (!id) throw new Error(`The SharePoint list "${name}" is missing`);
  return id;
};
const itemsUrl = async (name: ListName) => `/sites/${SITE}/lists/${await listId(name)}/items`;

/** SharePoint's own item id for each of our keys, filled in as rows are read or created. */
const spIds = new Map<string, string>();
type Row = Record<string, any> & { Key: string };

async function rows(name: ListName, filter?: string): Promise<Row[]> {
  let url: string | undefined = `${await itemsUrl(name)}?$expand=fields&$top=999${filter ? `&$filter=${encodeURIComponent(filter)}` : ''}`;
  const out: Row[] = [];
  while (url) {
    const d: { value: { id: string; fields: Row }[]; '@odata.nextLink'?: string } = await graph('GET', url);
    for (const it of d.value) {
      if (!it.fields.Key) continue;
      spIds.set(`${name}:${it.fields.Key}`, it.id);
      out.push(it.fields);
    }
    url = d['@odata.nextLink'];
  }
  return out;
}
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const where = (field: string, value: string) => `fields/${field} eq ${q(value)}`;

async function create(name: ListName, fields: Row) {
  const it = await graph<{ id: string }>('POST', await itemsUrl(name), { fields });
  spIds.set(`${name}:${fields.Key}`, it.id);
}
async function spId(name: ListName, key: string) {
  let id = spIds.get(`${name}:${key}`);
  if (!id) { await rows(name, where('Key', key)); id = spIds.get(`${name}:${key}`); }
  if (!id) throw new Error('That was deleted by someone else. Reload the page.');
  return id;
}
async function update(name: ListName, key: string, fields: Record<string, unknown>) {
  await graph('PATCH', `${await itemsUrl(name)}/${await spId(name, key)}/fields`, fields);
}
async function removeAll(name: ListName, keys: string[]) {
  const base = await itemsUrl(name);
  const reqs = [];
  for (const k of keys) reqs.push({ method: 'DELETE', url: `${base.replace(GRAPH, '')}/${await spId(name, k)}` });
  await batch(reqs);
  keys.forEach((k) => spIds.delete(`${name}:${k}`));
}

const newKey = () => 'n' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
const now = () => new Date().toISOString();
const json = (s: string | undefined, fallback: any) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const PERSON_COLORS = ['#4f7cff', '#e8697d', '#21a67a', '#c2410c', '#7c3aed', '#0e7490'];
const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#037f4c', '#ff642e', '#66ccff'];
const DEFAULT_STATUS = { labels: [
  { id: 0, label: 'Working on it', color: '#fdab3d', done: false },
  { id: 1, label: 'Done', color: '#00c875', done: true },
  { id: 2, label: 'Stuck', color: '#df2f4a', done: false },
] };

// ---------- Row <-> app objects ----------
const person = (r: Row) => ({ id: r.Key, name: r.Title, email: r.Email || null, color: r.Color || null });
const board = (r: Row) => ({ id: r.Key, name: r.Title, workspace_id: r.WorkspaceKey, folder_id: r.FolderKey || null,
  description: r.Description || '', item_term: r.ItemTerm || 'Item', position: r.Position ?? 0 });
const group = (r: Row) => ({ id: r.Key, board_id: r.BoardKey, title: r.Title, color: r.Color, position: r.Position ?? 0, collapsed: r.Collapsed ?? 0 });
const column = (r: Row) => ({ id: r.Key, board_id: r.BoardKey, is_sub: r.IsSub ?? 0, title: r.Title, type: r.ColType,
  settings: json(r.Settings, {}), width: r.Width ?? null, position: r.Position ?? 0 });
const item = (r: Row, updates = 0) => ({ id: r.Key, board_id: r.BoardKey, group_id: r.GroupKey || null, parent_id: r.ParentKey || null,
  name: r.Title, vals: json(r.Vals, {}), position: r.Position ?? 0, updates, created_at: r.CreatedAt, updated_at: r.UpdatedAt });
const byPos = <T extends { position: number }>(a: T[]) => a.sort((x, y) => x.position - y.position);

let me: ReturnType<typeof person> | null = null;
let peopleCache: ReturnType<typeof person>[] = [];

// ---------- The operations the app uses ----------
export const store = {
  async bootstrap() {
    const account = await signIn();
    if (!account) return new Promise(() => {});
    const [profile, workspaces, folders, boards, people] = await Promise.all([
      graph<{ displayName: string; mail: string | null; userPrincipalName: string }>('GET', '/me?$select=displayName,mail,userPrincipalName'),
      rows('Workspaces'), rows('Folders'), rows('Boards'), rows('People'),
    ]);
    peopleCache = people.map(person);
    const emails = [profile.mail, profile.userPrincipalName].filter(Boolean).map((e) => e!.toLowerCase());
    // A person's Email can list several addresses separated by commas
    // (someone with more than one school account).
    const addresses = (p: { email: string | null }) => (p.email ?? '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean);
    me = peopleCache.find((p) => addresses(p).some((e) => emails.includes(e))) ?? null;
    if (!me) {
      const p = { Key: newKey(), Title: profile.displayName, Email: emails[0], Color: PERSON_COLORS[peopleCache.length % PERSON_COLORS.length] };
      await create('People', p);
      me = person(p);
      peopleCache.push(me);
    }
    return {
      workspaces: byPos(workspaces.map((w) => ({ id: w.Key, name: w.Title, position: w.Position ?? 0 }))),
      folders: byPos(folders.map((f) => ({ id: f.Key, workspace_id: f.WorkspaceKey, name: f.Title, position: f.Position ?? 0 })))
        .sort((a, z) => a.name.localeCompare(z.name)),
      boards: boards.map(board).sort((a, z) => a.position - z.position || a.name.localeCompare(z.name)),
      people: [...peopleCache].sort((a, z) => a.name.localeCompare(z.name)),
      me,
    };
  },

  async addPerson({ name, email }: { name: string; email?: string }) {
    if (!name?.trim()) throw new Error('Name is required');
    const p = { Key: newKey(), Title: name.trim(), Email: email?.trim().toLowerCase() || '', Color: PERSON_COLORS[peopleCache.length % PERSON_COLORS.length] };
    await create('People', p);
    const out = person(p);
    peopleCache.push(out);
    return out;
  },

  async getBoard(id: string) {
    const [b, groups, columns, items, updates] = await Promise.all([
      rows('Boards', where('Key', id)), rows('BoardGroups', where('BoardKey', id)), rows('BoardColumns', where('BoardKey', id)),
      rows('Items', where('BoardKey', id)), rows('Updates', where('BoardKey', id)),
    ]);
    if (!b[0]) throw new Error('Board not found');
    const counts = new Map<string, number>();
    for (const u of updates) counts.set(u.ItemKey, (counts.get(u.ItemKey) ?? 0) + 1);
    return { board: board(b[0]), groups: byPos(groups.map(group)), columns: byPos(columns.map(column)),
      items: byPos(items.map((r) => item(r, counts.get(r.Key) ?? 0))) };
  },

  async createBoard({ name, workspace_id, folder_id }: { name: string; workspace_id: string; folder_id?: string | null }) {
    const key = newKey();
    await create('Boards', { Key: key, Title: name || 'New Board', WorkspaceKey: workspace_id, FolderKey: folder_id ?? '', Description: '', ItemTerm: 'Item', Position: Date.now() / 1e10 });
    await create('BoardGroups', { Key: newKey(), Title: 'Group Title', BoardKey: key, Color: GROUP_COLORS[0], Position: 0, Collapsed: 0 });
    const cols: [number, string, string, object][] = [
      [0, 'Person', 'people', {}], [0, 'Status', 'status', DEFAULT_STATUS], [0, 'Date', 'date', {}],
      [1, 'Owner', 'people', {}], [1, 'Status', 'status', DEFAULT_STATUS], [1, 'Date', 'date', {}],
    ];
    for (const [i, [isSub, title, type, settings]] of cols.entries())
      await create('BoardColumns', { Key: newKey(), Title: title, BoardKey: key, IsSub: isSub, ColType: type, Settings: JSON.stringify(settings), Position: i });
    return { id: key };
  },
  async patchBoard(id: string, b: { name?: string; description?: string; item_term?: string }) {
    const f: Record<string, unknown> = {};
    if (b.name !== undefined) f.Title = b.name;
    if (b.description !== undefined) f.Description = b.description;
    if (b.item_term !== undefined) f.ItemTerm = b.item_term;
    await update('Boards', id, f);
    return { ok: true };
  },
  async deleteBoard(id: string) {
    const [g, c, i, u] = await Promise.all([rows('BoardGroups', where('BoardKey', id)), rows('BoardColumns', where('BoardKey', id)),
      rows('Items', where('BoardKey', id)), rows('Updates', where('BoardKey', id))]);
    await removeAll('Updates', u.map((r) => r.Key));
    await removeAll('Items', i.map((r) => r.Key));
    await removeAll('BoardColumns', c.map((r) => r.Key));
    await removeAll('BoardGroups', g.map((r) => r.Key));
    await removeAll('Boards', [id]);
    return { ok: true };
  },

  async createGroup(boardId: string, { title }: { title?: string }) {
    const existing = await rows('BoardGroups', where('BoardKey', boardId));
    const g = { Key: newKey(), Title: title || 'New Group', BoardKey: boardId, Color: GROUP_COLORS[existing.length % GROUP_COLORS.length],
      Position: Math.min(0, ...existing.map((r) => r.Position ?? 0)) - 1, Collapsed: 0 };
    await create('BoardGroups', g);
    return group(g);
  },
  async patchGroup(id: string, b: { title?: string; color?: string; collapsed?: number; position?: number }) {
    const f: Record<string, unknown> = {};
    if (b.title !== undefined) f.Title = b.title;
    if (b.color !== undefined) f.Color = b.color;
    if (b.collapsed !== undefined) f.Collapsed = b.collapsed;
    if (b.position !== undefined) f.Position = b.position;
    await update('BoardGroups', id, f);
    return { ok: true };
  },
  async deleteGroup(id: string) {
    const g = (await rows('BoardGroups', where('Key', id)))[0];
    if (!g) return { ok: true };
    const items = await rows('Items', where('BoardKey', g.BoardKey));
    const top = new Set(items.filter((i) => i.GroupKey === id).map((i) => i.Key));
    const gone = items.filter((i) => top.has(i.Key) || top.has(i.ParentKey));
    const goneKeys = new Set(gone.map((i) => i.Key));
    const updates = (await rows('Updates', where('BoardKey', g.BoardKey))).filter((u) => goneKeys.has(u.ItemKey));
    await removeAll('Updates', updates.map((u) => u.Key));
    await removeAll('Items', [...goneKeys]);
    await removeAll('BoardGroups', [id]);
    return { ok: true };
  },

  async createColumn(boardId: string, { title, type, is_sub }: { title: string; type: string; is_sub?: number }) {
    const existing = (await rows('BoardColumns', where('BoardKey', boardId))).filter((c) => (c.IsSub ?? 0) === (is_sub ? 1 : 0));
    const settings = type === 'status' ? DEFAULT_STATUS : type === 'dropdown' ? { labels: [] } : {};
    const c = { Key: newKey(), Title: title || 'Column', BoardKey: boardId, IsSub: is_sub ? 1 : 0, ColType: type,
      Settings: JSON.stringify(settings), Position: Math.max(0, ...existing.map((r) => r.Position ?? 0)) + 1 };
    await create('BoardColumns', c);
    return column(c);
  },
  async patchColumn(id: string, b: { title?: string; settings?: object; width?: number; position?: number }) {
    const f: Record<string, unknown> = {};
    if (b.title !== undefined) f.Title = b.title;
    if (b.settings !== undefined) f.Settings = JSON.stringify(b.settings);
    if (b.width !== undefined) f.Width = b.width;
    if (b.position !== undefined) f.Position = b.position;
    await update('BoardColumns', id, f);
    return { ok: true };
  },
  async deleteColumn(id: string) {
    const c = (await rows('BoardColumns', where('Key', id)))[0];
    if (!c) return { ok: true };
    const items = (await rows('Items', where('BoardKey', c.BoardKey))).filter((i) => id in json(i.Vals, {}));
    const base = (await itemsUrl('Items')).replace(GRAPH, '');
    await batch(items.map((i) => {
      const vals = json(i.Vals, {});
      delete vals[id];
      return { method: 'PATCH', url: `${base}/${spIds.get(`Items:${i.Key}`)}/fields`, body: { Vals: JSON.stringify(vals) } };
    }));
    await removeAll('BoardColumns', [id]);
    return { ok: true };
  },

  async createItem(boardId: string, b: { group_id?: string; parent_id?: string; name: string; vals?: object }) {
    const t = now();
    const r = { Key: newKey(), Title: (b.name?.trim() || 'New item').slice(0, 255), BoardKey: boardId,
      GroupKey: b.parent_id ? '' : b.group_id ?? '', ParentKey: b.parent_id ?? '', Vals: JSON.stringify(b.vals ?? {}),
      Position: Date.now() / 1e6, CreatedBy: me?.id ?? '', CreatedAt: t, UpdatedAt: t };
    await create('Items', r);
    return item(r);
  },
  async patchItem(id: string, b: { name?: string; group_id?: string; position?: number; vals?: Record<string, unknown> }) {
    const f: Record<string, unknown> = { UpdatedAt: now() };
    if (b.name !== undefined) f.Title = b.name.slice(0, 255);
    if (b.group_id !== undefined) f.GroupKey = b.group_id;
    if (b.position !== undefined) f.Position = b.position;
    if (b.vals) {
      // Merge into the latest saved copy, so two people editing different
      // cells of the same item don't undo each other.
      const fresh = await graph<{ Vals?: string }>('GET', `${await itemsUrl('Items')}/${await spId('Items', id)}/fields?$select=Vals`);
      const vals = json(fresh.Vals, {});
      for (const [k, v] of Object.entries(b.vals)) {
        if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete vals[k]; else vals[k] = v;
      }
      f.Vals = JSON.stringify(vals);
    }
    await update('Items', id, f);
    return { ok: true };
  },
  async deleteItem(id: string) {
    const [subs, ups] = await Promise.all([rows('Items', where('ParentKey', id)), rows('Updates', where('ItemKey', id))]);
    const subUps = (await Promise.all(subs.map((s) => rows('Updates', where('ItemKey', s.Key))))).flat();
    await removeAll('Updates', [...ups, ...subUps].map((u) => u.Key));
    await removeAll('Items', [...subs.map((s) => s.Key), id]);
    return { ok: true };
  },

  async getUpdates(itemId: string) {
    const ups = await rows('Updates', where('ItemKey', itemId));
    return ups.map((u) => {
      const p = peopleCache.find((x) => x.id === u.AuthorKey);
      return { id: u.Key, item_id: u.ItemKey, author_id: u.AuthorKey, author_name: p?.name ?? null, author_color: p?.color ?? null, body: u.Body, created_at: u.CreatedAt };
    }).sort((a, z) => z.created_at.localeCompare(a.created_at));
  },
  async createUpdate(itemId: string, { body }: { body: string }) {
    if (!body?.trim()) throw new Error('Write something first');
    const it = (await rows('Items', where('Key', itemId)))[0];
    const u = { Key: newKey(), Title: '', ItemKey: itemId, BoardKey: it?.BoardKey ?? '', AuthorKey: me?.id ?? '', Body: body.trim(), CreatedAt: now() };
    await create('Updates', u);
    return { id: u.Key, item_id: itemId, author_id: u.AuthorKey, author_name: me?.name ?? null, author_color: me?.color ?? null, body: u.Body, created_at: u.CreatedAt };
  },
};
