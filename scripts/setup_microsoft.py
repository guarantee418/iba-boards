"""One-time Microsoft 365 setup for IBA Boards. Run by Garrett (a tenant admin):

    ~/claude-remote/.venv/bin/python scripts/setup_microsoft.py

1. Gives the "Claude for IBA" admin app the Sites.Manage.All permission, which
   scripts/upload_sharepoint.py needs to create the SharePoint lists.
2. Registers the "IBA Boards" sign-in app (single-page app, this school only)
   with User.Read and Sites.ReadWrite.All, and writes its client id to src/config.json.

Afterwards: sign in again with `~/claude-remote/.venv/bin/python ~/claude-remote/scripts/msgraph.py login`
so the new permission takes effect.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / "claude-remote" / "scripts"))
from msgraph import _load_env, graph  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GRAPH_APP = "00000003-0000-0000-c000-000000000000"
REDIRECTS = ["https://boards.ibakings.org/", "http://localhost:5173/"]

scopes = {s["value"]: s["id"] for s in
          graph("GET", f"/servicePrincipals(appId='{GRAPH_APP}')?$select=oauth2PermissionScopes")["oauth2PermissionScopes"]}

# 1) Claude for IBA gets Sites.Manage.All (delegated: acts only as the signed-in admin).
cid = _load_env()["MS_GRAPH_CLIENT_ID"]
app = graph("GET", f"/applications(appId='{cid}')?$select=id,displayName,requiredResourceAccess")
rra = app["requiredResourceAccess"]
g = next(r for r in rra if r["resourceAppId"] == GRAPH_APP)
if not any(a["id"] == scopes["Sites.Manage.All"] for a in g["resourceAccess"]):
    g["resourceAccess"].append({"id": scopes["Sites.Manage.All"], "type": "Scope"})
    graph("PATCH", f"/applications/{app['id']}", json={"requiredResourceAccess": rra})
    print(f"Added Sites.Manage.All to {app['displayName']}")
else:
    print(f"{app['displayName']} already has Sites.Manage.All")

# 2) The IBA Boards sign-in app.
found = graph("GET", "/applications?$filter=displayName eq 'IBA Boards'&$select=id,appId")["value"]
if found:
    boards = found[0]
    graph("PATCH", f"/applications/{boards['id']}", json={"spa": {"redirectUris": REDIRECTS}})
    print(f"IBA Boards app already registered ({boards['appId']})")
else:
    boards = graph("POST", "/applications", json={
        "displayName": "IBA Boards",
        "signInAudience": "AzureADMyOrg",
        "spa": {"redirectUris": REDIRECTS},
        "requiredResourceAccess": [{"resourceAppId": GRAPH_APP, "resourceAccess": [
            {"id": scopes["User.Read"], "type": "Scope"},
            {"id": scopes["Sites.ReadWrite.All"], "type": "Scope"},
        ]}],
    })
    graph("POST", "/servicePrincipals", json={"appId": boards["appId"]})
    print(f"Registered the IBA Boards app ({boards['appId']})")

cfg_path = ROOT / "src" / "config.json"
cfg = json.loads(cfg_path.read_text())
cfg["clientId"] = boards["appId"]
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
print("Saved the client id to src/config.json")
