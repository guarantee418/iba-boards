# IBA Boards

The school office's own work-board app, built to replace monday.com for IBA staff.
It keeps the way Mrs. Mora already works: boards in folders, colored groups,
status labels, people, dates, dropdowns, subitems, comments ("updates") and a
Kanban view.

- **App:** https://guarantee418.github.io/iba-boards/ (GitHub Pages, published by
  `.github/workflows/pages.yml` on every push to `main`).
- **Sign-in:** school Microsoft 365 accounts (the "IBA Boards" app registration,
  this tenant only).
- **Data:** SharePoint lists on the private site
  https://ibaministries.sharepoint.com/sites/ibaboards, owned by the "IBA Boards"
  Microsoft 365 group. Only members of that group can read or change anything.
  This repo holds code only, never data.

No servers and nothing to pay for: GitHub Pages and the school's Microsoft 365 A1 plan.

## Who can use it

Add someone to the **IBA Boards** group (Microsoft 365 admin center → Teams & groups,
or Outlook/SharePoint group settings). People who aren't members can sign in but see
"You don't have access".

## Run it on this Mac

```bash
npm install
npm run dev     # http://localhost:5173/iba-boards/  (same SharePoint data as the live app)
```

## Bringing boards over from monday

```bash
npm run monday:export   # every IBA workspace board -> data/monday/*.json (needs MONDAY_API_TOKEN in ~/claude-remote/env/.env)
npm run monday:rows     # -> seed/rows.json
npm run upload          # create/check the SharePoint lists and load the rows
```

`data/monday/` and `seed/` hold student and family records (balances, allergies,
discipline), so they are gitignored and stay on this Mac. Rows are matched on their
Key, so uploading again overwrites imported items with monday's copy: do the final
upload right before switching over, not after staff start editing here.

## One-time Microsoft setup (done once by an admin)

`scripts/setup_microsoft.py` registers the IBA Boards sign-in app and gives the
"Claude for IBA" admin app permission to create the SharePoint lists. The first time
an admin signs in to the app, tick **Consent on behalf of your organization** so staff
aren't asked.

## How the data is stored

| SharePoint list | What it holds |
| --- | --- |
| Workspaces, Folders, Boards | The sidebar |
| BoardGroups, BoardColumns | Each board's groups and columns (labels as JSON in `Settings`) |
| Items | Items and subitems; cell values as JSON in `Vals`, keyed by column |
| Updates | Comments on items |
| People | Names, emails and avatar colors |

## Not built yet

- Forms (the website request boards), automations and notifications
- Calendar view, file attachments, docs on items, drag-to-reorder rows
- Activity log, live updates when two people edit the same board at once
- Switching the Gradelink sync over from monday
