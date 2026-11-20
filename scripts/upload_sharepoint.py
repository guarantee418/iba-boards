"""Creates the IBA Boards lists in SharePoint and loads seed/rows.json into them.

    ~/claude-remote/.venv/bin/python scripts/upload_sharepoint.py            # create lists + load rows
    ~/claude-remote/.venv/bin/python scripts/upload_sharepoint.py --schema   # only create/check the lists

Signs in through the "Claude for IBA" Graph app (~/claude-remote/scripts/msgraph.py).
Rows are matched on their Key column, so running it again updates rows in place
(and overwrites edits made to imported items in the app).
"""
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path.home() / "claude-remote" / "scripts"))
from msgraph import get_token  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "src" / "config.json").read_text())
SITE = CONFIG["siteId"]
GRAPH = "https://graph.microsoft.com/v1.0"

TEXT = {"text": {}}
LONG = {"text": {"allowMultipleLines": True, "textType": "plain", "linesForEditing": 6}}
NUM = {"number": {}}
# list name -> {column: (definition, indexed)}. Every list also has Title.
SCHEMA = {
    "People": {"Key": (TEXT, True), "Email": (TEXT, True), "MondayEmail": (TEXT, False), "Color": (TEXT, False)},
    "Workspaces": {"Key": (TEXT, True), "Position": (NUM, False)},
    "Folders": {"Key": (TEXT, True), "WorkspaceKey": (TEXT, False), "Position": (NUM, False)},
    "Boards": {"Key": (TEXT, True), "WorkspaceKey": (TEXT, False), "FolderKey": (TEXT, False), "Description": (LONG, False),
               "ItemTerm": (TEXT, False), "Position": (NUM, False), "MondayId": (TEXT, False)},
    "BoardGroups": {"Key": (TEXT, True), "BoardKey": (TEXT, True), "Color": (TEXT, False), "Position": (NUM, False),
                    "Collapsed": (NUM, False)},
    "BoardColumns": {"Key": (TEXT, True), "BoardKey": (TEXT, True), "IsSub": (NUM, False), "ColType": (TEXT, False),
                     "Settings": (LONG, False), "Width": (NUM, False), "Position": (NUM, False)},
    "Items": {"Key": (TEXT, True), "BoardKey": (TEXT, True), "GroupKey": (TEXT, False), "ParentKey": (TEXT, False),
              "Vals": (LONG, False), "Position": (NUM, False), "CreatedBy": (TEXT, False), "CreatedAt": (TEXT, False),
              "UpdatedAt": (TEXT, False)},
    "Updates": {"Key": (TEXT, True), "ItemKey": (TEXT, True), "BoardKey": (TEXT, True), "AuthorKey": (TEXT, False),
                "Body": (LONG, False), "CreatedAt": (TEXT, False)},
}

session = requests.Session()


def call(method, path, **kw):
    url = path if path.startswith("http") else GRAPH + path
    for attempt in range(6):
        r = session.request(method, url, headers={"Authorization": f"Bearer {get_token()}"}, **kw)
        if r.status_code in (429, 503, 504):
            time.sleep(int(r.headers.get("Retry-After", 5 * (attempt + 1))))
            continue
        if not r.ok:
            sys.exit(f"{method} {path}: {r.status_code} {r.text[:500]}")
        return r.json() if r.content else None
    sys.exit(f"{method} {path}: gave up after retries")


def all_pages(path):
    out, url = [], path
    while url:
        d = call("GET", url)
        out += d.get("value", [])
        url = d.get("@odata.nextLink")
    return out


def ensure_lists():
    lists = {l["displayName"]: l["id"] for l in all_pages(f"/sites/{SITE}/lists?$select=id,displayName")}
    for name, cols in SCHEMA.items():
        if name not in lists:
            body = {"displayName": name, "list": {"template": "genericList"},
                    "columns": [{"name": c, **d, "indexed": idx} for c, (d, idx) in cols.items()]}
            lists[name] = call("POST", f"/sites/{SITE}/lists", json=body)["id"]
            print(f"created list {name}")
        else:
            have = {c["name"] for c in all_pages(f"/sites/{SITE}/lists/{lists[name]}/columns?$select=name")}
            for c, (d, idx) in cols.items():
                if c not in have:
                    call("POST", f"/sites/{SITE}/lists/{lists[name]}/columns", json={"name": c, **d, "indexed": idx})
                    print(f"added column {name}.{c}")
    return lists


def match_people(rows):
    """Point imported people at their school Microsoft accounts (by display name)."""
    users = all_pages("/users?$select=displayName,mail,userPrincipalName,accountEnabled&$top=999")
    by_name = {}
    for u in users:
        if u.get("accountEnabled") and "#EXT#" not in u["userPrincipalName"]:
            by_name.setdefault(u["displayName"].strip().lower(), u)
    for p in rows:
        u = by_name.get(p["Title"].strip().lower())
        if u:
            p["Email"] = (u.get("mail") or u["userPrincipalName"]).lower()
        print(f"  person {p['Title']}: {p['Email'] or 'no school account found'}")


def upload(list_id, name, rows):
    existing = {i["fields"]["Key"]: i["id"] for i in all_pages(
        f"/sites/{SITE}/lists/{list_id}/items?$expand=fields($select=Key)&$top=999") if i["fields"].get("Key")}
    reqs = []
    for r in rows:
        fields = {k: v for k, v in r.items() if v is not None}
        if r["Key"] in existing:
            reqs.append({"method": "PATCH", "url": f"/sites/{SITE}/lists/{list_id}/items/{existing[r['Key']]}/fields", "body": fields})
        else:
            reqs.append({"method": "POST", "url": f"/sites/{SITE}/lists/{list_id}/items", "body": {"fields": fields}})
    done = 0
    for i in range(0, len(reqs), 20):
        chunk = reqs[i:i + 20]
        pending = [{"id": str(n), **q, "headers": {"Content-Type": "application/json"}} for n, q in enumerate(chunk)]
        for attempt in range(6):
            res = call("POST", "/$batch", json={"requests": pending})["responses"]
            retry = [r for r in res if r["status"] in (429, 503, 504)]
            failed = [r for r in res if r["status"] >= 400 and r["status"] not in (429, 503, 504)]
            if failed:
                sys.exit(f"{name}: {failed[0]['status']} {json.dumps(failed[0].get('body'))[:400]}")
            done += len(res) - len(retry)
            if not retry:
                break
            ids = {r["id"] for r in retry}
            pending = [p for p in pending if p["id"] in ids]
            time.sleep(5 * (attempt + 1))
        else:
            sys.exit(f"{name}: throttled too long, stopped")
        print(f"\r  {name}: {done}/{len(reqs)}", end="", flush=True)
    print(f"\r  {name}: {done}/{len(reqs)} ({sum(1 for r in reqs if r['method'] == 'POST')} new)")


if __name__ == "__main__":
    lists = ensure_lists()
    if "--schema" in sys.argv:
        sys.exit(0)
    rows = json.loads((ROOT / "seed" / "rows.json").read_text())
    match_people(rows["People"])
    for name in SCHEMA:
        upload(lists[name], name, rows[name])
    print("Done.")
