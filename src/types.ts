export type Person = { id: string; name: string; email: string | null; color: string | null };
export type Label = { id: number; label: string; color?: string; done?: boolean };
export type ColumnType = 'text' | 'long_text' | 'status' | 'people' | 'date' | 'dropdown' | 'number' | 'checkbox';
export type Column = {
  id: string; board_id: string; is_sub: number; title: string; type: ColumnType;
  settings: { labels?: Label[] }; width: number | null; position: number;
};
export type Group = { id: string; board_id: string; title: string; color: string; position: number; collapsed: number };
export type Item = {
  id: string; board_id: string; group_id: string | null; parent_id: string | null; name: string;
  vals: Record<string, any>; position: number; updates: number; created_at: string; updated_at: string;
};
export type BoardMeta = {
  id: string; name: string; workspace_id: string; folder_id: string | null; position: number;
  description?: string | null; item_term?: string;
};
export type BoardData = { board: BoardMeta; groups: Group[]; columns: Column[]; items: Item[] };
export type Workspace = { id: string; name: string };
export type Folder = { id: string; workspace_id: string; name: string };
export type Update = { id: string; item_id: string; author_id: string; author_name: string; author_color: string | null; body: string; created_at: string };

export const COLUMN_TYPES: { type: ColumnType; label: string; icon: string }[] = [
  { type: 'status', label: 'Status', icon: '◉' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'long_text', label: 'Long text', icon: '¶' },
  { type: 'people', label: 'People', icon: '👤' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'dropdown', label: 'Dropdown', icon: '▾' },
  { type: 'number', label: 'Numbers', icon: '#' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
];

export const LABEL_COLORS = ['#00c875', '#fdab3d', '#df2f4a', '#579bfc', '#a25ddc', '#ff642e', '#037f4c', '#ffcb00', '#ff5ac4', '#757575', '#225091', '#9aadbd'];
export const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#037f4c', '#ff642e', '#66ccff', '#784bd1', '#9d50dd'];
