// Passphrase prompt shown when the snapshot is encrypted.
//
// This is not a login: there are no accounts and nothing is checked against a
// server. The passphrase is the decryption key, so an incorrect one produces no
// data rather than a refused session.

import { useState } from "react";
import { isSupported } from "./decrypt";

export default function Unlock({ onSubmit, error, busy }) {
  const [value, setValue] = useState("");
  const supported = isSupported();

  const submit = (e) => {
    e.preventDefault();
    if (value && !busy) onSubmit(value);
  };

  return (
    <div className="a4a-unlock">
      <form className="a4a-unlock-card" onSubmit={submit}>
        <p className="a4a-unlock-eyebrow">AIM4Active</p>
        <h1>Dashboard access</h1>
        <p className="a4a-unlock-lede">
          This data is encrypted. Enter the study team passphrase to view it.
        </p>

        {!supported ? (
          <p className="a4a-unlock-error">
            This browser cannot decrypt the data because the page is not being served over a
            secure connection. Open it over HTTPS, or on localhost.
          </p>
        ) : (
          <>
            <label className="a4a-unlock-field">
              <span>Passphrase</span>
              <input
                type="password"
                value={value}
                autoFocus
                autoComplete="current-password"
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={error ? "true" : undefined}
              />
            </label>

            {error && <p className="a4a-unlock-error">{error}</p>}

            <button className="a4a-unlock-button" type="submit" disabled={!value || busy}>
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </>
        )}

        <p className="a4a-unlock-note">
          Ask the study team if you do not have it. The passphrase is shared, not personal.
        </p>
      </form>
    </div>
  );
}
