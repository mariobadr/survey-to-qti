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
  This is a static app: `npm run build` produces static files (`dist/`) meant to be hosted as static files (e.g. GitHub Pages) and opened via a URL — no compute, no backend, just static hosting.
  Not opened via double-clicking a local `index.html` file: Vite's build output uses ES module `<script>` tags, which browsers refuse to load over `file://` (confirmed — this blocks with a CORS error). The TA is given a URL to click instead of a local file to double-click, which still satisfies "every action is a click in the browser" below.
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

Fields are grouped by kind — how/when it arrived (`submission`), the
content being reviewed (`question`), and the TA's in-progress review state
(`review`) — rather than flat, since those three groups change at different
times and for different reasons (submission is fixed at parse time,
question is editable during review, review state is written continuously).

```js
{
  id: string,                   // `${sisLoginId}:${attempt}` -- one object per attempt, not per student
                                 // (Planned rework item 6); a student with N attempts has N of these

  submission: {
    student: {
      name: string,             // as it appears in the Canvas export
      sisLoginId: string,       // needed later for gradebook CSV matching (Section 7); also the key
                                 // src/attempts.js groups attempts back together by
      canvasId: string          // Canvas internal user ID; unused during review, kept for later matching
    },
    section: {
      name: string,              // needed later for gradebook CSV matching (Section 7)
      sectionId: string,         // Canvas internal section ID; purpose unconfirmed, kept just in case
      sectionSisId: string       // e.g. "CSC101-F-LEC0101-20269"
    },
    submittedAt: string,        // raw Canvas timestamp, e.g. "2026-05-31 04:00:00 UTC"
    attempt: number             // this row's actual attempt number -- no longer deduped to "the" attempt
                                 // at parse time (Planned rework item 6); see Section 5 for how the
                                 // review UI groups a student's attempts back together
  },

  question: {
    bloomLevel: string | null,  // one of Canvas's Bloom taxonomy options; null if unrecognized text (flagged, not guessed)
    keywords: string[],         // 2-4 tags, split from comma-separated input
    stem: string,                // question text, ≤50 words
    responses: { A: string, B: string, C: string, D: string },   // ≤10 words each
    feedback:  { A: string, B: string, C: string, D: string },   // ≤50 words each
    correctAnswer: "A" | "B" | "C" | "D" | null  // null if unrecognized text (flagged, not guessed)
  },

  // Permanent snapshot of `question`'s content fields as first parsed from
  // the CSV — same shape as `question` above, never mutated after parse.
  // Lets the review UI show the TA what was actually submitted alongside
  // whatever they've since edited, and lets `wasEdited` (below) be computed
  // as a live diff against it rather than tracked as a separate flag.
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

`pointsPossible` is **not** part of a question's `grade` — it's a single value
shared by every question, held once in `App.svelte` state (`pointsPossible`,
committed from a top-level draft input via a "Set" button) and threaded down
read-only to Queue (grade column) and the review view. Editing it lives
outside any one question's draft/commit cycle. TODO: when `pointsPossible`
changes after some `points` have already been entered, consider scaling those
`points` proportionally so grades don't silently become inconsistent with the
new denominator — not implemented.

### CSV → data model mapping

Implemented in [`src/csv/parseSurveyCsv.js`](src/csv/parseSurveyCsv.js). Key
points, based on an actual header export plus behavior observed on a
different quiz in the same Canvas instance (see Section 11 for what's still
unconfirmed):

- **Columns are mapped by position, not by matching header text.** The
  question IDs embedded in Canvas's header text (e.g. `5774576: What level
  of bloom taxonomy...`) have gaps and are not sequential, and
  quoting/whitespace around them is inconsistent between questions (see
  [`src/csv/columnLayout.js`](src/csv/columnLayout.js) for the exact layout).
- First 8 columns are always `name, id, sis_id, section, section_id,
  section_sis_id, submitted, attempt`. Then 12 question blocks, each
  `[answerText, boilerplateScoreColumn]` — the boilerplate column is always
  `1.0` and is ignored. Then 3 trailing columns: `n correct, n incorrect,
  score` (also ignored; these describe the survey's own auto-grading, not
  the question being reviewed).
- **Structurally invalid rows** (wrong column count) are catastrophic — if
  even one row in the file doesn't have the expected column count, **nothing
  in the file is imported**, not just that one row. There's no safe way to
  guess column meaning anywhere in a file whose shape doesn't match a Canvas
  export at all (wrong file selected, or a corrupted export), so the whole
  file is treated as untrustworthy rather than salvaging whichever rows
  happen to still have the right column count. Reported in the upload
  summary as `structurallyInvalidRows`.
- **Missing fields are a warning, not an exclusion.** A row missing one or
  more (but not all) of the 12 question-answer fields still becomes a
  question — the TA can edit the field in during review, or just grade
  accordingly; there's no reason to force that decision at parse time.
  Reported as a `missingFields` warning (row number, student, which fields).
  The only content-based exclusion left is a **completely empty row** — all
  12 question-answer fields blank, meaning nothing was submitted for this
  question at all, so there's nothing to review, edit, or grade. Reported
  separately as `emptyRows`, non-blocking (unlike a structurally invalid
  row).
- **Multiple attempts are not deduped.** Every structurally-valid, non-empty
  row becomes its own Question object, even if a student has more than one
  (Planned rework item 6) — parsing doesn't decide which attempt "counts".
  [`src/attempts.js`](src/attempts.js) groups them back together by
  `sisLoginId` for the review UI and gradebook export (Section 5/7), where
  the TA picks (or a default settles) which single attempt is the one that
  matters for that student.
- `bloomLevel` and `correctAnswer` normalization are each isolated in a
  single small function
  ([`normalizeBloomLevel`](src/csv/fieldNormalization.js),
  [`normalizeCorrectAnswer`](src/csv/fieldNormalization.js)) specifically so
  they're a quick fix if a real export's option text turns out to differ
  from what's assumed (see Section 11 — the correct-answer mapping in
  particular is unconfirmed for this survey).
- `original` (Section 4) is built alongside `question` from the same parsed
  values, but as independent objects/arrays (not shared references), so
  later edits to `question` can never mutate `original` through a shared
  object.

### Word-count validation

Flag (do not silently truncate) violations of the original survey's stated limits when parsing:
- Stem: 50 words max
- Each response: 10 words max
- Each feedback: 50 words max

Show these as warnings in the review UI; let the TA decide whether to edit or leave as-is.

## 5. Screens

1. **Upload** — file picker for the CSV. Parse and show: total rows parsed,
   any rows missing some fields (included anyway, not excluded), any
   completely empty rows (excluded — nothing to review), any word-count
   violations. Do not block on warnings; block only on structurally invalid
   rows. Implementation note: "block" means disabling the "Continue to
   review queue" action, not rejecting the file outright — the parse
   summary is always shown either way. Blocks when there are any
   structurally invalid rows (the file's shape doesn't match a Canvas
   export at all, so nothing in the file is imported — see Section 4) or
   when zero valid questions resulted (nothing to review). Missing-field
   warnings, empty rows, word-count violations, and the other warning types
   never block. Also a "Default attempt" dropdown (First/Latest, defaults to
   First) — which attempt counts as "the" attempt for a student with more
   than one (Planned rework item 6), until the TA picks a different one for
   that specific student in the Question Review view.
2. **Question Review view** — one row per **student** (Planned rework item
   6), not per attempt: student, Graded attempt, Bloom level, status, grade.
   The "Graded attempt" column header carries a tooltip explaining what it
   controls — whichever attempt is selected is the one whose grade reaches
   the gradebook CSV (Section 7), not necessarily whichever is accepted. A
   student with only one attempt shows it as plain text; a student with more
   than one shows a dropdown ("1 (first)", "2", ..., "N (latest)")
   defaulting to whichever the Upload screen's "Default attempt" setting
   picks, changeable per student at any time
   ([`src/attempts.js`](src/attempts.js) resolves the dropdown/default into
   a single selected attempt per student). If any *other* attempt for that
   student is accepted while it isn't selected, an inline warning appears
   next to the dropdown ("⚠ attempt N accepted but not graded") — accepting
   an attempt and selecting it for the gradebook are independent choices,
   and an accepted-but-unselected attempt's grade would otherwise be left
   out of the gradebook CSV silently. Bloom level/status/grade and the
   expanded row always reflect only that student's *currently selected*
   attempt — switching the dropdown is the only way to view or edit a
   different one. Filterable by status (no Bloom-level filter — not useful
   in practice), applied against each student's selected attempt. The
   row-select button shows a +/- icon and expands the student's row in place
   (no separate detail page); only one row is expanded at a time, no
   Next/Previous — the TA clicks whichever row they want next. Switching
   which attempt is selected for an expanded student's row swaps the
   expanded Detail view to that attempt (auto-committing the outgoing
   attempt's draft first, same as collapsing or expanding a different
   student would). The expanded row splits into two panels:
   - **Question panel** — Bloom level and Keywords side by side, then Stem,
     then Responses as a table (correct-answer radio | Response | Feedback
     columns, first narrower than the other two). Every editable field shows
     what the student originally submitted, read-only, above it ("Student
     submitted: ..."; Stem/Response/Feedback also show its word count, since
     those have word limits — Section 4). Accept is disabled until a
     correct answer is set.
   - **Review panel** — Grade (points input next to the read-only "Out of"
     pointsPossible) and Status (Pending/Accept/Reject), side by side.
   - Editing model: fields load into local draft state on expand; nothing
     writes back until commit — Save (stays open), Close (collapses), or
     automatically if the row is torn down any other way (e.g. a different
     row expands instead), so work is never lost. `wasEdited` (Section 4) is
     a live diff against `original`, not a permanent flag.
   - The status filter stays active while a row is expanded and after it
     collapses.
3. **Export** — summary counts (accepted / rejected / pending), a quiz
   title input (defaults to "Reviewed Questions (\<today's date\>)"),
   "Download QTI package" (accepted questions only, disabled with nothing
   accepted; see Section 6), and "Download gradebook CSV" (every parsed
   student regardless of status, always enabled; see Section 7). Each has a
   collapsed-by-default preview the TA can expand before downloading: the
   QTI package's preview is the raw text2qti input text (Section 6); the
   gradebook CSV's preview is a scrollable table, not raw CSV text. Both
   preview the exact same data the download would produce (same build
   functions, just not yet serialized/zipped) and update live as the quiz
   title or `pointsPossible` changes.

### Planned rework (from hands-on TA-perspective feedback)

Six items identified trying Screens 1-3 end to end. All six are done.

1. ~~Merge Queue and Detail into one Question Review view~~ **Done** — see Screen 2 above;
   no more separate detail page, no Next/Previous/working-set navigation.
2. ~~Show the original CSV value next to each editable field~~ **Done** — a permanent
   `original` snapshot (Section 4) is shown read-only above every editable field;
   `wasEdited` is a live diff against it instead of a monotonic flag.
3. ~~Remove the comment field~~ **Done** — no gradebook CSV column exists for it (Section 7).
4. ~~`pointsPossible` becomes a single shared value~~ **Done** — set once in `App.svelte`,
   shown read-only per question. TODO not implemented: rescaling already-entered `points`
   when `pointsPossible` changes.
5. ~~Remove the Bloom-level filter~~ **Done** — not useful in practice; the table column
   stays, just not filterable.
6. ~~Parse and show every attempt per student, not just the earliest~~ **Done** —
   the CSV parser (Section 4) no longer dedups; every attempt becomes its own Question
   object with a composite `id`. [`src/attempts.js`](src/attempts.js) groups them back
   by student for the Question Review view (Screen 2) and the gradebook CSV (Section
   7). The open questions this item left behind are now resolved:
   - **Composite id**: `${sisLoginId}:${attempt}`.
   - **Data model stays flat** (one Question per attempt, same shape as before) rather
     than nesting attempts under a student record -- grouping happens at render/export
     time instead, so every other consumer (QTI export, existing tests) didn't need to
     change shape.
   - **"Accepted" is still per-attempt, not per-student**: each attempt is reviewed,
     graded, and accepted/rejected independently. Multiple accepted attempts from the
     same student can all end up in the QTI package (Section 6) -- they're distinct
     questions.
   - **Which attempt's grade reaches the gradebook**: whichever one the TA selected
     for that student in the Question Review view (or the Upload screen's default, if
     they never picked one) -- see Section 7.

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

### De-risking spike: confirmed working

Spike completed and validated end-to-end, including a real import into a
Quercus sandbox course. See
[`spikes/text2qti-spike/`](spikes/text2qti-spike/) for the runnable page and
full findings.

- **No interactive prompt to work around.** The prompt described above only
  lives in `text2qti`'s CLI entry point (`cmdline.main()`), gated behind a
  tty check that's never true in Pyodide. The spike bypasses `main()`
  entirely and drives the library directly (`Config`, `Quiz`, `QTI` from
  `text2qti.config` / `text2qti.quiz` / `text2qti.qti`) — no argv, no
  filesystem config seeding needed. `Config.load()` degrades gracefully
  (warns, doesn't raise) when it can't write `~/.text2qti.bespon` in
  Pyodide's virtual FS.
- **`micropip.install("text2qti")` resolves cleanly.** Its two dependencies
  (`bespon`, `markdown`) are pure Python, no compiled-extension issues.
- **No filesystem round-trip needed.** `QTI.zip_bytes()` returns the zip as
  in-memory `bytes` directly; cross the Python→JS boundary with
  `pyodide.toJs()` and wrap in a `Blob` for download.
- **Confirmed real-world import.** The generated zip was imported into a
  Quercus sandbox course and loaded correctly as a quiz.

Not yet exercised by the spike — carried forward as test cases for full QTI
export in [Section 10, step 6](#10-build-order-recommended).

## 7. Gradebook CSV export

Implemented in
[`src/gradebook/buildGradebookCsv.js`](src/gradebook/buildGradebookCsv.js),
which exports `buildGradebookRows` (plain row arrays) and `buildGradebookCsv`
(the same rows, serialized) separately, so the Export screen's table preview
renders the exact rows a download would contain without round-tripping
through CSV text.

The grade being exported here is the grade for the graded survey assignment
itself (Section 1, step 2) — i.e. the TA's assessment of the quality of the
question a student ideated and submitted. That assignment already exists in
the Canvas course; it's what produced the CSV this app parses in the first
place (Section 4). This is entirely separate from the QTI package (Section
6): that's a *new* quiz built from the accepted questions, for later use,
and has nothing to do with any individual student's grade.

Canvas's gradebook CSV importer matches rows using `Student`, `ID`,
`SIS User ID`, `SIS Login ID`, and `Section` columns, plus one column per
assignment containing the score. Confirmed against a real one-column export
from Quercus (see Changelog) — no uploaded template needed: every column
Canvas matches on is already captured per student at parse time (Section 4's
`submission.student`/`submission.section`), so the CSV is built from
scratch.

- Header row: `Student,ID,SIS User ID,SIS Login ID,Integration ID,Section,<score column>`.
  `SIS User ID` and `Integration ID` are always blank — not present anywhere
  in the Canvas survey export this app parses, and Canvas still matches rows
  fine on `ID` + `SIS Login ID` alone.
- The score column's header is a fixed placeholder,
  `"FIXME: copy-paste the cell from a Gradebook export"`. Canvas matches the
  score column by an exact header match including the `(<assignment id>)`
  suffix it appends, but the survey-submission CSV this app parses (Section
  4) doesn't carry the assignment's name or Canvas ID anywhere in it — so
  there's nothing to build an exact, Canvas-matching header from. The TA
  replaces the placeholder by hand with the real header cell, copy-pasted
  from an actual Canvas gradebook export of that survey assignment, before
  importing.
- Second row is `Points Possible` (Canvas's own required row), holding the
  shared `pointsPossible` value (Section 4).
- One row per **student**, not per attempt (Planned rework item 6) —
  Canvas has no way to carry more than one score for the same student in
  the same column. [`src/attempts.js`](src/attempts.js)'s
  `selectCanonicalQuestions` reduces `questions` down to exactly one per
  student first, using the same attempt the TA selected (or defaulted to)
  in the Question Review view (Screen 2), so the score that reaches the
  gradebook always matches whichever attempt the TA was actually looking
  at — never both, and never silently the wrong one.
- Every student gets a row **regardless of review status** — one not yet
  graded just gets a blank score cell, so re-exporting later after
  finishing review doesn't require starting over. A blank score cell leaves
  that student's Canvas grade untouched on import rather than zeroing it.
- Output: a downloadable CSV, ready to re-upload via Canvas's
  Grades → Import.

## 8. Persistence

Implemented in [`src/persistence/session.js`](src/persistence/session.js).

- **Autosave to `localStorage` only** — no export/import, no file ever
  written anywhere else. Deliberate: this data can include sensitive
  student information, and a file (e.g. a JSON backup) is far easier to
  mishandle — synced to cloud storage, emailed, left in Downloads — than
  data that never leaves the browser's storage for this site.
  `localStorage` over IndexedDB: plenty of headroom for text-only review
  data, and a synchronous API needs no wrapper library. Persists on every
  commit (Save/Close/auto-commit-on-unmount all flow through `App.svelte`'s
  `handleSave`) and on every `pointsPossible`/`statusFilter`/
  `attemptSelection`/`defaultAttempt` change, via a `$effect` in
  `App.svelte` — not on in-progress keystrokes inside an open (uncommitted)
  row, since those never touch shared state until commit anyway. If an
  autosave attempt fails (quota, private browsing, unavailable), an
  unobtrusive banner tells the TA rather than failing silently — see below.
- **Resume on load**: if a saved session exists, the TA sees a "Resume
  previous session? / Start over" prompt before Upload — no silent
  auto-resume, and no separate confirmation dialog either, since choosing
  "Start over" *is* the confirmation that discards the old session.
- **Autosave-failure notice**: a small, non-blocking banner (fixed corner
  of the screen, `role="status"` so screen readers announce it politely
  without interrupting) appears whenever the most recent autosave attempt
  failed, and disappears again automatically once one succeeds — no modal,
  no dismiss button, since it's just informational and self-corrects.
- Saved sessions are schema-versioned (`schemaVersion` in the stored JSON);
  a version mismatch is treated as nothing-to-resume rather than guessed
  at, so a data model change can't silently misread an old session. Bumped
  to 2 for Planned rework item 6 (composite `id`s, no attempt dedup, plus
  the new `attemptSelection`/`defaultAttempt` fields) — a schema-1 session
  is simply treated as nothing to resume rather than reinterpreted.

## 9. Tech stack

- **Svelte** (via Vite) for the review-queue UI. Decided over React: nothing
  in this spec needs React's component ecosystem — no rich datepickers,
  drag-and-drop, charting, or React-only SDKs, just a filterable table, a
  form, and two download buttons — so React's larger ecosystem doesn't buy
  anything here, and Svelte's plainer reactivity (assignment instead of
  `useState`/`useEffect`) means less boilerplate for this size of app. Built
  with Vite for the dev server and `.svelte`-file compilation; the
  production build (`npm run build`) is static files with no backend/compute
  (Section 2's constraint), but must be hosted (e.g. GitHub Pages) rather
  than opened via a local `file://` URL — see Section 2 for why.
- **PapaParse** — parses the survey CSV on import and builds the gradebook
  CSV on export
- **Pyodide** — runs `text2qti` client-side for QTI generation
- **JSZip** — only needed if any additional client-side zipping is required
  outside of what `text2qti`/Pyodide already produces
- No servers, no external network calls at runtime beyond the initial CDN
  loads of the above libraries

## 10. Build order (recommended)

1. ~~Pyodide + text2qti de-risking spike (see Section 6) — confirm the
   riskiest dependency works before investing in the rest~~ **Done** — see
   Section 6 and [`spikes/text2qti-spike/`](spikes/text2qti-spike/).
2. ~~CSV parser + data model, tested against a hand-written sample CSV~~
   **Done** — see Section 4 and [`src/csv/`](src/csv/). No real submission
   exists yet, so tested against a fabricated fixture
   ([`tools/generate_fixture_csv.py`](tools/generate_fixture_csv.py)) rather
   than a hand-written one. Its original attempt-dedup logic (assumed one
   attempt survives per student) was later removed entirely — see "Planned
   rework" item 6 (Section 5), now done.
3. ~~Review queue + detail UI (no persistence yet)~~ **Done** — Screens 1-3
   of Section 5, all still without persistence (that's step 5):
   - Upload screen (Screen 1) — see
     [`src/components/Upload.svelte`](src/components/Upload.svelte). Wired
     to `parseSurveyCsv`; shows the parse summary and blocks continuing only
     on structurally invalid rows or zero valid questions, per Section 5.
   - Queue/list view (Screen 2) — see
     [`src/components/Queue.svelte`](src/components/Queue.svelte). Table of
     student/Bloom level/status/grade, filterable by status (the
     Bloom-level filter was later removed, "Planned rework" item 5);
     clicking a row opens the detail view with that filtered set as
     the navigation working set (see Screen 3 below).
   - Detail/review view (Screen 3) — see
     [`src/components/Detail.svelte`](src/components/Detail.svelte). See
     Section 5 for the full list of decisions made building this (editable
     Bloom level/keywords, three-way status with Accept gating, frozen
     working-set navigation, draft-until-commit editing, content-only
     monotonic `wasEdited`).
4. ~~Rework Queue/Detail into the Question Review view per "Planned rework"~~
   **Done** — all six items (Section 5) are done, including item 6 (parse
   and show every attempt per student), tackled last since it was the
   biggest and reopened part of step 2 (the CSV parser's attempt-dedup
   logic, since removed entirely).
5. ~~Autosave (localStorage)~~ **Done** — see Section 8 and
   [`src/persistence/session.js`](src/persistence/session.js).
6. ~~Full QTI export~~ **Done, real-browser-verified** — see Section 6 and
   [`src/qti/`](src/qti/). `buildQuizText.js` (pure, fully
   unit-tested) generates the quiz text from accepted questions only, with
   Markdown-special characters backslash-escaped and embedded newlines
   collapsed to a single line, so quotes/`*`/`_`/backticks/etc. in
   student-submitted text can't corrupt the format's own syntax or
   accidentally start a new question/choice line — the case the spike
   explicitly hadn't exercised. Multi-question quizzes are exercised too
   (one block per accepted question). `pyodideRuntime.js` /
   `generateQtiZip.js` wire this into the same Pyodide + text2qti pipeline
   the spike validated (CDN-loaded, not bundled), with the Pyodide
   boot/install cached across repeated exports in the same page session.
   Per-question points are a fixed 1, not configurable (per the Section 6
   placeholder decision) — the `pointsPossible` value stays scoped to the
   gradebook export (Section 7) only. LaTeX/`subprocess` code paths are
   never invoked since nothing in this pipeline calls them.
   **Verified**: exported a real QTI package (with 3 accepted questions
   edited during review and 2 rejected, confirming only accepted ones made
   it through), imported it into Quercus, and previewed the quiz
   successfully.
7. ~~Gradebook CSV export~~ **Done, real-browser-verified** — see Section 7
   and [`src/gradebook/buildGradebookCsv.js`](src/gradebook/buildGradebookCsv.js)
   (pure, fully unit-tested). Built from a real one-column gradebook export
   the TA supplied, so no uploaded template is needed — every student
   already parsed (Section 4) gets a row, blank-scored if not yet graded.
   **Verified**: edited a downloaded export with real student information
   and uploaded it into a live course; Canvas matched existing roster
   students correctly and offered to skip ones not in the course. The score
   column's header started out as the quiz title, but that's wrong — this
   grade belongs to the graded survey assignment that already exists in the
   course (Section 1), not to the new quiz the QTI package builds, and the
   survey-submission CSV this app parses doesn't carry that existing
   assignment's name or Canvas ID anywhere in it. So it's now a `FIXME`
   placeholder the TA replaces by hand with the real header cell, copy-pasted
   from a Canvas gradebook export of that survey assignment.

## 11. Open items still to resolve once real files are available

- **Resolved (with caveats):** column layout of the real Canvas survey CSV
  export is now known from an actual header export (see Section 4's "CSV →
  data model mapping"). Two things remain unconfirmed because no real
  submission to this survey exists yet:
  - The correct-answer question's option text (assumed to be the literal
    letters `A`/`B`/`C`/`D`) is based on a different quiz in the same Canvas
    instance, not this survey.
  - What a partial Canvas submission looks like in the export is unknown —
    the parser includes any row missing one or more (but not all) of the 12
    answer fields as a question with a warning (Section 4), but this is
    untested against a real partial submission.
  - **TODO:** once a real submission to this survey exists, re-run the
    actual Canvas export through `parseSurveyCsv` and manually spot-check
    the result (especially `bloomLevel`/`correctAnswer` normalization and
    the missing-field/empty-row handling above) before trusting it for
    actual grading. Until then, `tools/generate_fixture_csv.py` produces a
    fabricated stand-in export for parser development/testing — see
    `fixtures/fabricated-survey-export.csv` and its test coverage in
    `src/csv/__tests__/`.
- Whether per-question point values (vs. a fixed value) are needed — revisit
  after initial use

## Changelog

- 2026-07-16 — Completed the Pyodide + text2qti de-risking spike (Section
  6). Confirmed non-interactive operation, successful `micropip` install,
  and a valid QTI zip that imports correctly into a Quercus sandbox course.
  Moved spike code to `spikes/text2qti-spike/`. Carried forward untested
  cases (multi-question quizzes, per-question points, special characters,
  confirming LaTeX/subprocess code paths stay dormant) as test cases for
  Section 10 step 6.
- 2026-07-16 — Built the Step 2 CSV parser (`src/csv/`) against real column
  layout knowledge from an actual Canvas header export (Section 4). No real
  submission exists yet, so `tools/generate_fixture_csv.py` generates a
  clearly-labeled fabricated stand-in CSV (byte-matched header, deliberately
  messy rows: malformed keywords, an incomplete row, a duplicate attempt,
  an over-word-limit stem) that the parser is tested against (20 passing
  vitest cases). Data model (Section 4) restructured into `submission` /
  `question` / `review` groups and extended with `section`, `sectionId`,
  `sectionSisId`, `submittedAt`, and `attempt`. Every function (exported or
  not) documented with JSDoc. Added a TODO (Section 11) to re-run the parser
  against the first real export and spot-check it before trusting it for
  grading.
- 2026-07-16 — Decided Svelte (via Vite) over React for the review UI
  (Section 9): nothing in this spec needs React's ecosystem, and Svelte's
  plainer reactivity fits a small filterable-table-and-form app better.
  Added Biome for linting/formatting (`npm run lint` / `lint-fix`).
- 2026-07-16 — Scaffolded the Vite + Svelte app (`index.html`, `src/main.js`,
  `src/App.svelte`, `vite.config.js`; `npm run dev` / `build` / `preview`).
  Verifying the build (not just running it) surfaced a real conflict with
  Section 2: Vite's ES module output can't be opened via `file://`
  (confirmed — blocked by CORS). Decided to require hosted static files
  (e.g. GitHub Pages) instead of double-click-to-open; Section 2 updated to
  match.
- 2026-07-16 — Built the Upload screen (Section 5, Screen 1) —
  `src/components/Upload.svelte`, wired to `parseSurveyCsv`. Verified
  end-to-end in a real browser (not just unit tests): uploaded the
  fabricated fixture and confirmed every summary number and warning message
  against known values, and confirmed a structurally invalid file disables
  "Continue to review queue" while a valid-but-warning-laden file doesn't.
  Clarified in Section 5 what "block" means in practice (disables
  Continue, doesn't reject the file) and exactly which conditions trigger
  it. Added a `biome.json` override disabling `noUnusedImports` /
  `noUnusedVariables` for `*.svelte` files — Biome 2.5's Svelte support
  doesn't yet track script variables that are only referenced from the
  template, so it was flagging genuinely-used state/props as dead code.
- 2026-07-16 — Added component tests for the Upload screen
  (`src/components/__tests__/Upload.test.js`, `@testing-library/svelte` +
  `@testing-library/user-event` + `@testing-library/jest-dom`, jsdom
  environment). These are committed, repeatable tests distinct from the
  ad hoc real-browser checks used during development — they cover the
  same ground (fixture parse summary, Continue enabled/disabled, dedup
  behavior) but don't replace real-browser verification for issues that
  only show up there (e.g. the `file://` CORS issue in Section 2).
  Two real snags fixed along the way, not just this project's config:
  Svelte 5 resolves to its server build under vitest unless
  `resolve.conditions: ["browser"]` is forced (`vite.config.js`, gated on
  `process.env.VITEST` so `dev`/`build` are unaffected), and
  `import.meta.url` isn't a real `file://` URL under jsdom, so the fixture
  path is resolved from `process.cwd()` instead in this test file.
- 2026-07-16 — Built the Queue/list view (Section 5, Screen 2) —
  `src/components/Queue.svelte`. Table of student/Bloom level/status/grade,
  filterable by status and Bloom level (reuses `BLOOM_LEVELS` from
  `src/csv/fieldNormalization.js` rather than duplicating the list).
  Clicking a student's name selects that question; `App.svelte` shows a
  placeholder until the detail view (Screen 3) exists, with a "Back to
  queue" action. Verified end-to-end in a real browser: uploaded the
  fabricated fixture, confirmed filtering by Bloom level and by status
  (including the empty-results case) produces the right row counts, and
  confirmed the select/back round-trip.
- 2026-07-16 — Added component tests for the Queue/list view
  (`src/components/__tests__/Queue.test.js`), same stack as the Upload
  tests. Uses hand-built minimal Question objects (not the fixture, which
  is always ungraded fresh off the parser) so both `formatGrade` branches
  — "points / pointsPossible" and points-only — get real coverage. Covers
  unfiltered rendering, filtering by Bloom level, by status, the
  no-matches empty state, and `onSelect` firing with the right id.
- 2026-07-16 — Built the Detail/review view (Section 5, Screen 3) —
  `src/components/Detail.svelte` — completing Section 10 step 3. Several
  product decisions not fully pinned down by the original spec text were
  resolved before building (see Section 5 for the final rules): grade
  points *and* points-possible are both per-question fields; status is an
  explicit three-way Pending/Accept/Reject control gated on a correct
  answer being set; Next/Previous navigate a working set frozen at the
  moment the TA entered the detail view, not a live-recomputed filter
  match; every field loads into local draft state, committed either via
  Save or silently on any navigation; `wasEdited` is content-only and
  monotonic. `Queue.svelte` updated to make `statusFilter`/`bloomFilter`
  bindable (so `App.svelte` can restore them on "Back to queue" instead of
  resetting) and to pass the filtered id list to `onSelect`.
  Verified end-to-end in a real browser, which caught two real bugs unit
  tests alone wouldn't have: (1) a Svelte 5 compiler warning
  (`state_referenced_locally`) from reading a `$props()` value directly
  into `$state(...)` initializers — expected here, since `App.svelte`
  remounts `Detail` fresh per question via `{#key}`, but the compiler
  can't see that guarantee; fixed by wrapping the one-time snapshot read in
  `untrack()` rather than suppressing the warning. (2) The "unsaved
  changes" indicator never cleared after a successful Save, because it
  compared the draft against a snapshot frozen at mount instead of the
  live (post-save) question data — content-change detection needs *two*
  different reference points depending on purpose: the live question for
  "do I currently have unsaved changes," and the session-start snapshot
  for "was anything changed this session" (which `wasEdited`'s monotonic
  OR-in logic needs). Added `src/components/__tests__/Detail.test.js` (11
  tests) covering the draft/save model, the Accept gate, `wasEdited`
  scope and monotonicity, and Previous/Next/Back all committing before
  navigating.
- 2026-07-16 — Reworked Queue/Detail into a single Question Review view per
  hands-on TA-perspective feedback ("Planned rework" items 1-5 above; item 6
  not started). Queue rows now expand in place (no separate Detail page, no
  Next/Previous); added a permanent `original` snapshot to the data model
  (Section 4) so the view can show what the student submitted next to each
  editable field, which also let `wasEdited` become a live diff instead of a
  separately-tracked flag; `pointsPossible` became a single shared value set
  once in `App.svelte`; removed the grade comment field and the Bloom-level
  filter.
- 2026-07-16 — Iterated on the Question Review view's layout based on
  further hands-on feedback: split it into a "Question" panel (Bloom
  level/Keywords side by side, Stem, Responses) and a "Review" panel (Grade
  and Status side by side); laid out Responses as a correct-answer/
  Response/Feedback table instead of a tall stack; relabeled "Original" to
  "Student submitted" and "Response A"/"Feedback A" to "Final version"
  (less repetition — the table's row/column headers already say which
  letter and field); added each original submission's word count next to
  Stem/Response/Feedback; added a +/- expand icon to each row.
- 2026-07-16 — Built Section 10 step 5 (Section 8: Persistence) —
  `src/persistence/session.js`, plus a small resume prompt in `App.svelte`.
  Decided localStorage over IndexedDB (Section 8 left this open); autosave
  persists on commit, not on in-progress keystrokes; resuming a saved
  session requires an explicit choice ("Resume" / "Start over") rather than
  silently auto-resuming or silently discarding. Originally also built a
  manual JSON export/import backup path (Section 8 had called for one), but
  removed it once flagged as a real privacy concern for a tool handling
  student data — a downloaded file is far easier to end up somewhere it
  shouldn't (cloud-synced Downloads folder, email, etc.) than data that
  never leaves the browser's own storage. `localStorage` autosave stays;
  Section 8 no longer mentions a JSON path at all. Added a `role="status"`
  banner that appears if an autosave attempt fails (`saveSession` now
  returns a boolean) and clears itself once one succeeds. Added
  `src/persistence/__tests__/session.test.js` and `src/__tests__/App.test.js`
  (new — App.svelte's first test file) covering the resume prompt,
  Resume/Start over, autosave-after-continue, and the failure banner.
- 2026-07-16 — Built Section 10 step 6 (full QTI export) — new
  `src/qti/` module (`buildQuizText.js`, `pyodideRuntime.js`,
  `generateQtiZip.js`) and a new Export screen
  (`src/components/Export.svelte`, reachable via a "Go to export" button
  in `App.svelte`'s toolbar). `buildQuizText.js` is the part most worth
  getting right and is fully unit-tested: only `review.status ===
  "accepted"` questions are included; every Markdown-special character
  (per Markdown.pl/Python-Markdown's standard escapable set) is
  backslash-escaped in stem/response/feedback text, and embedded newlines
  are collapsed to a single line, so arbitrary student-submitted text
  can't corrupt text2qti's own line-based syntax — the case Section 6
  flagged as untested by the spike. Per-question points are a fixed 1
  (not configurable in this build, confirmed separate from the
  gradebook-only `pointsPossible`). `pyodideRuntime.js` reuses the exact
  CDN URL and Config/Quiz/QTI-direct approach the spike validated, caches
  the booted runtime across repeated exports, and doesn't cache a failed
  attempt (so a transient network error doesn't permanently break the
  rest of the page session). Added
  `src/qti/__tests__/{buildQuizText,pyodideRuntime,generateQtiZip}.test.js`
  and `src/components/__tests__/Export.test.js`, all with Pyodide mocked
  out — this environment can't run real Pyodide/WASM against the real CDN.
  Real-browser-verified: exported, imported into Quercus, and previewed
  successfully with a mix of edited-and-accepted and rejected questions.
- 2026-07-16 — Built gradebook CSV export (Section 7, step 10.7):
  `src/gradebook/buildGradebookCsv.js` (pure, fully unit-tested), wired into
  a second "Download gradebook CSV" button on the Export screen. Scope
  changed from Section 7's original plan (merge into a TA-uploaded gradebook
  template) after seeing a real one-column export from Quercus: every column
  Canvas matches rows on is already available per student from parsing
  (Section 4), so the CSV is built from scratch instead — no upload step
  needed. Includes every parsed student regardless of review status (blank
  score cell if not yet graded, so Canvas leaves that student's grade
  untouched on import rather than zeroing it). Real-browser-verified: edited
  a downloaded export with real student information and uploaded it into a
  live Canvas course, which matched roster students correctly and offered to
  skip ones not in the course. That test surfaced a mistake in the score
  column's header: it started out as the quiz title, but that's wrong —
  this grade belongs to the graded survey assignment that already exists in
  the course and produced the CSV this app parses in the first place
  (Section 1/4), not to the new quiz the QTI package (Section 6) builds from
  accepted questions, and those are unrelated. The survey-submission CSV
  doesn't carry that existing assignment's name or Canvas ID anywhere in it,
  so there's nothing to build an exact, Canvas-matching header from here.
  Changed to a `FIXME` placeholder the TA replaces by hand with the real
  header cell, copy-pasted from a Canvas gradebook export of that survey
  assignment.
- 2026-07-16 — Added a preview to each export on the Export screen (Section
  5, Screen 3), collapsed by default: the QTI package's is the raw text2qti
  input text (Section 6); the gradebook CSV's is a scrollable HTML table,
  not raw CSV text (Section 7). Both are `$derived` from the same pure build
  functions the actual downloads call (`buildQuizText`, and a new
  `buildGradebookRows` split out of `buildGradebookCsv` so the table can
  render plain row arrays instead of re-parsing CSV text), so a preview can
  never drift from what a download would actually contain, and both update
  live as the quiz title or `pointsPossible` change.
- 2026-07-16 — Loosened `parseSurveyCsv`'s row-exclusion rules (Section 4):
  a row missing one or more (but not all) of the 12 question-answer fields
  is no longer excluded — it's a normal question with a `missingFields`
  warning, since a TA can just edit the field in or grade accordingly, and
  forcing that decision at parse time served no purpose. The only
  content-based exclusion left is a completely empty row (all 12 fields
  blank, nothing to review at all), now reported separately as `emptyRows`.
  Also tightened structurally-invalid handling: previously a bad-column-count
  row was dropped but every other row in the file still got imported; now,
  if even one row doesn't match the expected column count, **nothing in the
  file is imported** — there's no way to trust the rest of a file whose
  shape doesn't match a Canvas export at all. `collectWarnings` no longer
  fires `unexpectedBloomLevel`/`unexpectedCorrectAnswer`/
  `unexpectedKeywordCount` for a field that's simply missing (already
  covered by `missingFields`), to avoid double-reporting the same gap.
  Regenerated the fabricated fixture
  (`tools/generate_fixture_csv.py`/`fixtures/fabricated-survey-export.csv`)
  with a new completely-empty row (Grace Green) to cover the `emptyRows`
  path, and updated its comment on the pre-existing missing-field row (Erin
  Evans) to reflect that it's included, not excluded.
- 2026-07-16 — Completed "Planned rework" item 6: stopped dropping a
  student's extra attempts. `parseSurveyCsv` (Section 4) no longer dedups —
  every attempt becomes its own Question object with a composite
  `${sisLoginId}:${attempt}` id. Added
  [`src/attempts.js`](src/attempts.js) (pure, fully unit-tested) to group
  attempts back together by student and resolve which one is "selected" for
  a student, given the TA's explicit choice if any or a default otherwise.
  Queue.svelte (Section 5, Screen 2) now renders one row per student instead
  of one per attempt, with a new Attempt column: plain text for a single
  attempt, a dropdown ("1 (first)", "2", ..., "N (latest)") for more than
  one. Every displayed column and the expanded Detail view reflect only the
  selected attempt; switching the dropdown while a row is expanded swaps
  Detail to the newly selected attempt, auto-committing the outgoing one's
  draft first (same mechanism as switching to a different student's row).
  Upload.svelte (Screen 1) gained a "Default attempt" (First/Latest)
  dropdown, threaded down through `App.svelte` as `defaultAttempt`, used
  whenever a student has no explicit per-student selection yet
  (`attemptSelection`, also threaded through `App.svelte`, mutated in place
  by Queue). Both are autosaved and resumed like every other piece of
  session state (Section 8; schema bumped to 2, since a schema-1 session's
  `questions` are deduped with plain, non-composite ids and aren't safe to
  reinterpret under the new code). The gradebook CSV (Section 7) can only
  carry one score per student, so `Export.svelte` reduces `questions` down
  to one per student via `selectCanonicalQuestions` before building it —
  whichever attempt is selected for that student is the one whose grade
  reaches Canvas. The QTI export (Section 6) needed no changes: accept/
  reject is still per-attempt, and multiple accepted attempts from the same
  student legitimately become multiple distinct quiz questions. Since
  accepting an attempt and selecting it for the gradebook are independent
  choices, an accepted-but-unselected attempt's grade could otherwise be
  left out of the gradebook silently -- addressed by renaming the Attempt
  column to "Graded attempt" (with a tooltip explaining what it controls)
  and adding an inline warning next to the dropdown whenever a student has
  an accepted attempt that isn't the selected one.
