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

- **No server, no backend.** The entire app runs client-side; `npm run build`
  produces static files hosted as-is (e.g. GitHub Pages), opened via a URL —
  not via double-clicking a local file (Vite's ES module output is blocked
  by CORS under `file://`).
- **Single TA, single browser session.** No multi-user sync or merge needed.
- **TA is not technically savvy.** No command-line steps, no manual file
  conversion. Every action is a click in the browser.
- **Only multiple-choice questions** are in scope (4 options, 1 correct
  answer, per-option feedback). Other question types are out of scope.

## 3. Pipeline

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

Uses [text2qti](https://github.com/gpoore/text2qti) (Python) to generate the
QTI file, run client-side via Pyodide.

## 4. Data model

One object per submitted **attempt** (a student with N attempts has N of
these — attempts are not deduped; see Section 5 for how the review UI
groups them back by student). Fields are grouped by kind — how/when it
arrived (`submission`), the content being reviewed (`question`), and the
TA's in-progress review state (`review`) — since those change at different
times and for different reasons.

```js
{
  id: string,                   // `${sisLoginId}:${attempt}`

  submission: {
    student: {
      name: string,             // as it appears in the Canvas export
      sisLoginId: string,       // gradebook CSV matching (Section 7); groups attempts (src/attempts.js)
      canvasId: string          // Canvas internal user ID; unused during review, kept for later matching
    },
    section: {
      name: string,              // needed later for gradebook CSV matching (Section 7)
      sectionId: string,         // Canvas internal section ID; purpose unconfirmed, kept just in case
      sectionSisId: string       // e.g. "CSC101-F-LEC0101-20269"
    },
    submittedAt: string,        // raw Canvas timestamp, e.g. "2026-05-31 04:00:00 UTC"
    attempt: number             // this row's actual attempt number
  },

  question: {
    bloomLevel: string | null,  // one of Canvas's Bloom taxonomy options; null if unrecognized text (flagged, not guessed)
    keywords: string[],         // 2-4 tags, split from comma-separated input
    stem: string,                // question text, ≤50 words
    responses: { A: string, B: string, C: string, D: string },   // ≤10 words each
    feedback:  { A: string, B: string, C: string, D: string },   // ≤50 words each
    correctAnswer: "A" | "B" | "C" | "D" | null  // null if unrecognized text (flagged, not guessed)
  },

  // Permanent snapshot of `question`'s content fields as first parsed --
  // never mutated. Lets the review UI show what was originally submitted
  // next to whatever's since been edited, and lets `wasEdited` below be a
  // live diff against it rather than a separately-tracked flag.
  original: {
    bloomLevel: string | null,
    keywords: string[],
    stem: string,
    responses: { A: string, B: string, C: string, D: string },
    feedback:  { A: string, B: string, C: string, D: string },
    correctAnswer: "A" | "B" | "C" | "D" | null
  },

  review: {
    grade: {
      points: number | null       // the score earned; pointsPossible is NOT here, see below
    },
    status: "pending" | "accepted" | "rejected",
    wasEdited: boolean          // computed live as `question` differing from `original` in any content field
  }
}
```

`pointsPossible` is **not** part of a question's `grade` — it's a single
value shared by every question, held in `App.svelte`, defaulting to `1`.
Must be non-negative (0 allowed — Canvas supports a 0-point assignment).
Changing it rescales any already-entered grades proportionally (e.g. 0.5/1
becomes 1/2) via [`src/scaleGrades.js`](src/scaleGrades.js), rounded to 2
decimal places, with a confirmation notice — so grades never silently
drift from the new denominator.

### CSV → data model mapping

Implemented in [`src/csv/parseSurveyCsv.js`](src/csv/parseSurveyCsv.js),
mapped by column **position**, not header text (see
[`src/csv/columnLayout.js`](src/csv/columnLayout.js)) — Canvas's header
text/question IDs are inconsistent between exports.

- **Structurally invalid rows** (wrong column count) invalidate the whole
  file — nothing is imported, since there's no safe way to guess column
  meaning in a file whose shape doesn't match a Canvas export at all.
- **A row missing some (not all) of the 12 answer fields** is still
  included, flagged with a `missingFields` warning — the TA can edit or
  grade around it. A row missing **all 12** is excluded (`emptyRows`) —
  nothing to review.
- **Attempts are not deduped** — every valid row becomes its own Question;
  [`src/attempts.js`](src/attempts.js) groups them back by
  `sisLoginId` for the review UI and gradebook export.
- `bloomLevel`/`correctAnswer` normalization are isolated in
  [`fieldNormalization.js`](src/csv/fieldNormalization.js) so they're a
  quick fix if a real export's option text differs from what's assumed
  (unconfirmed — see Section 10).
- `original` is a deep copy of `question`'s initial values, never sharing
  references, so later edits can't mutate it.

### Word-count validation

Flagged (never silently truncated), per the survey's stated limits: stem
≤50 words, each response ≤10 words, each feedback ≤50 words. Shown as
warnings; the TA decides whether to edit.

## 5. Screens

1. **Upload** — file picker for the CSV. Shows a parse summary (rows
   parsed, missing-field/empty-row/word-count warnings) and a "Default
   attempt" picker (First/Latest) for students with multiple attempts.
   "Continue to review queue" is disabled only when there are
   structurally invalid rows or zero valid questions — every other
   warning is non-blocking.
2. **Question Review view** — one row per **student**, not per attempt:
   name, Graded attempt, Bloom level, status, grade. A student with one
   attempt shows it as plain text; more than one shows a dropdown
   ("1 (first)", "2", ..., "N (latest)"), defaulting per the Upload
   screen's setting, changeable per student at any time
   ([`src/attempts.js`](src/attempts.js) resolves the selection). Only the
   selected attempt is displayed/edited/exported for that student — an
   inline warning appears if a *different* attempt is accepted but not
   selected, since only the selected attempt's grade reaches the gradebook
   (Section 7). The row-select button (+/-) expands a student's row in
   place to edit stem/responses/feedback/Bloom level/keywords (each shown
   next to what was originally submitted) and set grade/status
   (Accept disabled until a correct answer is set). Edits live in local
   draft state until Save, Close, or the row is torn down another way
   (e.g. a different row/attempt expands instead) — never lost. Filterable
   by status, applied to each student's selected attempt.
3. **Export** — accepted/rejected/pending counts, a quiz title input, and
   "Download QTI package" (accepted questions only, any attempt) and
   "Download gradebook CSV" (one row per student, using each student's
   selected attempt — Canvas can't carry more than one score per student).
   Both downloads have a live, collapsed-by-default preview built from the
   same functions the download uses, so it can't drift from the real
   output.

## 6. QTI export via text2qti + Pyodide

**Do not hand-build QTI XML.** Drive `text2qti` (pure Python, no compiled
dependencies) directly via Pyodide — no CLI, no filesystem round-trip;
`QTI.zip_bytes()` returns bytes in-memory, crossed to JS via
`pyodide.toJs()`. Confirmed working end-to-end, including a real import
into a Quercus sandbox course — see
[`spikes/text2qti-spike/`](spikes/text2qti-spike/).

Implemented in [`src/qti/`](src/qti/):

- `buildQuizText.js` (pure, unit-tested) — only accepted questions;
  Markdown-special characters backslash-escaped and embedded newlines
  collapsed to one line, so student-submitted text can't corrupt
  text2qti's line-based syntax. One point per question (fixed, not
  configurable — separate from the gradebook-only `pointsPossible`).
- `pyodideRuntime.js` / `generateQtiZip.js` — load Pyodide from CDN,
  install `text2qti` via `micropip`, cache the booted runtime across
  exports (but never cache a failed boot, so a transient error doesn't
  permanently break the page).

Format:

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

**Real-browser-verified**: exported, imported into Quercus, and previewed
successfully with a mix of edited/accepted/rejected questions.

## 7. Gradebook CSV export

Implemented in
[`src/gradebook/buildGradebookCsv.js`](src/gradebook/buildGradebookCsv.js).
Built from scratch (no uploaded template) — every column Canvas matches on
is already captured per student at parse time.

The grade here is for the graded survey assignment itself (Section 1) —
the TA's assessment of the submitted question — which already exists in
the Canvas course. This is unrelated to the QTI package (Section 6), a
*new* quiz built from accepted questions.

- Header: `Student,ID,SIS User ID,SIS Login ID,Integration ID,Section,<score column>`.
  `SIS User ID`/`Integration ID` are always blank (not in the source CSV);
  Canvas still matches on `ID` + `SIS Login ID`.
- The score column's header is a fixed placeholder,
  `"FIXME: copy-paste the cell from a Gradebook export"` — Canvas matches
  by exact header text including the `(<assignment id>)` suffix, which
  this app has no way to know (the source CSV doesn't carry the existing
  assignment's name/ID). The TA replaces it by hand from a real Canvas
  gradebook export before importing.
- Second row is `Points Possible`, holding the shared `pointsPossible`.
- **One row per student**, not per attempt — reduced via
  `selectCanonicalQuestions` (`src/attempts.js`) to whichever attempt is
  selected for that student in the Question Review view. Every student
  gets a row regardless of status; an ungraded student just gets a blank
  score cell (leaves their Canvas grade untouched on import, rather than
  zeroing it).

**Real-browser-verified**: edited a downloaded export with real student
data, uploaded into a live course; Canvas matched roster students
correctly and offered to skip ones not in the course.

## 8. Persistence

Implemented in [`src/persistence/session.js`](src/persistence/session.js).

- **Autosave to `localStorage` only** — no file export/import. Deliberate:
  this data can include sensitive student information, and a file is far
  easier to mishandle than data that never leaves the browser. Persists on
  every commit and on every `pointsPossible`/`statusFilter`/
  `attemptSelection`/`defaultAttempt` change, not on in-progress
  keystrokes.
- **Resume on load**: a saved session shows a "Resume / Start over" prompt
  before Upload — no silent auto-resume.
- **Autosave-failure notice**: a small `role="status"` banner appears if
  an autosave attempt fails, and clears once one succeeds.
- Sessions are schema-versioned; a version mismatch is treated as
  nothing-to-resume rather than guessed at.

## 9. Tech stack

- **Svelte** (via Vite) — no backend needed; plainer reactivity than React
  for this size of app (filterable table, a form, two download buttons).
- **PapaParse** — parses the survey CSV, builds the gradebook CSV.
- **Pyodide** — runs `text2qti` client-side.
- No servers, no runtime network calls beyond the initial CDN loads above.

## 10. Open items

- **Unconfirmed** (no real submission to this survey exists yet):
  - The correct-answer option text is assumed to be literal `A`/`B`/`C`/`D`,
    based on a different quiz in the same Canvas instance, not this survey.
  - What a partial Canvas submission actually looks like — the parser's
    `missingFields`/`emptyRows` handling is untested against one.
  - **TODO**: once a real submission exists, re-run it through
    `parseSurveyCsv` and spot-check before trusting it for grading. Until
    then, `tools/generate_fixture_csv.py` produces a fabricated stand-in
    ([`fixtures/fabricated-survey-export.csv`](fixtures/fabricated-survey-export.csv)).
- Whether per-question point values (vs. a fixed value) are needed for QTI
  export — revisit after initial use.
