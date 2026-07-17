import { getPyodideRuntime } from "./pyodideRuntime.js";

// Drives text2qti's internal API (Config/Quiz/QTI) directly rather than its
// cmdline.main() entry point, which prompts interactively on first run --
// see spikes/text2qti-spike/ and Section 6 for why that's safe to bypass
// entirely in Pyodide (the prompt is gated behind a tty check that's never
// true here). Config.load() degrades gracefully when it can't write
// ~/.text2qti.bespon in Pyodide's virtual filesystem.
const PY_DRIVER = `
from text2qti.config import Config
from text2qti.quiz import Quiz
from text2qti.qti import QTI

config = Config()
config.load()

quiz = Quiz(quiz_text, config=config, source_name="export.txt")
qti = QTI(quiz)
qti.zip_bytes()
`;

/**
 * Run text2qti (via Pyodide) on the given quiz text and return the
 * resulting QTI 1.2 zip as bytes, ready to wrap in a Blob for download.
 *
 * @param {string} quizText - text2qti-format quiz text (buildQuizText.js).
 * @returns {Promise<Uint8Array>}
 */
export async function generateQtiZip(quizText) {
  const pyodide = await getPyodideRuntime();
  pyodide.globals.set("quiz_text", quizText);
  const zipPy = await pyodide.runPythonAsync(PY_DRIVER);
  try {
    return zipPy.toJs();
  } finally {
    zipPy.destroy();
  }
}
