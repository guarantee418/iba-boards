import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { Board } from './Board';
import { signOut } from './sharepoint';
import type { BoardMeta, Folder, Person, Workspace } from './types';
import { Avatar } from './ui';

type Boot = { workspaces: Workspace[]; folders: Folder[]; boards: BoardMeta[]; people: Person[]; me: Person };

const boardFromHash = () => location.hash.match(/^#\/board\/(.+)$/)?.[1] ?? null;

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(boardFromHash);
  const [filter, setFilter] = useState('');
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());

  const load = () => api.get<Boot>('/api/bootstrap').then(setBoot).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const on = () => setBoardId(boardFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (boot && !boardId && boot.boards[0]) location.hash = `#/board/${boot.boards[0].id}`;
  }, [boot, boardId]);

  if (error) return (
    <Splash>
      <p>Couldn't open IBA Boards: {error}</p>
      <button className="btn" onClick={() => signOut()}>Sign in as someone else</button>
    </Splash>
  );
  if (!boot) return <Splash><p>Signing you in with your school Microsoft account…</p></Splash>;

  const addPerson = async (name: string, email: string) => {
    const p = await api.post<Person>('/api/people', { name, email });
    setBoot((b) => (b ? { ...b, people: [...b.people, p].sort((a, z) => a.name.localeCompare(z.name)) } : b));
    return p;
  };
  const newBoard = async (workspace_id: string, folder_id: string | null) => {
    const name = prompt('Name the new board');
    if (!name?.trim()) return;
    const { id } = await api.post<{ id: string }>('/api/boards', { name: name.trim(), workspace_id, folder_id });
    await load();
    location.hash = `#/board/${id}`;
  };
  const toggleFolder = (id: string) => setClosedFolders((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const q = filter.trim().toLowerCase();
  const boards = boot.boards.filter((b) => !q || b.name.toLowerCase().includes(q));
  const boardLink = (b: BoardMeta) => (
    <a key={b.id} href={`#/board/${b.id}`} className={`nav-board ${b.id === boardId ? 'active' : ''}`}>▦ {b.name}</a>
  );

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <img src="/kings-crest.png" alt="IBA Kings crest" />
          <span className="brand-text">
            <span className="brand-name">IBA <b>Boards</b></span>
            <span className="brand-sub">Kings · School Office</span>
          </span>
        </div>
        <input className="input nav-search" placeholder="Find a board" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="nav-scroll">
          {boot.workspaces.map((w) => {
            const loose = boards.filter((b) => b.workspace_id === w.id && !b.folder_id);
            const folders = boot.folders.filter((f) => f.workspace_id === w.id);
            return (
              <div key={w.id} className="nav-ws">
                <div className="nav-ws-head">
                  <span className="ws-icon">{w.name[0]}</span> {w.name}
                  <button className="icon-btn" title="New board" onClick={() => newBoard(w.id, null)}>+</button>
                </div>
                {folders.map((f) => {
                  const inside = boards.filter((b) => b.folder_id === f.id);
                  if (q && !inside.length) return null;
                  const open = !closedFolders.has(f.id) || !!q;
                  return (
                    <div key={f.id} className="nav-folder">
                      <button className="nav-folder-head" onClick={() => toggleFolder(f.id)}>
                        <span className={`chev-sm ${open ? 'open' : ''}`}>▸</span> 📁 {f.name}
                      </button>
                      {open && <div className="nav-folder-body">{inside.map(boardLink)}
                        <button className="nav-add" onClick={() => newBoard(w.id, f.id)}>+ New board</button></div>}
                    </div>
                  );
                })}
                {loose.map(boardLink)}
              </div>
            );
          })}
        </div>
        <div className="me">
          <Avatar person={boot.me} size={28} /> <span>{boot.me.name}</span>
          <button className="btn sign-out" onClick={() => signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        {boardId ? (
          <Board key={boardId} boardId={boardId} people={boot.people} onAddPerson={addPerson}
            onRenamed={(name) => setBoot((b) => (b ? { ...b, boards: b.boards.map((x) => (x.id === boardId ? { ...x, name } : x)) } : b))}
            onDeleted={async () => { location.hash = ''; setBoardId(null); await load(); }} />
        ) : (
          <div className="board-empty">No boards yet. Use the + next to a workspace to make one.</div>
        )}
      </main>
    </div>
  );
}

/** Full-screen Kings welcome shown while signing in, or when sign-in fails. */
function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <img src="/kings-crest.png" alt="IBA Kings crest" />
      <h1>IBA <b>Boards</b></h1>
      {children}
    </div>
  );
}
