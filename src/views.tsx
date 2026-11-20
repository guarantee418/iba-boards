// Saved board views, modeled on how monday.com treats them: a view is a layout
// (table or Kanban) plus its own search, filters and sort, saved on the board
// and shared by everyone. Changing a filter only affects your screen until you
// press "Save to this view".
import { useState } from 'react';
import type { BoardData, BoardView, Column, Item, Person, ViewFilter, ViewSort } from './types';
import { Avatar, MenuItem, Popover, useAnchor } from './ui';

/** Label id used in a filter for "this cell is blank". */
export const BLANK = -1;

export const defaultViews = (): BoardView[] => [
  { id: 'main', name: 'Main table', type: 'table', filter: {}, sort: null },
  { id: 'kanban', name: 'Kanban', type: 'kanban', filter: {}, sort: null },
];

export const newViewId = () => 'v' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/** What a view shows right now; the toolbar edits this before it's saved. */
export type ViewState = Pick<BoardView, 'filter' | 'sort' | 'lanes'>;
export const stateOf = (v: BoardView): ViewState => ({ filter: v.filter ?? {}, sort: v.sort ?? null, lanes: v.lanes ?? null });

const clean = (s: ViewState) => {
  const labels = Object.fromEntries(Object.entries(s.filter.labels ?? {}).filter(([, ids]) => ids.length));
  return JSON.stringify({
    query: s.filter.query?.trim() || '', person: s.filter.person || null, labels, sort: s.sort ?? null, lanes: s.lanes ?? null,
  });
};
export const sameState = (a: ViewState, b: ViewState) => clean(a) === clean(b);
export const filterCount = (f: ViewFilter) =>
  (f.person ? 1 : 0) + Object.values(f.labels ?? {}).filter((ids) => ids.length).length;

/** True when an item passes the view's search and filters (a parent also shows if one of its subitems does). */
export function matcher(d: BoardData, f: ViewFilter) {
  const peopleCols = d.columns.filter((c) => c.type === 'people').map((c) => c.id);
  const labelRules = Object.entries(f.labels ?? {}).filter(([, ids]) => ids.length);
  const q = f.query?.trim().toLowerCase() ?? '';
  const self = (i: Item) => {
    if (q && !(i.name.toLowerCase().includes(q) || Object.values(i.vals).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))) return false;
    if (f.person && !peopleCols.some((c) => (i.vals[c] ?? []).includes(f.person))) return false;
    for (const [col, ids] of labelRules) {
      const v = i.vals[col];
      const have: number[] = v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
      if (!(have.length ? have.some((x) => ids.includes(x)) : ids.includes(BLANK))) return false;
    }
    return true;
  };
  const anyFilter = !!q || !!f.person || labelRules.length > 0;
  return {
    anyFilter,
    matches: (i: Item) => !anyFilter || self(i) || d.items.some((s) => s.parent_id === i.id && self(s)),
  };
}

/**
 * Orders items by one column, the way monday does: inside each group, blanks
 * last, statuses in their label order, people by name.
 */
export function sorter(d: BoardData, people: Person[], sort: ViewSort) {
  const byPosition = (a: Item, z: Item) => a.position - z.position;
  // 'name' is the item name, which isn't stored as a column.
  const col = sort && (sort.col === 'name' ? ({ id: 'name', type: 'text', settings: {} } as Pick<Column, 'id' | 'type' | 'settings'>) : d.columns.find((c) => c.id === sort.col));
  if (!sort || !col) return byPosition;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const key = (i: Item): string | number | null => {
    if (col.id === 'name') return i.name.toLowerCase();
    const v = i.vals[col.id];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
    switch (col.type) {
      case 'number': return Number(v);
      case 'checkbox': return v ? 1 : 0;
      case 'status': { const n = (col.settings.labels ?? []).findIndex((l) => l.id === v); return n < 0 ? null : n; }
      case 'dropdown': {
        const labels = col.settings.labels ?? [];
        return (v as number[]).map((id) => labels.find((l) => l.id === id)?.label ?? '').sort().join(', ').toLowerCase();
      }
      case 'people': return (v as string[]).map((id) => people.find((p) => p.id === id)?.name ?? '').sort().join(', ').toLowerCase();
      default: return String(v).toLowerCase(); // text, long text and dates (YYYY-MM-DD sorts as text)
    }
  };
  return (a: Item, z: Item) => {
    const x = key(a), y = key(z);
    if (x === null || y === null) return x === y ? byPosition(a, z) : x === null ? 1 : -1;
    if (x < y) return -dir;
    if (x > y) return dir;
    return byPosition(a, z);
  };
}

// ---------- Toolbar pieces ----------

/** "Filter" button: pick labels in any status or dropdown column, like monday's quick filters. */
export function FilterButton({ cols, filter, onChange }: { cols: Column[]; filter: ViewFilter; onChange: (f: ViewFilter) => void }) {
  const menu = useAnchor();
  const labelCols = cols.filter((c) => !c.is_sub && (c.type === 'status' || c.type === 'dropdown') && (c.settings.labels ?? []).length);
  const n = Object.values(filter.labels ?? {}).filter((ids) => ids.length).length;
  const toggle = (col: string, id: number) => {
    const cur = filter.labels?.[col] ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...filter, labels: { ...(filter.labels ?? {}), [col]: next } });
  };
  if (!labelCols.length) return null;
  return (
    <>
      <button className={`btn ${n ? 'btn-on' : ''}`} onClick={menu.toggle}>⏷ Filter{n ? ` / ${n}` : ''}</button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={Math.min(window.innerWidth - 16, 200 * Math.min(labelCols.length, 3) + 12)}>
          <div className="filter-head">
            <span className="muted small">Show only items with…</span>
            {n > 0 && <button className="link-btn small" onClick={() => onChange({ ...filter, labels: {} })}>Clear all</button>}
          </div>
          <div className="filter-cols">
            {labelCols.map((c) => (
              <div key={c.id} className="filter-col">
                <div className="filter-col-title">{c.title}</div>
                {[...(c.settings.labels ?? []), { id: BLANK, label: 'Blank', color: undefined }].map((l) => {
                  const on = (filter.labels?.[c.id] ?? []).includes(l.id);
                  return (
                    <button key={l.id} className={`filter-chip ${on ? 'on' : ''}`} onClick={() => toggle(c.id, l.id)}>
                      <span className="swatch" style={{ background: l.color ?? 'var(--line-strong)' }} />
                      <span className="filter-chip-label">{l.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export function PersonButton({ people, person, onChange }: { people: Person[]; person: string | null | undefined; onChange: (id: string | null) => void }) {
  const menu = useAnchor();
  const who = people.find((p) => p.id === person);
  return (
    <>
      <button className={`btn ${who ? 'btn-on' : ''}`} onClick={menu.toggle}>
        {who ? <><Avatar person={who} size={18} /> {who.name}</> : '👤 Person'}
      </button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={220}>
          <div className="muted small pad">Show only items for…</div>
          {people.map((p) => (
            <MenuItem key={p.id} onClick={() => { onChange(p.id); menu.close(); }}><Avatar person={p} size={22} /> {p.name}</MenuItem>
          ))}
          {who && <><div className="menu-sep" /><MenuItem onClick={() => { onChange(null); menu.close(); }}>Show everyone</MenuItem></>}
        </Popover>
      )}
    </>
  );
}

export function SortButton({ cols, term, sort, onChange }: { cols: Column[]; term: string; sort: ViewSort; onChange: (s: ViewSort) => void }) {
  const menu = useAnchor();
  const choices = [{ id: 'name', title: term }, ...cols.filter((c) => !c.is_sub).map((c) => ({ id: c.id, title: c.title }))];
  const cur = sort && choices.find((c) => c.id === sort.col);
  return (
    <>
      <button className={`btn ${cur ? 'btn-on' : ''}`} onClick={menu.toggle}>⇅ {cur ? `${cur.title} ${sort!.dir === 'desc' ? '↓' : '↑'}` : 'Sort'}</button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={240}>
          <div className="muted small pad">Sort items in each group by…</div>
          {choices.map((c) => (
            <div key={c.id} className="sort-row">
              <span className="sort-name">{c.title}</span>
              <button className={`sort-dir ${sort?.col === c.id && sort.dir === 'asc' ? 'on' : ''}`} title="Ascending" onClick={() => { onChange({ col: c.id, dir: 'asc' }); menu.close(); }}>↑</button>
              <button className={`sort-dir ${sort?.col === c.id && sort.dir === 'desc' ? 'on' : ''}`} title="Descending" onClick={() => { onChange({ col: c.id, dir: 'desc' }); menu.close(); }}>↓</button>
            </div>
          ))}
          {cur && <><div className="menu-sep" /><MenuItem onClick={() => { onChange(null); menu.close(); }}>Clear sort (use the board's order)</MenuItem></>}
        </Popover>
      )}
    </>
  );
}

// ---------- View tabs ----------

/** The row of view tabs over a board, with a ⋯ menu per view and "+" to add one. */
export function ViewTabs({ views, active, onSelect, onChange }: {
  views: BoardView[]; active: string; onSelect: (id: string) => void; onChange: (views: BoardView[]) => void;
}) {
  const add = useAnchor();
  const [menuFor, setMenuFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const icon = (v: BoardView) => (v.type === 'kanban' ? '☷' : '▦');
  const addView = (type: BoardView['type']) => {
    const base = type === 'kanban' ? 'Kanban' : 'Table';
    const taken = new Set(views.map((v) => v.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    const v: BoardView = { id: newViewId(), name, type, filter: {}, sort: null };
    onChange([...views, v]);
    onSelect(v.id);
    add.close();
  };
  const target = menuFor && views.find((v) => v.id === menuFor.id);

  return (
    <div className="tabs">
      {views.map((v) => (
        <span key={v.id} className={v.id === active ? 'tab active' : 'tab'}>
          <button className="tab-name" onClick={() => onSelect(v.id)}>{icon(v)} {v.name}</button>
          {v.id === active && (
            <button className="icon-btn tab-menu" title="View options" onClick={(e) => setMenuFor(menuFor ? null : { id: v.id, anchor: e.currentTarget })}>⋯</button>
          )}
        </span>
      ))}
      <button className="tab tab-add" title="Add view" onClick={add.toggle}>+</button>
      {add.anchor && (
        <Popover anchor={add.anchor} onClose={add.close} width={200}>
          <div className="muted small pad">Add a view</div>
          <MenuItem onClick={() => addView('table')}>▦ Table</MenuItem>
          <MenuItem onClick={() => addView('kanban')}>☷ Kanban</MenuItem>
        </Popover>
      )}
      {menuFor && target && (
        <Popover anchor={menuFor.anchor} onClose={() => setMenuFor(null)} width={200}>
          <MenuItem onClick={() => {
            setMenuFor(null);
            const name = prompt('Rename this view', target.name)?.trim();
            if (name) onChange(views.map((v) => (v.id === target.id ? { ...v, name } : v)));
          }}>Rename view</MenuItem>
          <MenuItem onClick={() => {
            setMenuFor(null);
            const copy = { ...target, id: newViewId(), name: `${target.name} copy` };
            const at = views.findIndex((v) => v.id === target.id) + 1;
            onChange([...views.slice(0, at), copy, ...views.slice(at)]);
            onSelect(copy.id);
          }}>Duplicate view</MenuItem>
          {views.length > 1 && <>
            <div className="menu-sep" />
            <MenuItem danger onClick={() => {
              setMenuFor(null);
              if (!confirm(`Delete the view "${target.name}"? The items stay on the board.`)) return;
              const rest = views.filter((v) => v.id !== target.id);
              onChange(rest);
              onSelect(rest[0]!.id);
            }}>Delete view</MenuItem>
          </>}
        </Popover>
      )}
    </div>
  );
}
