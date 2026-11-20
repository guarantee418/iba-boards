import { useState } from 'react';
import { useBoard } from './Board';
import type { BoardData, Item } from './types';
import { Avatar, fmtDate } from './ui';

/** Cards in lanes by a status column. Drag a card to another lane to change its status. */
export function Kanban({ data, matches, onOpen }: { data: BoardData; matches: (i: Item) => boolean; onOpen: (id: string) => void }) {
  const b = useBoard();
  const statusCols = data.columns.filter((c) => !c.is_sub && c.type === 'status');
  const [colId, setColId] = useState(statusCols[0]?.id);
  const [over, setOver] = useState<string | null>(null);
  const col = statusCols.find((c) => c.id === colId) ?? statusCols[0];
  if (!col) return <div className="board-empty">Add a Status column to this board to see it as cards.</div>;

  const people = data.columns.filter((c) => !c.is_sub && c.type === 'people');
  const dateCol = data.columns.find((c) => !c.is_sub && c.type === 'date');
  const items = data.items.filter((i) => !i.parent_id && matches(i));
  const lanes = [...(col.settings.labels ?? []).map((l) => ({ key: String(l.id), id: l.id as number | null, title: l.label, color: l.color })),
    { key: 'none', id: null, title: 'No status', color: '#c4c4c4' }];

  return (
    <div className="kanban-wrap">
      {statusCols.length > 1 && (
        <div className="kanban-pick">Cards by
          <select className="input" value={col.id} onChange={(e) => setColId(e.target.value)}>
            {statusCols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
      )}
      <div className="kanban">
        {lanes.map((lane) => {
          const cards = items.filter((i) => (i.vals[col.id] ?? null) === lane.id);
          return (
            <div key={lane.key} className={`lane ${over === lane.key ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(lane.key); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/item'); if (id) b.patchItem(id, { vals: { [col.id]: lane.id } }); }}>
              <div className="lane-head" style={{ background: lane.color }}>{lane.title} <span>{cards.length}</span></div>
              <div className="lane-body">
                {cards.map((i) => {
                  const group = data.groups.find((g) => g.id === i.group_id);
                  const who = people.flatMap((c) => i.vals[c.id] ?? []).map((id: string) => b.people.find((p) => p.id === id)).filter(Boolean);
                  return (
                    <div key={i.id} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/item', i.id)} onClick={() => onOpen(i.id)}>
                      <div className="card-title">{i.name}</div>
                      <div className="card-meta">
                        {group && <span className="card-group" style={{ color: group.color }}>{group.title}</span>}
                        {dateCol && i.vals[dateCol.id] && <span className="muted small">📅 {fmtDate(i.vals[dateCol.id])}</span>}
                        <span className="card-people">{who.map((p: any) => <Avatar key={p.id} person={p} size={22} />)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
