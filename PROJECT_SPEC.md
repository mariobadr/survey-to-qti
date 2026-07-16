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
  id: string,                   // == submission.student.sisLoginId; one graded survey submission per student

  submission: {
    student: {
      name: string,             // as it appears in the Canvas export
      sisLoginId: string,       // needed later for gradebook CSV matching (Section 7)
      canvasId: string          // Canvas internal user ID; unused during review, kept for later matching
    },
    section: {
      name: string,              // needed later for gradebook CSV matching (Section 7)
      sectionId: string,         // Canvas internal section ID; purpose unconfirmed, kept just in case
      sectionSisId: string       // e.g. "CSC101-F-LEC0101-20269"
    },
    submittedAt: string,        // raw Canvas timestamp, e.g. "2026-05-31 04:00:00 UTC"
    attempt: number             // the attempt number kept after dedup (see below) — always the minimum
                                 // attempt value seen for that student, i.e. their first attempt
  },

  question: {
    bloomLevel: string | null,  // one of Canvas's Bloom taxonomy options; null if unrecognized text (flagged, not guessed)
    keywords: string[],         // 2-4 tags, split from comma-separated input
    stem: string,                // question text, ≤50 words
    responses: { A: string, B: string, C: string, D: string },   // ≤10 words each
    feedback:  { A: string, B: string, C: string, D: string },   // ≤50 words each
    correctAnswer: "A" | "B" | "C" | "D" | null  // null if unrecognized text (flagged, not guessed)
  },

  review: {
    grade: {
      points: number | null,
      pointsPossible: number | null,  // PLANNED CHANGE: becomes a single value shared by
                                       // every question, not per-question — see "Planned
                                       // rework" below
      comment: string                 // PLANNED CHANGE: to be removed entirely — see
                                       // "Planned rework" below
    },
    status: "pending" | "accepted" | "rejected",
    wasEdited: boolean          // true if TA modified any field from the original submission
  }
}
```

PLANNED CHANGE (see "Planned rework" below): a permanent `original` snapshot of the
content fields (`stem`/`responses`/`feedback`/`correctAnswer`/`bloomLevel`/`keywords`) as
first parsed, kept alongside `question` and never mutated — today there's no persisted
original to compare against, only `wasEdited`'s boolean flag.

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
- **Structurally unparseable rows** (wrong column count) are excluded
  entirely and reported in the upload summary — this is the only case that
  should ever silently drop a row's worth of data, since there's nothing
  sensible to map it to.
- **Incomplete rows**: all 12 question-answer fields must be non-empty for a
  row to become a question. Rows failing this are excluded from `questions`
  but reported by row number and student in the parse summary — never
  silently dropped or guessed at, since it's unknown what an incomplete
  Canvas survey submission actually means (see Section 11).
- **Duplicate attempts**: rows are grouped by `sisLoginId`; if a student has
  more than one complete, structurally-valid row, only the one with the
  minimum `attempt` value is kept. Every drop is logged in the parse summary
  (`type: "duplicateAttemptDropped"`), never silent.
- `bloomLevel` and `correctAnswer` normalization are each isolated in a
  single small function
  ([`normalizeBloomLevel`](src/csv/fieldNormalization.js),
  [`normalizeCorrectAnswer`](src/csv/fieldNormalization.js)) specifically so
  they're a quick fix if a real export's option text turns out to differ
  from what's assumed (see Section 11 — the correct-answer mapping in
  particular is unconfirmed for this survey).

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
   Implementation note: "block" means disabling the "Continue to review
   queue" action, not rejecting the file outright — the parse summary is
   always shown either way. Blocks when there are any structurally invalid
   rows (the file's shape doesn't match a Canvas export at all, so nothing
   can be safely mapped) or when zero valid questions resulted (nothing to
   review). Incomplete rows, word-count violations, and the other warning
   types never block.
2. **Queue / list view** — table of all submissions: student, Bloom level,
   status, grade. Filterable by status and Bloom level. Click a row to open
   the detail view.
3. **Detail / review view** — one question at a time:
   - Editable stem, four responses, four feedback fields
   - Correct-answer selector
   - Also editable, despite not being in the original bullet list: Bloom
     level (dropdown) and keywords (comma-separated text) — no reason they
     should be locked when everything else is editable
   - Grade input: both points *and* points-possible are per-question fields
     (the CSV never supplies a ceiling — see Section 4), plus a comment
   - Status: an explicit three-way Pending / Accept / Reject control
     (Section 4's data model has three states, not two) — Accept is
     disabled whenever the correct-answer selector is unset, since an
     accepted question with no correct answer would produce a broken QTI
     export later (Section 6); nothing else blocks Accept
   - Next / Previous navigate a *frozen* snapshot of whichever questions
     matched the Queue's filters at the moment the TA clicked in — editing
     a question mid-review so it no longer matches those filters doesn't
     remove it from Next/Previous for the rest of that session
   - Editing model: every field (content and grade/status/comment) loads
     into local draft state on open; nothing writes back to the shared
     question data until commit — either the explicit Save button, or
     silently on Next/Previous/Back-to-queue (so navigating never loses
     work, and Save is really just a manual checkpoint)
   - `wasEdited` (Section 4) is computed from content fields only (stem,
     responses, feedback, correct answer, Bloom level, keywords) — grading
     and accept/reject never set it. It's monotonic: once a question has
     been edited from its original submission, later saving it back
     unchanged doesn't un-flag it
   - Returning to the queue restores whatever status/Bloom-level filters
     were active, rather than resetting to "All"
4. **Export** — summary counts (accepted / rejected / pending), two actions:
   - "Download QTI package" (accepted questions only)
   - "Download gradebook CSV" (all graded submissions)

### Planned rework (from hands-on TA-perspective feedback, not yet implemented)

Trying Screens 1-3 end to end (all built per Section 10 step 3) surfaced changes to make
before continuing further. Screen 1 (Upload) is fine as-is; nothing below touches it. Item
5 is done; items 1-4 are settled decisions not yet implemented; item 6 (all attempts, not
just one) is a bigger, not-fully-designed change — see its own note on scope.

1. **Merge Queue and Detail into one screen, called the Question Review view — no more
   separate "page."** Instead of clicking a row to navigate to a separate detail view
   (today: `App.svelte` swaps `<Queue>` out for `<Detail>`), clicking a student expands
   their row in place within the table, showing the same fields Detail currently shows.
   No "move to next row" affordance survives this merge — no auto-advance, no Next/Previous
   equivalent at all, confirmed.
   Impact: **removes Next/Previous navigation and the frozen-working-set mechanism** built
   for it (the "Next / Previous navigate a *frozen* snapshot..." bullet above, and the
   `workingSetIds`/`{#key}`-remount machinery in `App.svelte`) — there's no longer a
   separate page to navigate between.
2. **Show the original CSV value next to the editable field, not just an edited/not-edited
   flag.** Right now `wasEdited` (Section 4) is a single boolean with no way to see *what*
   changed. The detail view should show, per content field, both the original submitted
   value (as a read-only label) and the current editable value (the text field already
   shown).
   Impact: requires the data model to retain a **permanent, unmutated copy of the original
   parsed submission** (see the `original` note added to Section 4) — today the only
   "original" reference is `Detail.svelte`'s local `opened` snapshot, which is ephemeral
   and reset on every (re)mount, never meant to survive across sessions. A persisted
   `original` would also let `wasEdited` become a simple live diff against it, replacing
   the monotonic OR-based computation built specifically to work around not having one.
3. **Remove the comment field from the grade panel.** There's no mechanism to get a
   comment into Canvas's gradebook CSV import (Section 7's column list is Student/ID/SIS
   User ID/SIS Login ID/Section plus one score column per assignment — no comment column),
   so a comment typed here would go nowhere. Remove `review.grade.comment` from the data
   model and drop the comment textarea from the detail view.
4. **`pointsPossible` becomes a single fixed value, not a per-question field, edited in one
   place.** Reverses an earlier decision (see Changelog) — "per-question entry" was picked
   when this was first asked about, but that was based on a misunderstanding; every
   question should be graded out of the same denominator. Resolved: it's an editable field
   near the top of the (merged) Question Review view — set once there, not per question —
   and shown read-only within each individual question, so the TA always sees the
   denominator without being able to change it from inside a specific question. `points`
   (the score earned) stays editable per-question as before; only `pointsPossible` changes.
   Note this is a different "points" concept from Section 11's "whether per-question point
   values are needed" item — that one is about Section 6's QTI-export points-per-question
   (the accepted question's weight in the real Canvas quiz), a separate setting from this
   review-grade `pointsPossible`.
5. ~~**Remove the Bloom-level filter from the Queue/Question Review view.**~~ **Done** —
   not useful in practice; dropped the dropdown and the filtering logic behind it in
   [`src/components/Queue.svelte`](src/components/Queue.svelte). The status filter stays;
   the Bloom level table column is unaffected (still shown, just not filterable).
6. **Parse and show every attempt, not just the earliest one — bigger change, not fully
   designed yet.** Currently `parseSurveyCsv` drops every attempt but the earliest per
   student (Section 4's "Duplicate attempts" rule) and logs what it dropped. Instead, every
   complete, structurally-valid attempt should be parsed and shown, grouped under the
   student — e.g. each attempt as a "subrow" under a parent student row in the Question
   Review view — and the TA chooses which attempt (if any) to accept, rather than the
   parser silently picking the earliest one for them.
   This is bigger than items 1-5 and touches work already marked done, not just planned
   work:
   - **Reopens Section 10 step 2 (CSV parser), not just step 4.** The parser's dedup logic
     (`src/csv/parseSurveyCsv.js`, the `duplicateAttemptDropped` warning type, the
     `attempt` field's "kept after dedup" framing in Section 4) all assume one row survives
     per student — all of that needs revisiting, not just the UI.
   - **`id` can no longer be `== submission.student.sisLoginId`** (Section 4) once a
     student can have multiple entries — needs a composite key (e.g. sisLoginId + attempt)
     or a synthetic id.
   - **Whether the data model itself groups by student** (an array of students, each with
     an array of attempts) **or stays flat** (one array of attempt-questions, grouped only
     in the UI layer by `sisLoginId`) isn't decided.
   - **What "accepted" means across multiple attempts from the same student isn't decided**
     — can more than one attempt from the same student be accepted at once, or should the
     UI warn/prevent that once one is already accepted? Not specified.
   - **Section 7's gradebook export** matches one grade per student; with multiple
     attempts, which attempt's grade counts isn't decided.

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
- **PapaParse** — CSV parsing (survey export and gradebook template)
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
   than a hand-written one. **Partially reopened by step 4** — the
   attempt-dedup logic here assumes one attempt survives per student; see
   "Planned rework" item 6 (Section 5).
3. ~~Review queue + detail UI (no persistence yet)~~ **Done** — Screens 1-3
   of Section 5, all still without persistence (that's step 5):
   - Upload screen (Screen 1) — see
     [`src/components/Upload.svelte`](src/components/Upload.svelte). Wired
     to `parseSurveyCsv`; shows the parse summary and blocks continuing only
     on structurally invalid rows or zero valid questions, per Section 5.
   - Queue/list view (Screen 2) — see
     [`src/components/Queue.svelte`](src/components/Queue.svelte). Table of
     student/Bloom level/status/grade, filterable by status and Bloom
     level; clicking a row opens the detail view with that filtered set as
     the navigation working set (see Screen 3 below).
   - Detail/review view (Screen 3) — see
     [`src/components/Detail.svelte`](src/components/Detail.svelte). See
     Section 5 for the full list of decisions made building this (editable
     Bloom level/keywords, three-way status with Accept gating, frozen
     working-set navigation, draft-until-commit editing, content-only
     monotonic `wasEdited`).
4. Rework Queue/Detail into the Question Review view per "Planned rework"
   (Section 5) — not started. Doing this before step 5 (Autosave) rather
   than after, since building autosave against a UI/data model that's about
   to change (merged Queue+Detail, persisted `original` snapshot, dropped
   `grade.comment`, non-per-question `pointsPossible`, no Bloom-level
   filter) would mean redoing autosave work too. Includes reopening parts
   of step 2 (the CSV parser) that assumed one attempt survives per
   student — see "Planned rework" item 6, the biggest and least-designed
   piece of this step.
5. Autosave (localStorage/IndexedDB)
6. Full QTI export (wire the reviewed/accepted data into the text2qti
   pipeline validated in step 1). In addition to normal accepted-question
   flows, cover these cases the spike didn't exercise:
   - Multi-question quizzes (spike only built a single question)
   - Per-question point values, once/if that becomes configurable (see
     Section 11)
   - Special characters in stems/options/feedback (quotes, markdown
     metacharacters like `*`/`_`/backticks, non-ASCII text) — confirm they
     survive the text2qti-format serialization without corrupting the
     format's own syntax
   - Confirm LaTeX/math-rendering code paths (`--pandoc-mathml`,
     `run_code_blocks`) are never invoked, since they shell out via
     `subprocess`, which doesn't exist in Pyodide — this project's plain
     multiple-choice format shouldn't need them, but the export builder
     should not accidentally trigger them
7. Gradebook CSV merge/export (needs a real gradebook CSV sample to finalize
   column handling)

## 11. Open items still to resolve once real files are available

- **Resolved (with caveats):** column layout of the real Canvas survey CSV
  export is now known from an actual header export (see Section 4's "CSV →
  data model mapping"). Two things remain unconfirmed because no real
  submission to this survey exists yet:
  - The correct-answer question's option text (assumed to be the literal
    letters `A`/`B`/`C`/`D`) is based on a different quiz in the same Canvas
    instance, not this survey.
  - What an incomplete/partial Canvas submission looks like in the export is
    unknown — the parser currently treats any row missing one or more of the
    12 answer fields as incomplete and excludes it from review, but this is
    untested against a real partial submission.
  - **TODO:** once a real submission to this survey exists, re-run the
    actual Canvas export through `parseSurveyCsv` and manually spot-check
    the result (especially `bloomLevel`/`correctAnswer` normalization and
    the incomplete-row handling above) before trusting it for actual
    grading. Until then, `tools/generate_fixture_csv.py` produces a
    fabricated stand-in export for parser development/testing — see
    `fixtures/fabricated-survey-export.csv` and its test coverage in
    `src/csv/__tests__/`.
- Exact column layout of a real Canvas gradebook export CSV, to finalize the
  merge logic in Section 7
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
- 2026-07-16 — Trying Screens 1-3 end to end surfaced four changes, captured
  as "Planned rework" (Section 5) but not yet implemented: merge Queue and
  Detail into one screen (row expands in place, dropping Next/Previous and
  the frozen-working-set navigation built for it); show the original CSV
  value alongside each editable field, not just the `wasEdited` boolean
  (needs a permanent `original` snapshot in the data model — Section 4 —
  which would also let `wasEdited` become a live diff instead of the
  monotonic OR-based computation); drop `review.grade.comment` entirely,
  since Section 7's gradebook CSV import has no comment column for it to
  reach; and reverse the "per-question `pointsPossible`" decision from
  earlier today back to a single value shared by all questions, shown
  read-only in the detail view rather than edited there. Section 10's
  build order updated: this rework is now step 4, ahead of Autosave (now
  step 5), so autosave isn't built against a data model/UI about to
  change.
- 2026-07-16 — Follow-up to the above, resolving two open questions and
  adding two more items to "Planned rework" (Section 5): confirmed no
  "move to next row" affordance survives the Queue/Detail merge (item 1)
  — no auto-advance at all; confirmed `pointsPossible` (item 4) is edited
  in one place near the top of the merged view (now named the Question
  Review view) and shown read-only per question. New: (5) drop the
  Bloom-level filter, it's not useful in practice; (6) parse and show
  every attempt per student instead of silently keeping only the
  earliest, with the TA choosing which to accept — flagged as
  meaningfully bigger and not fully designed yet (composite id scheme,
  flat-vs-grouped data model, cross-attempt accept semantics, and which
  attempt's grade reaches the gradebook are all still open). This item
  also reopens part of Section 10 step 2 (the CSV parser's attempt-dedup
  logic), not just step 4 — step 2 annotated accordingly.
- 2026-07-16 — Implemented "Planned rework" item 5 (Bloom-level filter
  removal), the first and easiest of the six items. Removed the filter
  dropdown, its `bloomFilter` bindable prop, and the filtering logic from
  `Queue.svelte`; removed the corresponding state/binding from
  `App.svelte`. The Bloom level table column is untouched. Updated
  `Queue.test.js` (dropped the Bloom-filter test; the empty-state test
  now reaches zero matches via status alone, rendering a two-question
  subset rather than combining two filters, since only one filter exists
  now) and the empty-state copy ("filters" → "filter").
