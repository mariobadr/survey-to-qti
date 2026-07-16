# survey-to-qti

Client-side tool for reviewing student-submitted Canvas survey questions and exporting the accepted ones as a QTI package for Quercus.
See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the full spec.

## Setup

```
npm install
```

## Running the app

```
npm run dev
```

Starts the Vite dev server.
`npm run build` produces the static `dist/` output; `npm run preview` serves that build locally to sanity-check it.

Since `vite` is a devDependency, its CLI can also be invoked directly instead of through an npm script, e.g. `npx vite`, `npx vite build`, `npx vite preview` — these are exactly what the scripts above run.

## Running the tests

```
npm test
```

Runs the vitest suite once and exits.
Use `npm run dev-test` instead to run vitest in watch mode while iterating.

Two kinds of tests live side by side: plain-Node tests for the CSV parser (`src/csv/__tests__/`), and component tests for the Svelte UI (`src/components/__tests__/`) using `@testing-library/svelte` in a jsdom environment.
Component test files opt into jsdom individually with a `// @vitest-environment jsdom` comment at the top, so the parser tests keep running under the (faster, closer-to-real) default Node environment.

The CSV parser tests run against the fixture at `fixtures/fabricated-survey-export.csv` — see below for how that file is produced.

These are unit/component tests, not end-to-end tests — they don't catch issues that only show up in a real browser (e.g. the `file://` CORS issue documented in PROJECT_SPEC.md Section 2). Manual verification in an actual browser is still worthwhile for UI changes.

## Linting

```
npm run lint
```

Checks formatting, import sorting, and lint rules with [Biome](https://biomejs.dev/).
Use `npm run lint-fix` to apply safe fixes automatically.

## Generating the fabricated CSV fixture

No real Canvas survey submission exists yet, so the parser is developed and tested against a fabricated stand-in export instead.
[`tools/generate_fixture_csv.py`](tools/generate_fixture_csv.py) produces `fixtures/fabricated-survey-export.csv`, matching the real export's column layout and header quirks but with entirely made-up student data.
This includes a few deliberately messy rows: malformed keywords, an incomplete row, a duplicate attempt, and an over-word-limit stem.

```
python3 tools/generate_fixture_csv.py > fixtures/fabricated-survey-export.csv
```

Run this whenever you change the fixture data in `tools/generate_fixture_csv.py`.
The checked-in CSV under `fixtures/` is generated output, not hand-edited, so regenerate it and commit the result rather than editing the CSV directly.
The tests read the checked-in file, so regenerate before running `npm test` if you've touched the generator.

Once a real submission to the survey exists, re-run the actual Canvas export through the parser and spot-check the result before trusting it for grading.
See PROJECT_SPEC.md Section 11.
