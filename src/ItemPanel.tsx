import { useEffect, useState } from 'react';
import { api } from './api';
import { useBoard } from './Board';
import { Cell } from './cells';
import type { Item, Update } from './types';
import { Avatar, EditableText, timeAgo } from './ui';

export function ItemPanel({ item, onClose }: { item: Item; onClose: () => void }) {
  const b = useBoard();
  const d = b.data!;
  const [tab, setTab] = useState<'updates' | 'info'>('updates');
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const cols = d.columns.filter((c) => (item.parent_id ? c.is_sub : !c.is_sub));
  const parent = item.parent_id ? d.items.find((i) => i.id === item.parent_id) : undefined;
  const group = d.groups.find((g) => g.id === (parent ?? item).group_id);

  useEffect(() => {
    setUpdates(null);
    api.get<Update[]>(`/api/items/${item.id}/updates`).then(setUpdates).catch(() => setUpdates([]));
  }, [item.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.popover')) onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const u = await api.post<Update>(`/api/items/${item.id}/updates`, { body: draft });
      setUpdates((list) => [u, ...(list ?? [])]);
      b.bumpUpdates(item.id, 1);
      setDraft('');
    } catch (e: any) { alert(e.message); }
    setPosting(false);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={item.name}>
        <div className="panel-head">
          <button className="icon-btn close" onClick={onClose} title="Close">✕</button>
          <div className="panel-crumb">
            {group && <><span className="dot" style={{ background: group.color }} /> {group.title}</>}
            {parent && <> › {parent.name}</>}
          </div>
          <EditableText className="panel-title" value={item.name} onSave={(v) => v.trim() && b.patchItem(item.id, { name: v.trim() })} />
          <div className="tabs">
            <button className={tab === 'updates' ? 'tab active' : 'tab'} onClick={() => setTab('updates')}>Updates{item.updates ? ` / ${item.updates}` : ''}</button>
            <button className={tab === 'info' ? 'tab active' : 'tab'} onClick={() => setTab('info')}>Info</button>
          </div>
        </div>

        {tab === 'updates' ? (
          <div className="panel-body">
            <div className="composer">
              <textarea className="input" rows={3} placeholder="Write an update…" value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
              <div className="row-end"><button className="btn btn-primary" disabled={!draft.trim() || posting} onClick={post}>Update</button></div>
            </div>
            {updates === null && <div className="muted pad">Loading…</div>}
            {updates?.length === 0 && <div className="empty-updates">No updates yet. Write the first one above. Everyone on the board can see it.</div>}
            {updates?.map((u) => (
              <div key={u.id} className="update">
                <div className="update-head">
                  <Avatar person={{ id: u.author_id, name: u.author_name ?? 'Someone', email: null, color: u.author_color }} size={30} />
                  <b>{u.author_name ?? 'Someone'}</b>
                  <span className="muted small">{timeAgo(u.created_at)}</span>
                </div>
                <div className="update-body">{u.body}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel-body">
            {cols.map((c) => (
              <div key={c.id} className="info-row">
                <div className="info-label">{c.title}</div>
                <div className="info-value cell-wrap">
                  <Cell col={c} value={item.vals[c.id]} people={b.people} onAddPerson={b.onAddPerson}
                    onChange={(v) => b.patchItem(item.id, { vals: { [c.id]: v } })}
                    onSettings={(s) => b.patchColumn(c.id, { settings: s })} />
                </div>
              </div>
            ))}
            <div className="muted small pad">Created {new Date(item.created_at).toLocaleString()} · Last changed {timeAgo(item.updated_at)}</div>
          </div>
        )}
      </aside>
    </>
  );
}
