// Public landing page. Carries no study data of any kind, so it is safe to
// serve without authentication. The link to /admin is just a link; the data
// behind it is encrypted and needs the passphrase.
//
// Step and card accents run a blue-to-red ramp through purple. These are
// decorative only; the dashboard's data colours are separate and unchanged.

import { Link } from "react-router-dom";
import "./landing.css";

const PIPELINE = [
  {
    step: "01",
    hue: "blue",
    title: "Generate",
    body: "A language model drafts candidate messages, each aimed at a single behaviour change technique such as goal setting or action planning.",
  },
  {
    step: "02",
    hue: "violet",
    title: "Review",
    body: "Every candidate faces a chain of automated checks: safety, technique alignment, readability, tone and novelty. Most do not survive.",
  },
  {
    step: "03",
    hue: "magenta",
    title: "Deliver",
    body: "Messages that clear review are sent to a participant, timed against their recent activity and local conditions.",
  },
  {
    step: "04",
    hue: "red",
    title: "Measure",
    body: "Delivered messages are scored on seven quality dimensions, and the outcome of every candidate is recorded with its reason.",
  },
];

const SHOWS = [
  {
    hue: "blue",
    title: "Every message, and its verdict",
    body: "Search the full history by content. Open any message to see which technique it targeted, which check rejected it, and the reviewer's written reason.",
  },
  {
    hue: "violet",
    title: "Technique against outcome",
    body: "Compare behaviour change techniques across runs, prompts and model configurations, measured by volume or by quality.",
  },
  {
    hue: "magenta",
    title: "What reached participants",
    body: "Activity alongside the days a message arrived, so delivery can be read in the context it actually happened in.",
  },
];

export default function Landing() {
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

      <header className="landing-hero">
        <div className="landing-inner">
          <p className="landing-eyebrow">Research tooling</p>
          <h1>AIM4Active</h1>
          <p className="landing-lede">
            A study system that writes personalised motivational messages for cancer survivors,
            reviews each one against behavioural science criteria, and sends those that pass.
            This dashboard is the window onto what it produced.
          </p>
        </div>
      </header>

      <main className="landing-inner">
        <section className="landing-section">
          <h2>How the system works</h2>
          <p className="landing-section-lede">
            Messages are not written once and sent. Each is drafted, examined, and either
            delivered or discarded with a recorded reason.
          </p>
          <ol className="landing-steps">
            {PIPELINE.map((s) => (
              <li key={s.step} className={`hue-${s.hue}`}>
                <span className="landing-step-n">{s.step}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section">
          <h2>What the dashboard shows</h2>
          <div className="landing-cards">
            {SHOWS.map((c) => (
              <article key={c.title} className={`landing-card hue-${c.hue}`}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-access">
          <div className="landing-access-text">
            <h2>Access</h2>
            <p>
              The dashboard holds participant activity and message content, so it is restricted
              to the study team. The data file is encrypted; the passphrase decrypts it in your
              browser and is never sent anywhere.
            </p>
            <p className="landing-muted">
              If you need access, ask the study team. The passphrase is shared, not personal.
            </p>
          </div>
          <a className="landing-cta" href="/admin">Open the dashboard</a>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-inner landing-footer-inner">
          <p className="landing-muted">
            An IDIR Lab project. No participant data appears on this page.
          </p>
          <nav className="landing-footer-links">
            <Link to="/terms">Terms of Use</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
