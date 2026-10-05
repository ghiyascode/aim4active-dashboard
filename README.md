# AIM4Active Dashboard

A read-only window onto the AIM4Active message pipeline.

AIM4Active is a research system that writes personalised motivational messages for
cancer survivors, reviews each one against behavioural science criteria, and sends
those that pass. Everything it produced landed in a SQLite database that nobody
could inspect without writing a query. This dashboard makes it legible: every
message generated, whether it passed review, which check rejected it and why, and
which behaviour change technique it was trying to deliver.

```bash
npm install
npm run snapshot     # read a database into public/admin/data/snapshot.json
npm start            # http://localhost:3000
```

No backend is needed — not the API gateway, not a model server, not Twilio. The
dashboard reads one file.

## What it shows

| View | Answers |
|---|---|
| **Overview** | How much was produced, how much survived, where it went |
| **Messages** | Find any message by content; open it for the gate-by-gate verdict, generation settings, and recipient |
| **Matrix** | Techniques against runs, checks, prompts, model configs or participants — measured by volume or quality |
| **Participants** | Activity against the days a message arrived, grouped by zip |
| **Pipeline** | Yield per run, which check rejects most, and the message quality breakdown |
| **Raw data** | The flat table behind everything, sortable and exportable to CSV |

## How it works

A build step reads the pipeline's output and writes a single JSON file. The browser
fetches it once, normalises it, and six views read the same filtered slice. There
is no live query, which is why it runs with nothing else up; the cost is that it
shows a point in time until the snapshot is rebuilt.

```
database ──> npm run snapshot ──> snapshot.json ──> browser
```

### Message sources

Messages can arrive from two places, carrying different evidence:

| Source | Has | Lacks |
|---|---|---|
| Generation database | BCT, prompt, writer config, judge scores, and a verdict in the current schema | older rows predate the verdict columns |
| Agentic run folders | accept/reject with a per-check reason | judge scores; historical only |

They are merged on the fields they share. Every message carries
`status: "accepted" | "rejected" | "generated"`, where `generated` means never
adjudicated.

### Quality signals

Four, with very different coverage, which is why every average in the interface is
shown with the number of messages behind it:

| Signal | What it is |
|---|---|
| Sentiment | VADER compound score, −1 to 1. Computed for every message by the pipeline. |
| Reading ease | Flesch reading ease. Higher is easier. |
| Judge score | 1–5 on seven dimensions by an LLM judge. Delivered messages only. |
| Reading grade | Flesch-Kincaid grade. Same coverage as the judge scores. |

## Routes

| Path | Contents | Access |
|---|---|---|
| `/` | Landing page. No study data. | Public |
| `/terms`, `/privacy` | Policy pages | Public |
| `/admin` | The dashboard | Passphrase |
| `/admin/data/snapshot.json` | The data, encrypted when built with a passphrase | Useless without it |

## Configuration

The dashboard works from a database alone. These add detail if present:

| Variable | Default | Adds |
|---|---|---|
| `A4A_DB` | newest `*.db` in the project root | the messages |
| `A4A_AGENTIC` | `msg_gen/agentic` | older folder-based runs |
| `A4A_PROCESSED` | `msg_gen/data/processed` | overrides the bundled BCT catalogue |
| `A4A_ROOT` | project root | where the above are looked up |
| `A4A_PASSPHRASE` | asked for at the prompt | encrypts the published data file |

`npm run snapshot` opens the database read-only and writes one file. Nothing else
is modified. `reference/selected_bcts.csv` ships with the repo so technique names
resolve without a pipeline checkout; it is ontology reference data and contains
nothing about participants.

## Layout

```
scripts/buildSnapshot.mjs   snapshot builder (Node, built-in node:sqlite)
scripts/encrypt.mjs         snapshot encryption
reference/                  BCT catalogue shipped with the repo
src/
  App.js                    routes
  Landing.js                public landing page
  Legal.js                  terms and privacy shells
  dashboard/                the dashboard; see dashboard/README.md for internals
public/admin/data/          where the snapshot is written (ignored by git)
```

No third-party charting or data libraries.

## Tests

```bash
npm test -- --testPathPattern=dashboard --watchAll=false
```

Smoke tests render every view against whatever snapshot is present and skip the
assertions a given snapshot cannot support. They are skipped entirely if no
snapshot exists, or if the one on disk is encrypted.

## Data handling

- **Participants are identified by UID.** Names are not collected and the study
  schema has no column for them.
- **Race, ethnicity and phone number are excluded.** The snapshot builder does not
  select them, so they never leave the database.
- **One message goes to one participant.** The schema enforces it.
- **Participant days use `PSEUDO_TIME`**, the run's simulated clock, because that
  is the clock the activity series was recorded against. They can predate the run.
- **Panels tagged `mock` are fabricated.** That happens only when a snapshot has no
  participant activity; supply a database with `PERSONALIZATION_DAILY_ACTIVITY`
  rows and those panels become real on their own.
- **Databases and snapshots are never committed.** `.gitignore` blocks `*.db` and
  the generated snapshot.

## Deploying

The dashboard builds to static files and needs no backend. Build it, encrypt the
snapshot with a passphrase when prompted, and serve the `build/` folder over
HTTPS with unknown paths falling back to `index.html`.

Deployment notes for this project's server are kept outside the repository.
