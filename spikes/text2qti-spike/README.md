# Pyodide + text2qti de-risking spike

Open [`pyodide-text2qti-spike.html`](./pyodide-text2qti-spike.html) directly in a
browser (double-click, no server) and click "Run spike". It boots Pyodide,
installs `text2qti` via `micropip`, generates a QTI 1.2 zip from a hardcoded
one-question quiz, and downloads it.

Validated (headless Chromium, `file://`, plus a Node/Pyodide run for the
Python side): install succeeds, no interactive prompt fires, and the
downloaded zip is a well-formed QTI 1.2 package (`imsmanifest.xml` +
`assessment_meta.xml` + assessment XML) with the correct answer and feedback
wired up correctly.

## Findings

- **No interactive prompt to work around.** The risk described in the spec —
  `text2qti` prompting for a LaTeX rendering URL on first run — only happens
  in `text2qti.cmdline.main()`, and only when
  `sys.stdout.isatty() and sys.stdin.isatty()` (`cmdline.py:59`). Neither is
  true in Pyodide. More importantly, the spike **doesn't call `main()` at
  all** — it calls the library directly (`Config`, `Quiz`, `QTI` from
  `text2qti.config` / `text2qti.quiz` / `text2qti.qti`), which sidesteps
  `argparse`, `sys.argv`, and all cmdline-only code paths entirely.
- **`micropip.install("text2qti")` resolves cleanly.** Its two dependencies,
  `bespon` and `markdown`, are pure Python and installed from PyPI wheels
  with no compiled-extension issues.
- **No filesystem needed.** `QTI.zip_bytes()` (`qti.py:63`) returns the zip
  as in-memory `bytes` — no need to write to Pyodide's virtual FS or read
  anything back. Bytes cross the Python→JS boundary via `pyodide.toJs()` and
  get wrapped in a `Blob` for download.
- **`Config.load()` never blocks.** If `~/.text2qti.bespon` doesn't exist (it
  won't, in Pyodide's fresh virtual FS), it tries to write a default template
  and silently warns on `FileNotFoundError`/`PermissionError` instead of
  raising — config still loads with defaults either way.

## Not yet exercised (defer to full integration)

- LaTeX/math rendering paths (`--pandoc-mathml`, `run_code_blocks`) — unused
  by this project's plain multiple-choice format, and they shell out via
  `subprocess`, which doesn't exist in Pyodide. Fine as long as they're never
  invoked, which the spike confirms for the default code path.
- Multi-question quizzes, per-question point values, special characters in
  stems/options — the spike only proves the pipeline, not full format
  coverage. Section 6's quiz-string builder will need its own tests once the
  review UI exists.
