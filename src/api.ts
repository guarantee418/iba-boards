// The components talk in simple REST-style paths; this maps each one to the
// SharePoint data layer in sharepoint.ts.
import { demo } from './demo';
import { store as sharepoint } from './sharepoint';

// ?demo on this Mac (npm run dev) previews the design with made-up data.
const store = import.meta.env.DEV && new URLSearchParams(location.search).has('demo') ? demo : sharepoint;

type Handler = (m: RegExpMatchArray, body: any) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/bootstrap$/, () => store.bootstrap()],
  ['POST', /^\/api\/people$/, (_, b) => store.addPerson(b)],
  ['GET', /^\/api\/boards\/([^/]+)$/, (m) => store.getBoard(m[1])],
  ['POST', /^\/api\/boards$/, (_, b) => store.createBoard(b)],
  ['PATCH', /^\/api\/boards\/([^/]+)$/, (m, b) => store.patchBoard(m[1], b)],
  ['DELETE', /^\/api\/boards\/([^/]+)$/, (m) => store.deleteBoard(m[1])],
  ['POST', /^\/api\/boards\/([^/]+)\/groups$/, (m, b) => store.createGroup(m[1], b)],
  ['PATCH', /^\/api\/groups\/([^/]+)$/, (m, b) => store.patchGroup(m[1], b)],
  ['DELETE', /^\/api\/groups\/([^/]+)$/, (m) => store.deleteGroup(m[1])],
  ['POST', /^\/api\/boards\/([^/]+)\/columns$/, (m, b) => store.createColumn(m[1], b)],
  ['PATCH', /^\/api\/columns\/([^/]+)$/, (m, b) => store.patchColumn(m[1], b)],
  ['DELETE', /^\/api\/columns\/([^/]+)$/, (m) => store.deleteColumn(m[1])],
  ['POST', /^\/api\/boards\/([^/]+)\/items$/, (m, b) => store.createItem(m[1], b)],
  ['PATCH', /^\/api\/items\/([^/]+)$/, (m, b) => store.patchItem(m[1], b)],
  ['DELETE', /^\/api\/items\/([^/]+)$/, (m) => store.deleteItem(m[1])],
  ['GET', /^\/api\/items\/([^/]+)\/updates$/, (m) => store.getUpdates(m[1])],
  ['POST', /^\/api\/items\/([^/]+)\/updates$/, (m, b) => store.createUpdate(m[1], b)],
];

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  for (const [m, re, fn] of routes) {
    const match = m === method ? url.match(re) : null;
    if (match) return (await fn(match, body)) as T;
  }
  throw new Error(`Unknown request ${method} ${url}`);
}

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body: unknown) => call<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => call<T>('PATCH', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};
