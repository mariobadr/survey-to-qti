# survey-to-qti

Client-side tool for reviewing student-submitted Canvas survey questions and exporting the accepted ones as a QTI package for Quercus.
See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the full spec.

## Setup

```
npm install
```

## Running the tests

```
npm test
```

Runs the vitest suite once (`src/csv/__tests__/`) and exits.
Use `npm run dev-test` instead to run vitest in watch mode while iterating.

The CSV parser tests run against the fixture at `fixtures/fabricated-survey-export.csv` — see below for how that file is produced.

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
