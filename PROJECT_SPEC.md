# Project Spec: Canvas Question-Writing Review Tool

## 1. Purpose

Students submit draft quiz questions through, for now, a graded Canvas survey.
Currently this is a form with 12 fields — Bloom level, keywords, question stem, four answer options, per-option feedback, and the correct answer.
The teaching team (likely a Teaching Assistant) needs a tool to:

1. Upload the exported survey responses.
2. Review each submitted question, optionally edit it, and assign it a grade (for the survey assignment itself).
3. Accept or reject each question for inclusion in a real (Canvas) quiz.
4. Export the accepted questions as a QTI package ready to import into Quercus (University of Toronto's Canvas instance).
5. Export the grades as a CSV ready to re-upload into the Canvas gradebook.

## 2. Non-negotiable constraints

- **No server, no backend.** The entire app runs client-side in the browser.
  Nothing is transmitted anywhere.
  This is a static app (can be opened as a local HTML file or hosted as static files).
- **Single TA, single browser session.** No multi-user sync or merge needed.
- **TA is not technically savvy.** No command-line steps, no manual file conversion, no "run this script" instructions.
- Every action is a click in the browser.
- **Only multiple-choice questions** are in scope for now (4 options, 1 correct answer, per-option feedback).
- Other question types are explicitly out of scope.

## 3. Pipeline

Below is one pipeline option that uses https://github.com/gpoore/text2qti to generate the QTI file.
However, this tool is written in Python (not javascript).

```
Canvas Survey CSV (exported by instructor from the graded survey)
      ↓
[Parse CSV → in-memory data model]
      ↓
[TA reviews / edits / grades / accepts-or-rejects each question]
      ↓ (autosaved continuously to browser storage)
      ↓
[Export step, triggered by one button]
      ├─→ Build a text2qti-formatted quiz string from accepted questions
      │        ↓
      │   Run text2qti *inside the browser* via Pyodide (Python-in-WASM)
      │        ↓
      │   Download quiz.zip (QTI 1.2 package) → import into Quercus
      │
      └─→ Build and download grades.csv (Canvas gradebook import format)
```

## 4. Data model

One object per submitted question:

```js
{
  id: string,                 // stable unique id, e.g. row index or generated uuid
  student: {
    name: string,             // as it appears in the Canvas export
    sisLoginId: string,       // needed later for gradebook CSV matching
    canvasId: string
  },
  bloomLevel: string,         // one of Canvas's Bloom taxonomy options
  keywords: string[],         // 2-4 tags, split from comma-separated input
  stem: string,                // question text, ≤50 words
  responses: { A: string, B: string, C: string, D: string },   // ≤10 words each
  feedback:  { A: string, B: string, C: string, D: string },   // ≤50 words each
  correctAnswer: "A" | "B" | "C" | "D",
  grade: {
    points: number | null,
    pointsPossible: number,
    comment: string
  },
  status: "pending" | "accepted" | "rejected",
  wasEdited: boolean          // true if TA modified any field from the original submission
}
```

### Word-count validation

Flag (do not silently truncate) violations of the original survey's stated limits when parsing:
- Stem: 50 words max
- Each response: 10 words max
- Each feedback: 50 words max

Show these as warnings in the review UI; let the TA decide whether to edit or leave as-is.

## 5. Screens

1. **Upload** — file picker for the CSV. Parse and show: total rows parsed,
   any rows with missing required fields, any word-count violations. Do not
   block on warnings; block only on structurally unparseable rows.
2. **Queue / list view** — table of all submissions: student, Bloom level,
   status, grade. Filterable by status and Bloom level. Click a row to open
   the detail view.
3. **Detail / review view** — one question at a time:
   - Editable stem, four responses, four feedback fields
   - Correct-answer selector
   - Grade input (points) + comment
   - Accept / Reject toggle
   - Next / Previous navigation between submissions
4. **Export** — summary counts (accepted / rejected / pending), two actions:
   - "Download QTI package" (accepted questions only)
   - "Download gradebook CSV" (all graded submissions)

## 6. QTI export via text2qti + Pyodide

**Do not hand-build QTI XML.** Use the existing `text2qti` Python package
(https://github.com/gpoore/text2qti), run entirely client-side via Pyodide.

### Why this should work
- `text2qti` converts a plain-text/Markdown quiz format into a QTI 1.2 zip.
- Its dependencies (`markdown`, `bespon`) are pure Python, no compiled
  extensions — installable in Pyodide via `micropip`.
- Running it in Pyodide means the TA never touches a command line; the
  browser downloads a QTI zip directly.

### Format to generate (per accepted question)

```
Quiz title: <TA-provided or default title>

1.  <stem>
a)  <responses.A>
... <feedback.A>
b)  <responses.B>
... <feedback.B>
c)  <responses.C>
... <feedback.C>
*d) <responses.D, if D is correctAnswer — move the * to whichever letter is correct>
... <feedback.D>

```

Points-per-question default: fixed value across all questions (e.g. via a
single "points per question" setting on the export screen).
This isnot  configurable per-question for the initial build.
This is a placeholder decision — revisit once real submissions have been reviewed and it's clear whether per-question weighting is actually needed.

### Known integration risks to de-risk FIRST, before building the rest of the UI

- `text2qti` as a CLI tool normally prompts interactively on first run to
  create a config file (`.text2qti.bespon`) and ask for a LaTeX rendering
  URL. This must be handled non-interactively inside Pyodide (pre-seed the
  config, or bypass the prompt) since there is no terminal to answer it.
- Confirm `micropip.install` successfully resolves and imports both
  `text2qti` and its dependencies inside Pyodide.
- Recommended first build step: a minimal "hello world" that runs Pyodide,
  installs `text2qti`, feeds it a hardcoded 1-question quiz string, and
  confirms a valid QTI zip is produced and downloadable. Do this before
  building the review UI, since it's the highest-risk/least-certain piece.

## 7. Gradebook CSV export

Canvas's gradebook CSV importer matches rows using `Student`, `ID`,
`SIS User ID`, `SIS Login ID`, and `Section` columns, plus one column per
assignment containing the score.

Approach:
- The TA will supply (upload) the actual Canvas gradebook export CSV for the
  relevant assignment as a starting template — this already has correctly
  formatted student-matching columns.
- The app merges in the grades entered during review (matched by student
  identifier) into the appropriate assignment column, without touching any
  other columns.
- Avoid Canvas's reserved column names ("Final Grade," "Current Score,"
  "Final Points," etc.) when naming any new column, since Canvas ignores
  those on import.
- Output: a downloadable CSV, ready to re-upload via Canvas's
  Grades → Import.

## 8. Persistence

- Autosave continuously to `localStorage` or `IndexedDB` after every edit,
  grade, or status change, so a refresh/crash doesn't lose review progress.
- Provide a manual "export progress as JSON" / "load progress from JSON"
  pair as a backup/portability option, independent of the two main exports.

## 9. Tech stack

- Vanilla JS or React (React recommended for the review-queue state
  management) — single-page app, no build server required to run it (can be
  opened as a static HTML file or served locally)
- **PapaParse** — CSV parsing (survey export and gradebook template)
- **Pyodide** — runs `text2qti` client-side for QTI generation
- **JSZip** — only needed if any additional client-side zipping is required
  outside of what `text2qti`/Pyodide already produces
- No servers, no external network calls at runtime beyond the initial CDN
  loads of the above libraries

## 10. Build order (recommended)

1. Pyodide + text2qti de-risking spike (see Section 6) — confirm the
   riskiest dependency works before investing in the rest
2. CSV parser + data model, tested against a hand-written sample CSV
3. Review queue + detail UI (no persistence yet)
4. Autosave (localStorage/IndexedDB)
5. Full QTI export (wire the reviewed/accepted data into the text2qti
   pipeline validated in step 1)
6. Gradebook CSV merge/export (needs a real gradebook CSV sample to finalize
   column handling)

## 11. Open items still to resolve once real files are available

- Exact column headers/order of the real Canvas survey CSV export (parser
  mapping may need adjusting once a real sample is seen — build the parser
  to be reasonably flexible/self-mapping in the meantime)
- Exact column layout of a real Canvas gradebook export CSV, to finalize the
  merge logic in Section 7
- Whether per-question point values (vs. a fixed value) are needed — revisit
  after initial use
