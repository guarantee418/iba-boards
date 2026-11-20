import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { Cell } from './cells';
import { ItemPanel } from './ItemPanel';
import { Kanban } from './Kanban';
import type { BoardData, Column, ColumnType, Group, Item, Person } from './types';
import { COLUMN_TYPES, GROUP_COLORS } from './types';
import { Avatar, EditableText, MenuItem, Popover, useAnchor } from './ui';

const DEFAULT_WIDTH: Record<ColumnType, number> = {
  status: 140, people: 100, date: 116, dropdown: 170, text: 190, long_text: 230, number: 100, checkbox: 84,
};
const colWidth = (c: Column) => c.width ?? DEFAULT_WIDTH[c.type] ?? 150;
const template = (cols: Column[], nameWidth: number) => `${nameWidth}px ${cols.map((c) => `${colWidth(c)}px`).join(' ')} 44px`;

type BoardApi = ReturnType<typeof useBoardApi>;
const BoardCtx = createContext<BoardApi | null>(null);
export const useBoard = () => useContext(BoardCtx)!;

function useBoardApi(boardId: string, people: Person[], onAddPerson: (n: string, e: string) => Promise<Person>, onRenamed: (name: string) => void) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<BoardData>(`/api/boards/${boardId}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [boardId]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Every change is applied on screen first, then saved. If saving fails we reload.
  const save = (p: Promise<unknown>) => p.catch((e) => { alert(`That change didn't save: ${e.message}`); load(); });
  const mut = (fn: (d: BoardData) => BoardData) => setData((d) => (d ? fn(d) : d));

  return {
    data, error, people, onAddPerson,
    renameBoard(name: string) { mut((d) => ({ ...d, board: { ...d.board, name } })); onRenamed(name); save(api.patch(`/api/boards/${boardId}`, { name })); },
    describeBoard(description: string) { mut((d) => ({ ...d, board: { ...d.board, description } })); save(api.patch(`/api/boards/${boardId}`, { description })); },

    patchItem(id: string, patch: Partial<Pick<Item, 'name' | 'group_id' | 'position'>> & { vals?: Record<string, any> }) {
      mut((d) => ({ ...d, items: d.items.map((i) => {
        if (i.id !== id) return i;
        const vals = { ...i.vals };
        for (const [k, v] of Object.entries(patch.vals ?? {})) {
          if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete vals[k]; else vals[k] = v;
        }
        return { ...i, ...patch, vals, updated_at: new Date().toISOString() };
      }) }));
      save(api.patch(`/api/items/${id}`, patch));
    },
    async addItem(opts: { group_id?: string; parent_id?: string; name: string; vals?: Record<string, any> }) {
      try {
        const item = await api.post<Item>(`/api/boards/${boardId}/items`, opts);
        mut((d) => ({ ...d, items: [...d.items, item] }));
        return item;
      } catch (e: any) { alert(e.message); return null; }
    },
    deleteItem(id: string) {
      mut((d) => ({ ...d, items: d.items.filter((i) => i.id !== id && i.parent_id !== id) }));
      save(api.del(`/api/items/${id}`));
    },
    bumpUpdates(id: string, by: number) { mut((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, updates: i.updates + by } : i)) })); },

    async addGroup() {
      const g = await api.post<Group>(`/api/boards/${boardId}/groups`, { title: 'New Group' });
      mut((d) => ({ ...d, groups: [g, ...d.groups] }));
    },
    patchGroup(id: string, patch: Partial<Group>) {
      mut((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
      save(api.patch(`/api/groups/${id}`, patch));
    },
    deleteGroup(id: string) {
      mut((d) => {
        const gone = new Set(d.items.filter((i) => i.group_id === id).map((i) => i.id));
        return { ...d, groups: d.groups.filter((g) => g.id !== id), items: d.items.filter((i) => !gone.has(i.id) && !gone.has(i.parent_id ?? '')) };
      });
      save(api.del(`/api/groups/${id}`));
    },

    async addColumn(type: ColumnType, is_sub: number) {
      const label = COLUMN_TYPES.find((t) => t.type === type)?.label ?? 'Column';
      const col = await api.post<Column>(`/api/boards/${boardId}/columns`, { title: label, type, is_sub });
      mut((d) => ({ ...d, columns: [...d.columns, col] }));
    },
    patchColumn(id: string, patch: Partial<Pick<Column, 'title' | 'settings' | 'width'>>) {
      mut((d) => ({ ...d, columns: d.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      save(api.patch(`/api/columns/${id}`, patch));
    },
    deleteColumn(id: string) {
      mut((d) => ({ ...d, columns: d.columns.filter((c) => c.id !== id), items: d.items.map((i) => { const vals = { ...i.vals }; delete vals[id]; return { ...i, vals }; }) }));
      save(api.del(`/api/columns/${id}`));
    },
  };
}

export function Board({ boardId, people, onAddPerson, onRenamed, onDeleted }: {
  boardId: string; people: Person[]; onAddPerson: (n: string, e: string) => Promise<Person>;
  onRenamed: (name: string) => void; onDeleted: () => void;
}) {
  const b = useBoardApi(boardId, people, onAddPerson, onRenamed);
  const [view, setView] = useState<'table' | 'kanban'>(() => (localStorage.getItem(`view:${boardId}`) as 'kanban') || 'table');
  const [query, setQuery] = useState('');
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const menu = useAnchor();
  const personMenu = useAnchor();
  useEffect(() => { try { localStorage.setItem(`view:${boardId}`, view); } catch { /* private mode */ } }, [view, boardId]);
  useEffect(() => { setOpenItem(null); setQuery(''); setPersonFilter(null); }, [boardId]);

  const d = b.data;
  const matches = useMemo(() => {
    if (!d) return () => true;
    const peopleCols = d.columns.filter((c) => c.type === 'people').map((c) => c.id);
    const q = query.trim().toLowerCase();
    const self = (i: Item) =>
      (!q || i.name.toLowerCase().includes(q) || Object.values(i.vals).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))) &&
      (!personFilter || peopleCols.some((c) => (i.vals[c] ?? []).includes(personFilter)));
    return (i: Item) => self(i) || d.items.some((s) => s.parent_id === i.id && self(s));
  }, [d, query, personFilter]);

  if (b.error) return <div className="board-empty">Couldn't open this board: {b.error}</div>;
  if (!d) return <div className="board-empty">Loading…</div>;

  const term = d.board.item_term || 'Item';
  const firstGroup = d.groups[0];
  const filterPerson = people.find((p) => p.id === personFilter);
  const item = openItem ? d.items.find((i) => i.id === openItem) : undefined;

  return (
    <BoardCtx.Provider value={b}>
      <div className="board">
        <header className="board-head">
          <div className="board-title-row">
            <EditableText className="board-title" value={d.board.name} onSave={(v) => v.trim() && b.renameBoard(v.trim())} />
            <button className="icon-btn" onClick={menu.toggle} title="Board options">⋯</button>
            {menu.anchor && (
              <Popover anchor={menu.anchor} onClose={menu.close} width={220}>
                <MenuItem danger onClick={async () => {
                  menu.close();
                  if (!confirm(`Delete the board "${d.board.name}" and everything on it? This can't be undone.`)) return;
                  await api.del(`/api/boards/${boardId}`); onDeleted();
                }}>Delete board</MenuItem>
              </Popover>
            )}
          </div>
          <EditableText className="board-desc" value={d.board.description ?? ''} placeholder="Add a board description" onSave={b.describeBoard} />
          <div className="tabs">
            <button className={view === 'table' ? 'tab active' : 'tab'} onClick={() => setView('table')}>▦ Main table</button>
            <button className={view === 'kanban' ? 'tab active' : 'tab'} onClick={() => setView('kanban')}>☷ Kanban</button>
          </div>
          <div className="toolbar">
            <button className="btn btn-primary" disabled={!firstGroup} onClick={async () => {
              if (!firstGroup) return;
              const it = await b.addItem({ group_id: firstGroup.id, name: `New ${term.toLowerCase()}` });
              if (it) setOpenItem(it.id);
            }}>New {term.toLowerCase()}</button>
            <input className="input search" placeholder="🔍 Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className={`btn ${personFilter ? 'btn-on' : ''}`} onClick={personMenu.toggle}>
              {filterPerson ? <><Avatar person={filterPerson} size={18} /> {filterPerson.name}</> : '👤 Person'}
            </button>
            {personMenu.anchor && (
              <Popover anchor={personMenu.anchor} onClose={personMenu.close} width={220}>
                <div className="muted small pad">Show only items for…</div>
                {people.map((p) => (
                  <MenuItem key={p.id} onClick={() => { setPersonFilter(p.id); personMenu.close(); }}><Avatar person={p} size={22} /> {p.name}</MenuItem>
                ))}
                {personFilter && <><div className="menu-sep" /><MenuItem onClick={() => { setPersonFilter(null); personMenu.close(); }}>Show everyone</MenuItem></>}
              </Popover>
            )}
            <button className="btn" onClick={b.addGroup}>+ Add group</button>
          </div>
        </header>

        {view === 'table' ? (
          <div className="table-scroll">
            {d.groups.map((g) => <GroupSection key={g.id} group={g} matches={matches} onOpen={setOpenItem} filtering={!!query || !!personFilter} />)}
            <button className="add-group" onClick={b.addGroup}>+ Add new group</button>
          </div>
        ) : (
          <Kanban data={d} matches={matches} onOpen={setOpenItem} />
        )}
      </div>
      {item && <ItemPanel item={item} onClose={() => setOpenItem(null)} />}
    </BoardCtx.Provider>
  );
}

// ---------- Group ----------
function GroupSection({ group, matches, onOpen, filtering }: { group: Group; matches: (i: Item) => boolean; onOpen: (id: string) => void; filtering: boolean }) {
  const b = useBoard();
  const d = b.data!;
  const menu = useAnchor();
  const [colorPick, setColorPick] = useState(false);
  const cols = d.columns.filter((c) => !c.is_sub);
  const all = d.items.filter((i) => i.group_id === group.id && !i.parent_id).sort((a, z) => a.position - z.position);
  const items = all.filter(matches);
  if (filtering && items.length === 0) return null;
  const tpl = template(cols, 360);
  const term = d.board.item_term || 'Item';

  return (
    <section className="group" style={{ ['--group' as any]: group.color }}>
      <div className="group-head">
        <button className="icon-btn group-menu-btn" onClick={menu.toggle} title="Group options">⋯</button>
        <button className={`chev ${group.collapsed ? '' : 'open'}`} onClick={() => b.patchGroup(group.id, { collapsed: group.collapsed ? 0 : 1 })}>▸</button>
        <EditableText className="group-title" value={group.title} onSave={(v) => v.trim() && b.patchGroup(group.id, { title: v.trim() })} />
        <span className="group-count">{all.length} {all.length === 1 ? term : `${term}s`}</span>
        {menu.anchor && (
          <Popover anchor={menu.anchor} onClose={() => { menu.close(); setColorPick(false); }} width={220}>
            {colorPick ? (
              <div className="swatches">
                {GROUP_COLORS.map((c) => <button key={c} className="swatch big" style={{ background: c }} onClick={() => { b.patchGroup(group.id, { color: c }); menu.close(); setColorPick(false); }} />)}
              </div>
            ) : (
              <>
                <MenuItem onClick={() => { b.patchGroup(group.id, { collapsed: group.collapsed ? 0 : 1 }); menu.close(); }}>{group.collapsed ? 'Expand group' : 'Collapse group'}</MenuItem>
                <MenuItem onClick={() => setColorPick(true)}>Change group color</MenuItem>
                <MenuItem onClick={() => { b.addGroup(); menu.close(); }}>Add group</MenuItem>
                <div className="menu-sep" />
                <MenuItem danger onClick={() => {
                  menu.close();
                  if (confirm(`Delete the group "${group.title}" and its ${all.length} ${term.toLowerCase()}(s)? This can't be undone.`)) b.deleteGroup(group.id);
                }}>Delete group</MenuItem>
              </>
            )}
          </Popover>
        )}
      </div>

      {group.collapsed ? (
        <div className="group-collapsed"><StatusSummaries cols={cols} items={all} tpl={tpl} lead={<span className="muted">{group.title}</span>} /></div>
      ) : (
        <div className="grid">
          <HeaderRow cols={cols} tpl={tpl} isSub={0} first={term} />
          {items.map((i) => <Row key={i.id} item={i} cols={cols} tpl={tpl} onOpen={onOpen} matches={matches} />)}
          <AddRow tpl={tpl} placeholder={`+ Add ${term.toLowerCase()}`} onAdd={(name) => b.addItem({ group_id: group.id, name })} />
          <StatusSummaries cols={cols} items={all} tpl={tpl} />
        </div>
      )}
    </section>
  );
}

function HeaderRow({ cols, tpl, isSub, first }: { cols: Column[]; tpl: string; isSub: number; first: string }) {
  return (
    <div className="row row-head" style={{ gridTemplateColumns: tpl }}>
      <div className="hcell hcell-name">{first}</div>
      {cols.map((c) => <ColumnHeader key={c.id} col={c} />)}
      <AddColumn isSub={isSub} />
    </div>
  );
}

function ColumnHeader({ col }: { col: Column }) {
  const b = useBoard();
  const menu = useAnchor();
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="hcell">
      {renaming ? (
        <EditableText startEditing value={col.title} onSave={(v) => { setRenaming(false); if (v.trim()) b.patchColumn(col.id, { title: v.trim() }); }} />
      ) : (
        <span className="hcell-title" onDoubleClick={() => setRenaming(true)}>{col.title}</span>
      )}
      <button className="icon-btn hcell-menu" onClick={menu.toggle}>⋯</button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={200}>
          <MenuItem onClick={() => { setRenaming(true); menu.close(); }}>Rename</MenuItem>
          <MenuItem onClick={() => { b.patchColumn(col.id, { width: colWidth(col) + 40 }); }}>Make wider</MenuItem>
          <MenuItem onClick={() => { b.patchColumn(col.id, { width: Math.max(70, colWidth(col) - 40) }); }}>Make narrower</MenuItem>
          <div className="menu-sep" />
          <MenuItem danger onClick={() => {
            menu.close();
            if (confirm(`Delete the column "${col.title}" and everything in it? This can't be undone.`)) b.deleteColumn(col.id);
          }}>Delete column</MenuItem>
        </Popover>
      )}
    </div>
  );
}

function AddColumn({ isSub }: { isSub: number }) {
  const b = useBoard();
  const menu = useAnchor();
  return (
    <div className="hcell hcell-add">
      <button className="icon-btn" title="Add column" onClick={menu.toggle}>+</button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={200} align="right">
          <div className="muted small pad">Add a column</div>
          {COLUMN_TYPES.map((t) => (
            <MenuItem key={t.type} onClick={() => { b.addColumn(t.type, isSub); menu.close(); }}><span className="type-icon">{t.icon}</span> {t.label}</MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

// ---------- Rows ----------
function Row({ item, cols, tpl, onOpen, matches, sub }: {
  item: Item; cols: Column[]; tpl: string; onOpen: (id: string) => void; matches: (i: Item) => boolean; sub?: boolean;
}) {
  const b = useBoard();
  const d = b.data!;
  const menu = useAnchor();
  const [expanded, setExpanded] = useState(false);
  const children = sub ? [] : d.items.filter((i) => i.parent_id === item.id).sort((a, z) => a.position - z.position);
  const subCols = d.columns.filter((c) => c.is_sub);
  const subTpl = template(subCols, 320);

  return (
    <>
      <div className="row" style={{ gridTemplateColumns: tpl }}>
        <div className="cell cell-name">
          <button className="icon-btn row-menu" onClick={menu.toggle} title="Options">⋯</button>
          {!sub && (
            <button className={`sub-toggle ${children.length ? 'has' : ''} ${expanded ? 'open' : ''}`} onClick={() => setExpanded((e) => !e)}
              title={children.length ? `${children.length} subitems` : 'Add subitems'}>
              <span className="chev-sm">▸</span>{children.length > 0 && <span>{children.length}</span>}
            </button>
          )}
          <EditableText className="item-name" value={item.name} onSave={(v) => v.trim() && b.patchItem(item.id, { name: v.trim() })} />
          <button className={`open-btn ${item.updates ? 'has' : ''}`} onClick={() => onOpen(item.id)} title="Open and comment">
            💬{item.updates > 0 && <span className="badge">{item.updates}</span>}
          </button>
          {menu.anchor && (
            <Popover anchor={menu.anchor} onClose={menu.close} width={220}>
              <MenuItem onClick={() => { onOpen(item.id); menu.close(); }}>Open</MenuItem>
              {!sub && <MenuItem onClick={() => { setExpanded(true); menu.close(); }}>Add subitem</MenuItem>}
              {!sub && d.groups.length > 1 && <>
                <div className="menu-sep" /><div className="muted small pad">Move to group</div>
                {d.groups.filter((g) => g.id !== item.group_id).map((g) => (
                  <MenuItem key={g.id} onClick={() => { b.patchItem(item.id, { group_id: g.id }); menu.close(); }}>
                    <span className="dot" style={{ background: g.color }} /> {g.title}
                  </MenuItem>
                ))}
              </>}
              <div className="menu-sep" />
              <MenuItem danger onClick={() => { menu.close(); if (confirm(`Delete "${item.name}"? This can't be undone.`)) b.deleteItem(item.id); }}>Delete</MenuItem>
            </Popover>
          )}
        </div>
        {cols.map((c) => (
          <div key={c.id} className="cell-wrap">
            <Cell col={c} value={item.vals[c.id]} people={b.people} onAddPerson={b.onAddPerson}
              onChange={(v) => b.patchItem(item.id, { vals: { [c.id]: v } })}
              onSettings={(s) => b.patchColumn(c.id, { settings: s })} />
          </div>
        ))}
        <div className="cell cell-pad" />
      </div>
      {expanded && !sub && (
        <div className="subitems">
          <HeaderRow cols={subCols} tpl={subTpl} isSub={1} first="Subitem" />
          {children.filter(matches).map((s) => <Row key={s.id} item={s} cols={subCols} tpl={subTpl} onOpen={onOpen} matches={matches} sub />)}
          <AddRow tpl={subTpl} placeholder="+ Add subitem" onAdd={(name) => b.addItem({ parent_id: item.id, name })} />
        </div>
      )}
    </>
  );
}

function AddRow({ tpl, placeholder, onAdd }: { tpl: string; placeholder: string; onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="row row-add" style={{ gridTemplateColumns: tpl }}>
      <div className="cell cell-name">
        <input className="add-input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } if (e.key === 'Escape') setV(''); }}
          onBlur={() => { if (v.trim()) { onAdd(v.trim()); setV(''); } }} />
      </div>
    </div>
  );
}

/** The colored bar under each status column showing how many items have each label. */
function StatusSummaries({ cols, items, tpl, lead }: { cols: Column[]; items: Item[]; tpl: string; lead?: ReactNode }) {
  return (
    <div className="row row-summary" style={{ gridTemplateColumns: tpl }}>
      <div className="cell cell-name summary-lead">{lead}</div>
      {cols.map((c) => <div key={c.id} className="summary-cell">{c.type === 'status' && <StatusBar col={c} items={items} />}</div>)}
      <div />
    </div>
  );
}

export function StatusBar({ col, items }: { col: Column; items: Item[] }) {
  const labels = col.settings.labels ?? [];
  if (!items.length) return <div className="status-bar empty" />;
  const counts = labels.map((l) => ({ l, n: items.filter((i) => i.vals[col.id] === l.id).length })).filter((x) => x.n);
  const none = items.length - counts.reduce((s, x) => s + x.n, 0);
  return (
    <div className="status-bar" title={[...counts.map((x) => `${x.l.label}: ${x.n}`), none ? `Blank: ${none}` : ''].filter(Boolean).join('\n')}>
      {counts.map((x) => <span key={x.l.id} style={{ flex: x.n, background: x.l.color }} />)}
      {none > 0 && <span style={{ flex: none }} className="blank" />}
    </div>
  );
}
