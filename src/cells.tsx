import { useState } from 'react';
import type { Column, Label, Person } from './types';
import { LABEL_COLORS } from './types';
import { Avatar, EditableText, Popover, fmtDate, useAnchor } from './ui';

export type CellProps = {
  col: Column;
  value: any;
  onChange: (v: any) => void;
  onSettings: (s: Column['settings']) => void;
  people: Person[];
  onAddPerson: (name: string, email: string) => Promise<Person>;
};

export function Cell(p: CellProps) {
  switch (p.col.type) {
    case 'status': return <StatusCell {...p} />;
    case 'people': return <PeopleCell {...p} />;
    case 'date': return <DateCell {...p} />;
    case 'dropdown': return <DropdownCell {...p} />;
    case 'long_text': return <LongTextCell {...p} />;
    case 'number': return <div className="cell cell-number"><EditableText type="number" value={p.value ?? ''} onSave={(v) => p.onChange(v === '' ? null : Number(v))} /></div>;
    case 'checkbox': return <div className="cell cell-center"><input type="checkbox" checked={!!p.value} onChange={(e) => p.onChange(e.target.checked || null)} /></div>;
    default: return <div className="cell cell-text"><EditableText value={p.value ?? ''} onSave={(v) => p.onChange(v)} /></div>;
  }
}

// ---------- Status ----------
function StatusCell({ col, value, onChange, onSettings }: CellProps) {
  const { anchor, toggle, close } = useAnchor();
  const [editing, setEditing] = useState(false);
  const labels = col.settings.labels ?? [];
  const cur = labels.find((l) => l.id === value);
  const done = () => { close(); setEditing(false); };
  return (
    <>
      <button className={`cell cell-status ${cur ? '' : 'is-empty'}`} style={cur ? { background: cur.color } : undefined} onClick={toggle}>
        <span className="cell-status-text">{cur?.label ?? ''}</span>
        <span className="cell-status-fold" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={done} width={editing ? 280 : 210} align="center">
          {editing ? (
            <LabelEditor labels={labels} withColors onSave={(next) => { onSettings({ ...col.settings, labels: next }); setEditing(false); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="status-menu">
              {labels.map((l) => (
                <button key={l.id} className="status-option" style={{ background: l.color }} onClick={() => { onChange(l.id); done(); }}>{l.label}</button>
              ))}
              <button className="status-option is-empty" onClick={() => { onChange(null); done(); }}>&nbsp;</button>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => setEditing(true)}>✎ Edit labels</button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

export function LabelEditor({ labels, withColors, onSave, onCancel }: {
  labels: Label[]; withColors?: boolean; onSave: (l: Label[]) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Label[]>(labels);
  const set = (i: number, patch: Partial<Label>) => setDraft((d) => d.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const nextColor = (c?: string) => LABEL_COLORS[(LABEL_COLORS.indexOf(c ?? '') + 1) % LABEL_COLORS.length];
  return (
    <div className="label-editor">
      {draft.map((l, i) => (
        <div key={l.id} className="label-row">
          {withColors && <button className="swatch" title="Change color" style={{ background: l.color }} onClick={() => set(i, { color: nextColor(l.color) })} />}
          <input value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          {withColors && (
            <label className="label-done" title="Counts as done">
              <input type="checkbox" checked={!!l.done} onChange={(e) => set(i, { done: e.target.checked })} /> done
            </label>
          )}
          <button className="icon-btn" title="Remove label" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="menu-item" onClick={() => setDraft((d) => [...d, {
        id: Math.max(-1, ...d.map((l) => l.id)) + 1, label: 'New label',
        ...(withColors ? { color: LABEL_COLORS[d.length % LABEL_COLORS.length], done: false } : {}),
      }])}>+ New label</button>
      <div className="row-end">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(draft.filter((l) => l.label.trim()))}>Apply</button>
      </div>
    </div>
  );
}

// ---------- People ----------
function PeopleCell({ value, onChange, people, onAddPerson }: CellProps) {
  const { anchor, toggle, close } = useAnchor();
  const ids: string[] = Array.isArray(value) ? value : [];
  const chosen = ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[];
  return (
    <>
      <button className="cell cell-people" onClick={toggle}>
        {chosen.length === 0 ? <span className="avatar avatar-empty">+</span> : (
          <span className="avatar-stack">
            {chosen.slice(0, 3).map((p) => <Avatar key={p.id} person={p} />)}
            {chosen.length > 3 && <span className="avatar avatar-more">+{chosen.length - 3}</span>}
          </span>
        )}
      </button>
      {anchor && <Popover anchor={anchor} onClose={close} width={280} align="center">
        <PeoplePicker ids={ids} people={people} onChange={onChange} onAddPerson={onAddPerson} />
      </Popover>}
    </>
  );
}

export function PeoplePicker({ ids, people, onChange, onAddPerson }: {
  ids: string[]; people: Person[]; onChange: (v: string[]) => void; onAddPerson: CellProps['onAddPerson'];
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const chosen = ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[];
  const rest = people.filter((p) => !ids.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="people-picker">
      {chosen.length > 0 && (
        <div className="chips">
          {chosen.map((p) => (
            <span key={p.id} className="chip"><Avatar person={p} size={20} /> {p.name}
              <button className="icon-btn" onClick={() => onChange(ids.filter((i) => i !== p.id))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <input className="input" autoFocus placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-list">
        {rest.map((p) => (
          <button key={p.id} className="menu-item" onClick={() => onChange([...ids, p.id])}><Avatar person={p} size={22} /> {p.name}</button>
        ))}
        {rest.length === 0 && !adding && <div className="muted small pad">No one else matches.</div>}
      </div>
      <div className="menu-sep" />
      {adding ? (
        <form className="add-person" onSubmit={async (e) => {
          e.preventDefault();
          if (!q.trim()) return;
          const p = await onAddPerson(q.trim(), email.trim());
          onChange([...ids, p.id]); setAdding(false); setQ(''); setEmail('');
        }}>
          <div className="muted small">Name: <b>{q || '(type it in the search box)'}</b></div>
          <input className="input" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!q.trim()}>Add person</button>
        </form>
      ) : (
        <button className="menu-item" onClick={() => setAdding(true)}>+ Add someone new</button>
      )}
    </div>
  );
}

// ---------- Date ----------
function DateCell({ value, onChange }: CellProps) {
  const { anchor, toggle, close } = useAnchor();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (
    <>
      <button className="cell cell-date" onClick={toggle}>{value ? fmtDate(value) : <span className="cell-hint">📅</span>}</button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={230} align="center">
          <div className="date-pop">
            <input className="input" type="date" autoFocus value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
            <div className="row-end">
              <button className="btn" onClick={() => { onChange(iso); close(); }}>Today</button>
              {value && <button className="btn" onClick={() => { onChange(null); close(); }}>Clear</button>}
              <button className="btn btn-primary" onClick={close}>Done</button>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

// ---------- Dropdown ----------
function DropdownCell({ col, value, onChange, onSettings }: CellProps) {
  const { anchor, toggle, close } = useAnchor();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const labels = col.settings.labels ?? [];
  const ids: number[] = Array.isArray(value) ? value : [];
  const chosen = ids.map((id) => labels.find((l) => l.id === id)).filter(Boolean) as Label[];
  const options = labels.filter((l) => l.label.toLowerCase().includes(q.toLowerCase()));
  const exact = labels.some((l) => l.label.toLowerCase() === q.trim().toLowerCase());
  return (
    <>
      <button className="cell cell-dropdown" onClick={toggle}>
        {chosen.map((l) => <span key={l.id} className="tag">{l.label}</span>)}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => { close(); setEditing(false); }} width={250} align="center">
          {editing ? (
            <LabelEditor labels={labels} onSave={(next) => { onSettings({ ...col.settings, labels: next }); setEditing(false); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="dropdown-pop">
              <input className="input" autoFocus placeholder="Search or add an option" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !q.trim() || exact) return;
                  const id = Math.max(0, ...labels.map((l) => l.id)) + 1;
                  onSettings({ ...col.settings, labels: [...labels, { id, label: q.trim() }] });
                  onChange([...ids, id]); setQ('');
                }} />
              <div className="picker-list">
                {options.map((l) => (
                  <label key={l.id} className="menu-item">
                    <input type="checkbox" checked={ids.includes(l.id)}
                      onChange={(e) => onChange(e.target.checked ? [...ids, l.id] : ids.filter((i) => i !== l.id))} />
                    {l.label}
                  </label>
                ))}
                {q.trim() && !exact && <div className="muted small pad">Press Enter to add "{q.trim()}"</div>}
              </div>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => setEditing(true)}>✎ Edit options</button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

// ---------- Long text ----------
function LongTextCell({ value, onChange }: CellProps) {
  const { anchor, toggle, close } = useAnchor();
  const [draft, setDraft] = useState<string>(value ?? '');
  const finish = () => { if (draft !== (value ?? '')) onChange(draft); close(); };
  return (
    <>
      <button className="cell cell-longtext" onClick={(e) => { setDraft(value ?? ''); toggle(e); }} title={value ?? ''}>
        {value || ''}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={finish} width={360} align="center">
          <div className="longtext-pop">
            <textarea className="input" autoFocus rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="row-end"><button className="btn btn-primary" onClick={finish}>Save</button></div>
          </div>
        </Popover>
      )}
    </>
  );
}
