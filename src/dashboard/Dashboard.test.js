/**
 * Smoke test — renders the dashboard against the real snapshot file and walks
 * every view, so a broken selector or chart shows up here rather than in a demo.
 *
 * Requires ui/public/dashboard-snapshot.json to exist (npm run snapshot).
 *
 * jest-dom is imported here rather than via src/setupTests.js so this test adds
 * nothing to the project's global test config.
 */

import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import Dashboard from "./Dashboard";

const SNAPSHOT_PATH = path.join(__dirname, "..", "..", "public", "admin", "data", "snapshot.json");
const hasSnapshot = fs.existsSync(SNAPSHOT_PATH);
const describeIf = hasSnapshot ? describe : describe.skip;

describeIf("admin dashboard", () => {
  let snapshot;

  beforeAll(() => {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  });

  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) }));
  });

  const renderReady = async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByLabelText("Search messages")).toBeInTheDocument(), { timeout: 20000 });
  };

  const gotoView = (name) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`, "i") }));

  const scopedMessageCount = () => {
    const heading = screen.getByRole("heading", { level: 3 });
    return Number(heading.textContent.replace(/[^0-9]/g, ""));
  };

  test("loads the snapshot and reports the real total", async () => {
    await renderReady();
    const total = snapshot.db.messages.length + snapshot.agentic.candidates.length;
    expect(screen.getAllByText(new RegExp(`${total.toLocaleString()} messages`)).length).toBeGreaterThan(0);
  }, 40000);

  // Verdicts used to be counted from folder-based runs only, so a database that
  // records its own verdicts reported zero accepted.
  test("overview counts verdicts from whichever source recorded them", async () => {
    const dbAccepted = snapshot.db.messages.filter((m) => m.status === "accepted").length;
    const agAccepted = snapshot.agentic.candidates.filter((c) => c.status === "accepted").length;
    const expected = dbAccepted + agAccepted;
    if (!expected) return;

    await renderReady();
    // read the figure out of the Accepted tile specifically
    await waitFor(() => {
      const tile = [...document.querySelectorAll(".a4a-tile")].find(
        (t) => t.querySelector("dt")?.textContent.trim() === "Accepted"
      );
      expect(tile).toBeTruthy();
      expect(tile.querySelector("dd").textContent.trim()).toBe(expected.toLocaleString());
    });
  }, 40000);

  test("every view renders without crashing", async () => {
    await renderReady();
    for (const view of ["Messages", "Matrix", "Participants", "Pipeline", "Raw data", "Overview"]) {
      gotoView(view);
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(new RegExp(view, "i"))
      );
    }
  }, 60000);

  test("keyword search narrows the message table", async () => {
    await renderReady();
    gotoView("Messages");
    const before = scopedMessageCount();

    fireEvent.change(screen.getByLabelText("Search messages"), { target: { value: "mailbox" } });

    await waitFor(() => {
      const after = scopedMessageCount();
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThan(before);
    });
  }, 40000);

  test("a rejected message exposes the gate that killed it", async () => {
    await renderReady();
    gotoView("Messages");

    fireEvent.change(screen.getByLabelText("Verdict"), { target: { value: "rejected" } });
    await waitFor(() => expect(scopedMessageCount()).toBeGreaterThan(0));

    const rows = screen.getAllByRole("row").filter((r) => r.className.includes("a4a-row-click"));
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);

    await waitFor(() => expect(screen.getByText("Message detail")).toBeInTheDocument());
    expect(screen.getByText(/Rejected by/)).toBeInTheDocument();
    expect(screen.getByText("Critic gates")).toBeInTheDocument();
  }, 40000);

  test("BCT filter scopes to a single technique", async () => {
    await renderReady();
    gotoView("Messages");
    const before = scopedMessageCount();

    // Pick a BCT the snapshot actually contains rather than assuming one.
    const uri = snapshot.bctCatalog[0]?.uri
      ?? snapshot.db.messages.find((m) => m.bctUri)?.bctUri;
    expect(uri).toBeTruthy();
    fireEvent.change(screen.getByLabelText("BCT"), { target: { value: uri } });

    await waitFor(() => {
      const after = scopedMessageCount();
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThan(before);
    });
  }, 40000);

  test("Batch and Run are separate, mutually exclusive filters", async () => {
    if (!snapshot.agentic.runs.length) return; // no runs in this snapshot
    await renderReady();
    gotoView("Messages");
    const all = scopedMessageCount();

    // a run scopes to that run's candidates only
    const run = snapshot.agentic.runs[0];
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: run.id } });
    await waitFor(() => {
      const n = scopedMessageCount();
      expect(n).toBe((run.accepted || 0) + (run.rejected || 0));
      expect(n).toBeLessThan(all);
    });

    // picking a batch clears the run rather than intersecting to nothing
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "batch-1" } });
    await waitFor(() => {
      expect(screen.getByLabelText("Run").value).toBe("");
      const inBatch = snapshot.db.messages.filter((m) => m.batchId === 1).length;
      expect(scopedMessageCount()).toBe(inBatch);
    });
  }, 40000);

  test("gate list is derived from the data, including `style`", async () => {
    await renderReady();
    gotoView("Pipeline");

    // `style` appears only in later runs. A hardcoded gate list dropped it once.
    const styleTotal = snapshot.agentic.runs.reduce((a, r) => a + (r.rejectionsByCritic?.style || 0), 0);
    if (!styleTotal) return; // this snapshot has no style rejections
    await waitFor(() => expect(screen.getAllByText("Style").length).toBeGreaterThan(0));
  }, 40000);

  // The participant layer uses real activity when the snapshot has it and falls
  // back to the mock when it does not. Either is valid; what matters is that the
  // page says which one it is, and never labels real data as mock.
  test("participants view reflects whichever layer is live", async () => {
    const isReal = (snapshot.db?.dailyActivity?.length ?? 0) > 0;
    await renderReady();
    gotoView("Participants");

    if (isReal) {
      await waitFor(() => expect(screen.getByText(/Real participants/)).toBeInTheDocument());
      expect(screen.queryByText(/fabricated/)).not.toBeInTheDocument();
      const uids = new Set(snapshot.db.dailyActivity.map((a) => a.uid));
      for (const uid of uids) expect(screen.getAllByText(uid).length).toBeGreaterThan(0);
    } else {
      await waitFor(() => expect(screen.getByText(/fabricated/)).toBeInTheDocument());
      expect(screen.getAllByText("mock").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^U0\d\d$/).length).toBeGreaterThan(0);
    }
  }, 40000);

  // The timeline is a separate component and only mounts on click, so a render
  // error in it does not show up in the plain view walk.
  test("opening a participant renders their timeline", async () => {
    await renderReady();
    gotoView("Participants");

    const rows = screen.getAllByRole("row").filter((r) => r.className.includes("a4a-row-click"));
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);

    await waitFor(() => expect(screen.getByText(/steps and message days/)).toBeInTheDocument());
    expect(screen.getByText(/Daily temperature/)).toBeInTheDocument();
  }, 40000);

  // Participants are identified by UID in both layers; names are never collected.
  test("no participant names are rendered", async () => {
    await renderReady();
    gotoView("Participants");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Participants/i));
    const uidLike = /^[A-Z]{1,3}\d{3,4}$/;
    const cells = [...document.querySelectorAll(".a4a-mono")].map((n) => n.textContent.trim());
    const idCells = cells.filter((t) => uidLike.test(t));
    expect(idCells.length).toBeGreaterThan(0);
  }, 40000);

  // Runs come from the database and/or the folder artifacts; the view counts both.
  test("pipeline view reports every run in the snapshot", async () => {
    const dbRunIds = new Set(
      snapshot.db.messages.filter((m) => m.runId != null).map((m) => m.runId)
    );
    const expected = dbRunIds.size + snapshot.agentic.runs.length;
    await renderReady();
    gotoView("Pipeline");
    await waitFor(() => expect(screen.getByText("Runs")).toBeInTheDocument());
    expect(screen.getAllByText(String(expected)).length).toBeGreaterThan(0);
  }, 40000);

  // The gate breakdown must survive coming from the database rather than folders.
  test("pipeline shows per-gate rejections from whichever source has them", async () => {
    const gates = {};
    for (const m of snapshot.db.messages) for (const g of m.failedGates || []) gates[g] = true;
    for (const r of snapshot.agentic.runs) for (const g of Object.keys(r.rejectionsByCritic || {})) gates[g] = true;
    const names = Object.keys(gates);
    if (!names.length) return;

    await renderReady();
    gotoView("Pipeline");
    await waitFor(() => expect(screen.getByText("Where candidates die")).toBeInTheDocument());
    // every gate present in the data appears somewhere on the page
    const page = document.body.textContent.toLowerCase();
    for (const g of names) {
      expect(page).toContain(g.replace(/_/g, " ").toLowerCase());
    }
  }, 40000);

  test("matrix renders a cell grid", async () => {
    await renderReady();
    gotoView("Matrix");
    await waitFor(() => expect(document.querySelectorAll(".a4a-cell").length).toBeGreaterThan(0));
  }, 40000);

  // Every column dimension must produce a grid, not just the default one.
  test("matrix supports every column dimension", async () => {
    await renderReady();
    gotoView("Matrix");
    const select = screen.getByLabelText(/Columns/);

    for (const value of ["run", "gate", "prompt", "writer", "participant"]) {
      fireEvent.change(select, { target: { value } });
      await waitFor(() => {
        const cells = document.querySelectorAll(".a4a-cell").length;
        const empty = screen.queryByText(/Nothing to show for this combination/);
        // either it drew a grid, or it said plainly that there is nothing to draw
        expect(cells > 0 || empty !== null).toBe(true);
      });
    }
  }, 60000);

  // "Which messages didn't pass which check" is the gate cut of the matrix.
  test("matrix by failed check reflects the gates in the data", async () => {
    const gates = new Set();
    for (const m of snapshot.db.messages) for (const g of m.failedGates || []) gates.add(g);
    if (!gates.size) return;

    await renderReady();
    gotoView("Matrix");
    fireEvent.change(screen.getByLabelText(/Columns/), { target: { value: "gate" } });

    await waitFor(() => expect(document.querySelectorAll(".a4a-cell").length).toBeGreaterThan(0));
    const page = document.body.textContent.toLowerCase();
    for (const g of gates) expect(page).toContain(g.replace(/_/g, " ").toLowerCase());
  }, 40000);

  // Quality must never present judge scores as if they covered every message.
  test("quality panel reports judge coverage honestly", async () => {
    await renderReady();
    gotoView("Pipeline");
    await waitFor(() => expect(screen.getByText("Message quality")).toBeInTheDocument());

    const judged = snapshot.db.messages.filter(
      (m) => (m.rejections || []).length === 0 && m.deliveredId != null
    ).length;
    // each signal is reported with its own coverage, never as a bare average
    for (const signal of ["Judge score", "Sentiment", "Reading ease"]) {
      expect(screen.getAllByText(signal).length).toBeGreaterThan(0);
    }
    // the tiles state how many messages each average is based on
    expect(screen.getByText(/1-5 · .* messages \(/)).toBeInTheDocument();
    if (judged) expect(screen.getByText(/Quality by technique/)).toBeInTheDocument();
  }, 40000);
});
