import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Person } from './types';

/** A floating panel anchored to an element. Closes on outside click or Escape. */
export function Popover({ anchor, onClose, children, width = 240, align = 'left' }: {
  anchor: HTMLElement; onClose: () => void; children: ReactNode; width?: number; align?: 'left' | 'center' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 200;
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
      let left = align === 'center' ? r.left + r.width / 2 - width / 2 : align === 'right' ? r.right - width : r.left;
      left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
      setPos({ top, left });
    };
    place();
    const obs = new ResizeObserver(place);
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [anchor, width, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      // Clicks inside another popover (a nested menu) don't close this one.
      if ((t as Element).closest?.('.popover')) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor]);

  return createPortal(
    <div ref={ref} className="popover" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}>{children}</div>,
    document.body,
  );
}

/** Small hook for "click to open a popover on this element". */
export function useAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = (e: ReactMouseEvent<HTMLElement>) => { const el = e.currentTarget; setAnchor((a) => (a ? null : el)); };
  return { anchor, toggle, close: () => setAnchor(null) };
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export function Avatar({ person, size = 26 }: { person: Person | undefined; size?: number }) {
  if (!person) return null;
  return (
    <span className="avatar" title={person.name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: person.color ?? '#4f7cff' }}>
      {initials(person.name)}
    </span>
  );
}

/** Text that turns into an input when clicked. Enter or blur saves, Escape cancels. */
export function EditableText({ value, onSave, className, placeholder, type = 'text', startEditing = false }: {
  value: string; onSave: (v: string) => void; className?: string; placeholder?: string; type?: 'text' | 'number'; startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  if (!editing)
    return (
      <span className={`editable ${className ?? ''} ${value ? '' : 'is-empty'}`} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
        {value || placeholder || ' '}
      </span>
    );
  const commit = () => { setEditing(false); if (draft !== value) onSave(draft); };
  return (
    <input
      className={`editable-input ${className ?? ''}`} autoFocus type={type} value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
    />
  );
}

export function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>{children}</button>;
}

export const fmtDate = (v: string) => {
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) return v;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
