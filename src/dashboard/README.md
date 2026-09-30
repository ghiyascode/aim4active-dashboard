# Dashboard internals

Setup and deployment are in the project README. This covers how the code is put
together.

## Data flow

`scripts/buildSnapshot.mjs` reads the pipeline's output and writes one JSON file.
The browser fetches it once, `data.js` normalises it, and six views read the same
filtered slice. There is no live query, which is why the dashboard runs with no
backend; the cost is that it shows a point in time until the snapshot is rebuilt.

## Message sources

They are produced by different efforts and carry different evidence:

| Source | Has | Lacks |
|---|---|---|
| Generation database | BCT, prompt, writer config, judge scores; a verdict in the current schema | judge scores are absent on older rows |
| Agentic run folders | accept/reject with a per-gate reason | judge scores |

`normalize()` merges them on the fields they share. A message carries
`status: "accepted" | "rejected" | "generated"`, where `generated` means never
adjudicated — which is how the older, unjudged messages are isolated in the UI.

## Files

```
Dashboard.js         shell, navigation, shared filter row
data.js              snapshot loading, normalisation, aggregation
participants.js      participant layer: real when available, mock when not
mockParticipants.js  the fabricated layer, isolated here
palette.js           colours and the BCT-to-hue mapping
charts.js            SVG chart primitives
dashboard.css        styles, all scoped under .a4a
views/               Overview, Messages, Matrix, Participants, Pipeline, RawData
```

## Things to know before changing it

- **Gates are never hardcoded.** Which critic gates exist is read from the data.
  A fixed list once dropped `style` and lost 342 rejections.
- **Rejections are one-to-many.** A message can fail several metrics. They are
  collected separately; joining them into the message query duplicates the
  message once per gate.
- **One message goes to one participant.** The schema enforces it.
- **BCT colours are keyed by URI**, so filtering never repaints the remaining
  series. Slot order was chosen for colour-vision separation.
- **Two database generations are supported**, detected at open time. Columns
  missing from the older one are read as empty rather than failing.
- **Participant days use `PSEUDO_TIME`**, the run's simulated clock, because
  that is the clock the activity series was recorded against.
