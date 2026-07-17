// Same CDN URL validated by the de-risking spike (Section 6,
// spikes/text2qti-spike/) -- loaded from jsdelivr rather than bundled, per
// Section 9's "no servers, no external network calls beyond the initial
// CDN loads" constraint. Pyodide isn't an ES module (it's a UMD global),
// so it's injected as a <script> tag rather than imported.
const PYODIDE_SCRIPT_URL =
  "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js";

// Booting Pyodide and installing text2qti are both slow (WASM download,
// package install) -- cached across the page's lifetime so only the first
// export pays that cost; every export after that reuses the same runtime.
let runtimePromise = null;

function loadPyodideScript() {
  return new Promise((resolve, reject) => {
    if (typeof window.loadPyodide === "function") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = PYODIDE_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load Pyodide from ${PYODIDE_SCRIPT_URL}`));
    document.head.appendChild(script);
  });
}

/**
 * Boot Pyodide and install text2qti, once per page load. See the spike's
 * findings (Section 6) for why text2qti installs cleanly via micropip with
 * no compiled-extension issues.
 *
 * @returns {Promise<object>} The ready-to-use Pyodide runtime instance,
 *   with text2qti already installed.
 */
export function getPyodideRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await loadPyodideScript();
      const pyodide = await window.loadPyodide();
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      await micropip.install("text2qti");
      return pyodide;
    })().catch((err) => {
      // Don't cache a failed attempt -- a transient network issue
      // shouldn't permanently break every export for the rest of the page
      // session; the next attempt gets a clean retry.
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}
