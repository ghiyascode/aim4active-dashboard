// Shell, navigation, and the shared filter row that scopes every view below it.

import { useState, useMemo } from "react";
import "./dashboard.css";
import { useDashboardData, useFiltered, EMPTY_FILTERS, SNAPSHOT_URL } from "./data";
import Unlock from "./Unlock";
import Overview from "./views/Overview";
import Messages from "./views/Messages";
import Matrix from "./views/Matrix";
import Participants from "./views/Participants";
import Pipeline from "./views/Pipeline";
import RawData from "./views/RawData";

const VIEWS = [
  { key: "overview", label: "Overview", component: Overview, blurb: "Everything as a whole — volume, acceptance, and reach across all four data dimensions." },
  { key: "messages", label: "Messages", component: Messages, blurb: "Every message ever generated, accepted or rejected, searchable by content — with the full gate-by-gate reason it didn't pass." },
  { key: "matrix", label: "Matrix", component: Matrix, blurb: "BCT against participant, prompt variant, and model — messages in the cells." },
  { key: "participants", label: "Participants", component: Participants, blurb: "Fitbit steps against the days messages were received, grouped by zip code and shared weather." },
  { key: "pipeline", label: "Pipeline", component: Pipeline, blurb: "For developers: what the agentic loop actually did — cycles, critic gates, and where candidates die." },
  { key: "raw", label: "Raw data", component: RawData, blurb: "The flat table behind every other view. Sort it, filter it, export it." },
];

export default function Dashboard() {
  const { status, data, error, unlock, unlockError, unlockBusy } = useDashboardData();
  const [view, setView] = useState("overview");
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const filtered = useFiltered(data, filters);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const active = VIEWS.find((v) => v.key === view);
  const Body = active.component;

  const counts = useMemo(() => {
    if (!data || !filtered) return {};
    return {
      messages: filtered.messages.length,
      matrix: filtered.sends.length,
      participants: filtered.users.length,
      pipeline: data.runs.length,
      raw: filtered.messages.length,
    };
  }, [data, filtered]);

  // The passphrase gate stands in front of the whole dashboard, before any
  // navigation or filter state is worth showing.
  if (status === "locked") {
    return (
      <div className="a4a a4a-locked">
        <Unlock onSubmit={unlock} error={unlockError} busy={unlockBusy} />
      </div>
    );
  }

  return (
    <div className="a4a">
      <nav className="a4a-nav">
        <div className="a4a-brand">
          <b>AIM4Active</b>
          <span>Admin dashboard</span>
        </div>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} aria-current={view === v.key ? "page" : undefined}>
            {v.label}
            {counts[v.key] != null && <small>{counts[v.key].toLocaleString()}</small>}
          </button>
        ))}
        <div className="a4a-nav-foot">
          {data ? (
            <>
              Snapshot {new Date(data.snapshot.generatedAt).toLocaleDateString()}
              <br />
              {data.snapshot.sources.db}
            </>
          ) : "…"}
        </div>
      </nav>

      <main className="a4a-main">
        <div className="a4a-head">
          <h1>{active.label}</h1>
          <p>{active.blurb}</p>
        </div>

        {status === "loading" && <div className="a4a-card"><div className="a4a-empty">Loading snapshot…</div></div>}

        {status === "error" && (
          <div className="a4a-card">
            <div className="a4a-empty">
              <p><b>Couldn't load {SNAPSHOT_URL}</b></p>
              <p style={{ marginTop: 8 }}>{error}</p>
              <p style={{ marginTop: 12, fontSize: 12 }}>
                Generate it first, from the <code>ui/</code> directory:<br />
                <code className="a4a-mono">npm run snapshot</code>
              </p>
            </div>
          </div>
        )}

        {status === "ready" && data.unprotected && (
          <div className="a4a-unprotected">
            <b>This snapshot is not encrypted.</b> It was built without a passphrase, so anyone
            who can reach <span className="a4a-mono">{SNAPSHOT_URL}</span> can read it. Fine
            locally; rebuild with <span className="a4a-mono">A4A_PASSPHRASE</span> before putting
            it on a server.
          </div>
        )}

        {status === "ready" && (
          <>
            <FilterBar data={data} filters={filters} set={set} reset={() => setFilters(EMPTY_FILTERS)} scope={filtered} />
            <Body data={data} filtered={filtered} filters={filters} set={set} setView={setView} />
          </>
        )}
      </main>
    </div>
  );
}

/** One filter row above everything it scopes — never per-chart filters. */
function FilterBar({ data, filters, set, reset, scope }) {
  const dirty = Object.values(filters).some(Boolean);
  return (
    <div className="a4a-filters">
      <input
        type="search"
        placeholder="Search message text, rejection reasons, core ideas…"
        value={filters.q}
        onChange={(e) => set({ q: e.target.value })}
        aria-label="Search messages"
      />

      <label>
        BCT
        {/* Targeted BCTs list first. Without the catalogue none are flagged, so
            fall back to listing them by usage instead of an empty top group. */}
        <select value={filters.bctUri} onChange={(e) => set({ bctUri: e.target.value })}>
          <option value="">All BCTs</option>
          {(data.bcts.some((b) => b.targeted)
            ? data.bcts.filter((b) => b.targeted)
            : data.bcts.slice(0, 8)
          ).map((b) => (
            <option key={b.uri} value={b.uri}>{b.name} ({b.count.toLocaleString()})</option>
          ))}
          {data.bcts.some((b) => b.targeted) && (
            <optgroup label="Other BCTs">
              {data.bcts.filter((b) => !b.targeted).slice(0, 20).map((b) => (
                <option key={b.uri} value={b.uri}>{b.name} ({b.count})</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {/* Batch and run are separate things in this project, so they are separate
          controls. Picking one clears the other — no message is in both. */}
      <label>
        Batch
        <select
          value={filters.batchKey}
          onChange={(e) => set({ batchKey: e.target.value, runId: "" })}
          title="A group of messages generated by one job (MESSAGES.BATCH_ID)"
        >
          <option value="">All batches</option>
          {data.batches.filter((b) => b.source === "db").map((b) => (
            <option key={b.key} value={b.key}>{b.label} ({b.count.toLocaleString()})</option>
          ))}
        </select>
      </label>

      <label>
        Run
        <select
          value={filters.runId}
          onChange={(e) => set({ runId: e.target.value, batchKey: "" })}
          title="A run folder under msg_gen/agentic/"
        >
          <option value="">All runs</option>
          {data.batches.filter((b) => b.source === "agentic").map((b) => (
            <option key={b.key} value={b.key}>{b.label} ({b.count})</option>
          ))}
        </select>
      </label>

      <label>
        Verdict
        <select value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="generated">No verdict</option>
        </select>
      </label>

      <label>
        Participant
        <select value={filters.uid} onChange={(e) => set({ uid: e.target.value })}>
          <option value="">All participants</option>
          {data.users.map((u) => (
            <option key={u.uid} value={u.uid}>{u.uid}</option>
          ))}
        </select>
      </label>

      <label>
        Zip
        <select value={filters.zip} onChange={(e) => set({ zip: e.target.value })}>
          <option value="">All zips</option>
          {[...new Set(data.users.map((u) => u.zip))].sort().map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </label>

      {dirty && <button className="a4a-reset" onClick={reset}>Clear</button>}

      <span className="a4a-scope">
        {scope.messages.length.toLocaleString()} messages · {scope.sends.length.toLocaleString()} sends
      </span>
    </div>
  );
}
