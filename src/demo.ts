// Made-up sample data for previewing the design on this Mac only
// (npm run dev, then open http://localhost:5173/?demo). No school data here,
// and the live site never uses it.
const people = [
  { id: 'p1', name: 'Office Staff', email: 'office@example.org', color: '#4f7cff' },
  { id: 'p2', name: 'Principal', email: 'principal@example.org', color: '#e8697d' },
];
const status = { labels: [
  { id: 0, label: 'Working on it', color: '#fdab3d', done: false },
  { id: 1, label: 'Done', color: '#00c875', done: true },
  { id: 2, label: 'Stuck', color: '#df2f4a', done: false },
] };
const days = { labels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((label, i) => ({ id: i + 1, label })) };
const board = { id: 'b1', name: 'Office Tasks', workspace_id: 'w1', folder_id: 'f1', description: 'Sample board for previewing the design.', item_term: 'Task', position: 0 };
const groups = [
  { id: 'g1', board_id: 'b1', title: 'This Week', color: '#579bfc', position: 0, collapsed: 0 },
  { id: 'g2', board_id: 'b1', title: 'This Month', color: '#a25ddc', position: 1, collapsed: 0 },
];
const columns = [
  { id: 'c1', board_id: 'b1', is_sub: 0, title: 'Person', type: 'people', settings: {}, width: null, position: 0 },
  { id: 'c2', board_id: 'b1', is_sub: 0, title: 'Status', type: 'status', settings: status, width: null, position: 1 },
  { id: 'c3', board_id: 'b1', is_sub: 0, title: 'Due Date', type: 'date', settings: {}, width: null, position: 2 },
  { id: 'c4', board_id: 'b1', is_sub: 0, title: 'Day', type: 'dropdown', settings: days, width: null, position: 3 },
  { id: 'c5', board_id: 'b1', is_sub: 0, title: 'Notes', type: 'text', settings: {}, width: null, position: 4 },
  { id: 's1', board_id: 'b1', is_sub: 1, title: 'Owner', type: 'people', settings: {}, width: null, position: 0 },
  { id: 's2', board_id: 'b1', is_sub: 1, title: 'Status', type: 'status', settings: status, width: null, position: 1 },
];
const t = '2026-11-01T12:00:00Z';
const mk = (id: string, group_id: string | null, name: string, vals: object, position: number, parent_id: string | null = null, updates = 0) =>
  ({ id, board_id: 'b1', group_id, parent_id, name, vals, position, updates, created_at: t, updated_at: t });
const items = [
  mk('i1', 'g1', 'Order classroom supplies', { c1: ['p1'], c2: 0, c3: '2026-11-21', c4: [1] }, 0, null, 2),
  mk('i2', 'g1', 'Send weekly parent newsletter', { c1: ['p2'], c2: 1, c3: '2026-11-20', c4: [5], c5: 'Sent Friday' }, 1),
  mk('i3', 'g1', 'Update chapel schedule', { c2: 2, c4: [3] }, 2),
  mk('i4', 'g2', 'Plan the Christmas program', { c1: ['p1', 'p2'], c2: 0, c3: '2026-12-12' }, 0),
  mk('i5', 'g2', 'Prepare report cards', { c1: ['p2'] }, 1),
  mk('i6', null, 'Print programs', { s2: 1 }, 0, 'i4'),
  mk('i7', null, 'Reserve the sanctuary', {}, 1, 'i4'),
];

const ok = async () => ({ ok: true });
export const demo = {
  bootstrap: async () => ({ workspaces: [{ id: 'w1', name: 'Sample workspace', position: 0 }],
    folders: [{ id: 'f1', workspace_id: 'w1', name: 'School Office', position: 0 }], boards: [board], people, me: people[0] }),
  addPerson: async (b: { name: string }) => ({ id: 'p' + Date.now(), name: b.name, email: null, color: '#21a67a' }),
  getBoard: async () => ({ board, groups, columns, items }),
  createBoard: async () => ({ id: 'b1' }), patchBoard: ok, deleteBoard: ok,
  createGroup: async (_: string, b: { title?: string }) => ({ id: 'g' + Date.now(), board_id: 'b1', title: b.title || 'New Group', color: '#00c875', position: -1, collapsed: 0 }),
  patchGroup: ok, deleteGroup: ok,
  createColumn: async (_: string, b: { title: string; type: string; is_sub?: number }) => ({ id: 'c' + Date.now(), board_id: 'b1', is_sub: b.is_sub ?? 0, title: b.title, type: b.type, settings: {}, width: null, position: 99 }),
  patchColumn: ok, deleteColumn: ok,
  createItem: async (_: string, b: { group_id?: string; parent_id?: string; name: string }) => mk('i' + Date.now(), b.parent_id ? null : b.group_id ?? null, b.name, {}, 99, b.parent_id ?? null),
  patchItem: ok, deleteItem: ok,
  getUpdates: async () => [
    { id: 'u1', item_id: 'i1', author_id: 'p2', author_name: 'Principal', author_color: '#e8697d', body: 'Please include dry-erase markers.', created_at: t },
  ],
  createUpdate: async (itemId: string, b: { body: string }) => ({ id: 'u' + Date.now(), item_id: itemId, author_id: 'p1', author_name: 'Office Staff', author_color: '#4f7cff', body: b.body, created_at: new Date().toISOString() }),
};
