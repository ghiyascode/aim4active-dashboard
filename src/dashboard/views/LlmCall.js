// One LLM call, shown two ways: a compact row (stage, outcome, model, timing)
// and the full record (output, reasoning, prompt, settings). Shared by the LLM
// logs view and the generation history in the message detail panel.

import { stageLabel, STAGES, outcome } from "../llmLogs";
import { STATUS } from "../palette";

const OUTCOME_COLOR = {
  pass: STATUS.good,
  fail: STATUS.critical,
  error: STATUS.critical,
};

export function formatTime(iso) {
  if (!iso) return "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function formatMs(ms) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export function StageTag({ stage }) {
  return (
    <span className={`a4a-stage a4a-stage-${STAGES[stage] ? stage : "other"}`} title={STAGES[stage]?.hint}>
      {stageLabel(stage)}
    </span>
  );
}

export function MockTag() {
  return (
    <span className="a4a-chip" title="Placeholder: no LLM log exists for this call">
      <span className="a4a-dot" style={{ background: STATUS.warning }} />
      mock
    </span>
  );
}

export function Outcome({ call }) {
  const o = outcome(call);
  const text = call.error ? "error" : call.verdict || (call.stage === "generate" ? "drafted" : "—");
  return (
    <span className="a4a-status">
      <span className="a4a-dot" style={{ background: OUTCOME_COLOR[o] || "var(--axis)" }} />
      {text}
    </span>
  );
}

/** Compact one-line summary, used as the <summary> of an expandable call. */
export function CallLine({ call }) {
  return (
    <span className="a4a-call-line">
      <StageTag stage={call.stage} />
      <Outcome call={call} />
      <span className="a4a-call-meta">
        {call.mock ? <MockTag /> : <>{formatMs(call.latencyMs)}{call.tokensOut != null && <> · {call.tokensOut.toLocaleString()} tok</>}</>}
      </span>
    </span>
  );
}

function Block({ title, children, open = false, mono = true }) {
  if (children == null || children === "") return null;
  return (
    <details className="a4a-call-block" open={open}>
      <summary>{title}</summary>
      <pre className={mono ? "a4a-pre a4a-mono" : "a4a-pre"}>{children}</pre>
    </details>
  );
}

/** The full record of one call. */
export function CallBody({ call }) {
  return (
    <div className="a4a-call-body">
      {call.mock && (
        <p className="a4a-note" style={{ margin: "0 0 10px" }}>
          <b>Mock call record.</b> No LLM log covers this candidate. The verdict and reason come
          from the run files; the prompt, reasoning, timing and token counts were never recorded.
        </p>
      )}

      {call.error && <pre className="a4a-pre a4a-call-error">{call.error}</pre>}

      {call.reason && call.stage !== "generate" && (
        <p className="a4a-call-reason">
          {call.reason}
          {call.guidance && <><br /><span style={{ color: "var(--ink-3)" }}>Guidance:</span> {call.guidance}</>}
        </p>
      )}

      <Block title="Output" open mono={call.stage !== "generate"}>{call.output}</Block>
      {call.reasoning
        ? <Block title={`Reasoning (${call.reasoning.length.toLocaleString()} chars)`}>{call.reasoning}</Block>
        : !call.mock && call.stage !== "judge" && !call.error && <p className="a4a-call-empty">No reasoning returned.</p>}
      <Block title={`Prompt${call.prompt ? ` (${call.prompt.length.toLocaleString()} chars)` : ""}`}>{call.prompt}</Block>
      {call.system && <Block title="System prompt">{call.system}</Block>}

      {!call.mock && (
        <dl className="a4a-call-dl">
          <dt>Call</dt><dd className="a4a-mono">#{call.id} · {call.fn}</dd>
          <dt>Time</dt><dd className="a4a-mono">{formatTime(call.at)}</dd>
          <dt>Model</dt><dd className="a4a-mono">{call.model}</dd>
          <dt>Settings</dt>
          <dd className="a4a-mono">
            temp {call.temperature ?? "—"} · max {call.maxTokens?.toLocaleString() ?? "—"} tok
            {call.effort && <> · effort {call.effort}</>}
          </dd>
          <dt>Usage</dt>
          <dd className="a4a-mono">
            {call.tokensIn?.toLocaleString() ?? "—"} in · {call.tokensOut?.toLocaleString() ?? "—"} out · {formatMs(call.latencyMs)}
            {call.finish && <> · {call.finish}</>}
          </dd>
          <dt>Code</dt><dd className="a4a-mono">{call.branch} @ {call.commit}</dd>
        </dl>
      )}
    </div>
  );
}

/** Expandable call: summary line, full record on open. */
export function CallItem({ call, open = false }) {
  return (
    <details className="a4a-call" open={open}>
      <summary><CallLine call={call} /></summary>
      <CallBody call={call} />
    </details>
  );
}
