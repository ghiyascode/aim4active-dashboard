# AIM4Active Dashboard

A read-only view over the message generation pipeline: what was produced, which
messages passed review, why the rest were rejected, and what reached participants.

Two routes:

| Path | Contents | Access |
|---|---|---|
| `/` | Landing page. No study data. | Public |
| `/admin` | The dashboard | **Restrict at the web server** |
| `/admin/data/snapshot.json` | The data the dashboard reads | Covered by the same rule |

## Running locally

```bash
npm install
npm run snapshot     # read a database into public/admin/data/snapshot.json
npm start            # http://localhost:3000
```

`npm run snapshot` picks the newest `.db` in the project root. To choose one:

```bash
A4A_DB=/path/to/aim4active.db npm run snapshot
```

It opens the database read-only and writes one file. Nothing else is modified.

### Optional inputs

The dashboard works from a database alone. These add detail if present:

| Variable | Default | Adds |
|---|---|---|
| `A4A_DB` | newest `*.db` in the project root | the messages |
| `A4A_AGENTIC` | `msg_gen/agentic` | older JSONL-based runs |
| `A4A_PROCESSED` | `msg_gen/data/processed` | overrides the bundled BCT catalogue |
| `A4A_ROOT` | project root | where the above are looked up |

`reference/selected_bcts.csv` ships with the repo so BCT names resolve without a
pipeline checkout. It is ontology reference data and contains nothing about
participants.

## Deploying

**The data is served as a static file, so the web server is what protects it.**
A login implemented in React would not help: `/admin/data/snapshot.json` is
fetched directly and never passes through application code. Everything under
`/admin` must be restricted by the server.

```bash
npm ci
A4A_DB=/secure/path/aim4active.db npm run snapshot
npm run build           # produces build/
```

Serve `build/` with `/admin` protected. With nginx and basic auth:

```nginx
server {
    root /var/www/aim4active-dashboard/build;

    # Landing page, public.
    location / {
        try_files $uri /index.html;
    }

    # Dashboard and its data. One rule covers both.
    location /admin {
        auth_basic           "AIM4Active study team";
        auth_basic_user_file /etc/nginx/.htpasswd-aim4active;
        try_files $uri /index.html;
    }
}
```

Create the password file with `htpasswd -c /etc/nginx/.htpasswd-aim4active <user>`.
Substitute institutional SSO for `auth_basic` if that is available; the
requirement is only that `/admin` is not anonymous.

Serve over HTTPS. Basic auth sends credentials in clear text otherwise.

### Getting the database onto the server

Copy it out of band — `scp`, or whatever your institution permits. It must never
go through the repository. `.gitignore` blocks `*.db` and the generated snapshot,
but the repository is public, so treat that as a backstop rather than the control.

## Layout

```
scripts/buildSnapshot.mjs   snapshot builder (Node, built-in node:sqlite)
reference/                  BCT catalogue shipped with the repo
src/
  App.js                    the two routes
  Landing.js                public landing page
  dashboard/                the dashboard; see dashboard/README.md
public/admin/data/          where the snapshot is written (ignored by git)
```

No third-party charting or data libraries.

## Tests

```bash
npm test -- --testPathPattern=dashboard --watchAll=false
```

Twelve smoke tests render every view against whatever snapshot is present, and
skip the assertions a given snapshot cannot support. They are skipped entirely
if no snapshot has been built.

## Data notes

- **Participants are identified by UID.** Names are not collected and the
  schema has no column for them.
- **One message goes to one participant.** Anything showing otherwise is a bug.
- **Participant days use the run's simulated clock** (`PSEUDO_TIME`), which is
  the clock the Fitbit series was recorded against, so they can predate the run.
- **Panels tagged `mock` are fabricated.** That happens only when a snapshot has
  no participant activity; supply a database with
  `PERSONALIZATION_DAILY_ACTIVITY` rows and those panels become real on their own.
