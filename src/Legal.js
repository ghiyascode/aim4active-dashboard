// Terms of Use and Privacy Policy.
//
// The wording is written by the study team, not here. Each page is a shell with
// its sections laid out and a placeholder in each; replace the CONTENT entries
// below with the approved text. The draft banner disappears on its own once a
// section has real content.

import { Link } from "react-router-dom";
import "./landing.css";

// ── Replace the `body` strings with the approved wording. ────────────────────
// A section whose body is null renders as an open placeholder.

const TERMS = {
  title: "Terms of Use",
  updated: null, // e.g. "5 October 2026"
  sections: [
    { heading: "About this tool", body: null },
    { heading: "Who may use it", body: null },
    { heading: "Acceptable use", body: null },
    { heading: "Availability and accuracy", body: null },
    { heading: "Contact", body: null },
  ],
};

const PRIVACY = {
  title: "Privacy Policy",
  updated: null,
  sections: [
    { heading: "What this page collects", body: null },
    { heading: "What the dashboard holds", body: null },
    { heading: "How it is protected", body: null },
    { heading: "Who has access", body: null },
    { heading: "Retention and participant rights", body: null },
    { heading: "Contact", body: null },
  ],
};
// ─────────────────────────────────────────────────────────────────────────────

function LegalPage({ doc }) {
  const written = doc.sections.filter((s) => s.body).length;
  const isDraft = written < doc.sections.length;

  return (
    <div className="landing">
      {/* Pinned to the top-left corner of the page, outside the centred
          column. Hidden automatically if the image is missing. */}
      <img
        className="landing-logo"
        src={`${process.env.PUBLIC_URL || ""}/idir-logo.png`}
        alt="IDIR Lab"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />

      <header className="landing-legal-head">
        <div className="landing-inner">
          <Link className="landing-back" to="/">← AIM4Active</Link>
          <h1>{doc.title}</h1>
          <p className="landing-muted">
            {doc.updated ? `Last updated: ${doc.updated}` : "Not yet published"}
          </p>
        </div>
      </header>

      <main className="landing-inner landing-legal">
        {isDraft && (
          <div className="landing-review">
            <b>Draft.</b> {written} of {doc.sections.length} sections written. This page is a
            placeholder until the study team supplies the approved wording.
          </div>
        )}

        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body ? <p>{s.body}</p> : <p className="landing-todo">To be written.</p>}
          </section>
        ))}
      </main>

      <footer className="landing-footer">
        <div className="landing-inner landing-footer-inner">
          <p className="landing-muted">AIM4Active research tooling.</p>
          <nav className="landing-footer-links">
            <Link to="/terms">Terms of Use</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export const Terms = () => <LegalPage doc={TERMS} />;
export const Privacy = () => <LegalPage doc={PRIVACY} />;
