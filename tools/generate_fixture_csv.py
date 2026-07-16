#!/usr/bin/env python3
"""Generate a FABRICATED Canvas survey export CSV for parser testing.

No real submission to this survey exists yet (a preview-student test
submission didn't appear in the export). This script produces a CSV that
matches the real export's column layout and quoting quirks exactly -- based
on an actual header row plus behavioral observations from a different quiz
in the same Canvas instance -- but every row of student data below is made
up. Do not treat this file's output as real Canvas data.

Once a real submission exists, re-run the actual export through the parser
and spot-check the result before trusting it for grading (see
PROJECT_SPEC.md, Section 11).

Usage: python3 tools/generate_fixture_csv.py > fixtures/fabricated-survey-export.csv
"""

import csv
import sys

# Exact header text for each of the 12 survey questions, reproduced
# character-for-character (including embedded newlines and inconsistent
# whitespace/spacing after the "NNNNNNN:" question-id prefix) from a real
# header export. Question IDs have gaps and are NOT sequential -- that's
# faithfully preserved here, not a typo. csv.writer's default quoting
# reproduces the original file's mixed quoted/unquoted fields on its own,
# since fields are only quoted when they contain a comma, quote, or newline.
QUESTION_HEADERS = [
    "5774576:     What level of bloom taxonomy will the question assess?\n",
    "5774577: Write 2-4 keywords (i.e. tags) associated with the question. "
    'Separate the keywords using a comma (i.e. ",")',
    "5774591:     Write the Question Stem (50 words max). Text-only, do not "
    "include any image files.\n",
    "5774592:     Write response A (10 words max)\n",
    "5774594:     Write the feedback associated with response A (50 words max)\n",
    "5774597:     Write response B (10 words max)\n",
    "5774598: Write the feedback associated with response B (50 words max)",
    "5774599:     Write response C (10 words max)\n",
    "5774600: Write the feedback associated with response C (50 words max)",
    "5774601: Write response D (10 words max)",
    "5774602:     Write the feedback associated with response D (50 words max)\n",
    "5774603: Which of the responses is the correct answer?",
]

HEADER_ROW = (
    ["name", "id", "sis_id", "section", "section_id", "section_sis_id", "submitted", "attempt"]
    + [cell for header in QUESTION_HEADERS for cell in (header, "1.0")]
    + ["n correct", "n incorrect", "score"]
)


def student_row(
    *,
    name,
    canvas_id,
    sis_id,
    section,
    section_id,
    section_sis_id,
    submitted,
    attempt,
    bloom_level,
    keywords,
    stem,
    response_a,
    feedback_a,
    response_b,
    feedback_b,
    response_c,
    feedback_c,
    response_d,
    feedback_d,
    correct_answer,
    n_correct=1,
    n_incorrect=0,
    score=1.0,
):
    """Build one fabricated CSV data row matching HEADER_ROW's column layout.

    Keyword-only args map 1:1 to the survey's metadata and 12 question-answer
    fields; each answer field is paired with a "1.0" boilerplate column, and
    n_correct/n_incorrect/score fill the 3 trailing survey-grading columns.

    Returns a flat list of cell values, in column order, ready to hand to
    csv.writer.writerow / writerows.
    """
    answers = [
        bloom_level,
        keywords,
        stem,
        response_a,
        feedback_a,
        response_b,
        feedback_b,
        response_c,
        feedback_c,
        response_d,
        feedback_d,
        correct_answer,
    ]
    return (
        [name, canvas_id, sis_id, section, section_id, section_sis_id, submitted, attempt]
        + [cell for answer in answers for cell in (answer, "1.0")]
        + [n_correct, n_incorrect, score]
    )


def words(n, word="word"):
    """Build a space-separated string of n distinct filler words (word0, word1, ...).

    Used to pad a stem past the 50-word limit for the word-count-violation
    fixture row, without hand-typing a long sentence.
    """
    return " ".join(f"{word}{i}" for i in range(n))


FABRICATED_ROWS = [
    # Clean row.
    student_row(
        name="Alice Anderson",
        canvas_id="100001",
        sis_id="fab00001",
        section="LEC0101",
        section_id="200001",
        section_sis_id="CSC101-F-LEC0101-20269",
        submitted="2026-05-31 04:00:00 UTC",
        attempt=1,
        bloom_level="Remember",
        keywords="recursion, base case",
        stem="What is the base case of a recursive function?",
        response_a="A case that calls itself",
        feedback_a="Not quite -- that's the recursive case.",
        response_b="A case that stops the recursion",
        feedback_b="Correct.",
        response_c="A case that only runs once",
        feedback_c="Not necessarily true for all recursive functions.",
        response_d="A syntax error",
        feedback_d="No, this is a valid concept, not an error.",
        correct_answer="B",
    ),
    # Clean row, different Bloom level.
    student_row(
        name="Bob Brown",
        canvas_id="100002",
        sis_id="fab00002",
        section="LEC0101",
        section_id="200001",
        section_sis_id="CSC101-F-LEC0101-20269",
        submitted="2026-05-31 04:05:00 UTC",
        attempt=1,
        bloom_level="Apply",
        keywords="loops, iteration",
        stem="Which loop construct is best suited for iterating a known number of times?",
        response_a="while loop",
        feedback_a="Possible, but not the most idiomatic choice here.",
        response_b="for loop",
        feedback_b="Correct.",
        response_c="do-while loop",
        feedback_c="Less common for a known iteration count.",
        response_d="goto loop",
        feedback_d="Not a real loop construct.",
        correct_answer="B",
    ),
    # Messy: malformed keywords (only 1, expected 2-4). Otherwise complete
    # and valid -- should be a warning, not a rejection.
    student_row(
        name="Carol Chen",
        canvas_id="100003",
        sis_id="fab00003",
        section="LEC0102",
        section_id="200002",
        section_sis_id="CSC101-F-LEC0102-20269",
        submitted="2026-05-31 04:10:00 UTC",
        attempt=1,
        bloom_level="Understand",
        keywords="onlyonekeyword",
        stem="What does the acronym API stand for?",
        response_a="Application Programming Interface",
        feedback_a="Correct.",
        response_b="Applied Program Instruction",
        feedback_b="Not a real term.",
        response_c="Automated Process Integration",
        feedback_c="Not a real term.",
        response_d="Application Process Index",
        feedback_d="Not a real term.",
        correct_answer="A",
    ),
    # Messy: duplicate attempts for the same student (David Davis). Two rows
    # below share sis_id=fab00004; attempt 1 should be kept, attempt 2
    # dropped and logged.
    student_row(
        name="David Davis",
        canvas_id="100004",
        sis_id="fab00004",
        section="LEC0102",
        section_id="200002",
        section_sis_id="CSC101-F-LEC0102-20269",
        submitted="2026-05-31 04:15:00 UTC",
        attempt=1,
        bloom_level="Analyze",
        keywords="sorting, complexity",
        stem="What is the average-case time complexity of quicksort?",
        response_a="O(n)",
        feedback_a="Too fast for a comparison sort on average.",
        response_b="O(n log n)",
        feedback_b="Correct.",
        response_c="O(n^2)",
        feedback_c="That's the worst case, not the average case.",
        response_d="O(log n)",
        feedback_d="Too fast; that's not achievable for sorting.",
        correct_answer="B",
    ),
    student_row(
        name="David Davis",
        canvas_id="100004",
        sis_id="fab00004",
        section="LEC0102",
        section_id="200002",
        section_sis_id="CSC101-F-LEC0102-20269",
        submitted="2026-05-31 09:40:00 UTC",
        attempt=2,
        bloom_level="Analyze",
        keywords="sorting, complexity, quicksort",
        stem="What is the worst-case time complexity of quicksort?",
        response_a="O(n)",
        feedback_a="Too fast for the worst case.",
        response_b="O(n log n)",
        feedback_b="That's the average case, not the worst case.",
        response_c="O(n^2)",
        feedback_c="Correct.",
        response_d="O(log n)",
        feedback_d="Too fast; that's not achievable for sorting.",
        correct_answer="C",
    ),
    # Messy: incomplete row (Erin Evans) -- feedback for D is blank. Should
    # be flagged and excluded from the valid question set, not guessed at.
    student_row(
        name="Erin Evans",
        canvas_id="100005",
        sis_id="fab00005",
        section="LEC0101",
        section_id="200001",
        section_sis_id="CSC101-F-LEC0101-20269",
        submitted="2026-05-31 04:20:00 UTC",
        attempt=1,
        bloom_level="Evaluate",
        keywords="testing, coverage",
        stem="Which metric measures the proportion of code executed by a test suite?",
        response_a="Cyclomatic complexity",
        feedback_a="That measures code structure, not test execution.",
        response_b="Code coverage",
        feedback_b="Correct.",
        response_c="Code churn",
        feedback_c="That measures how often code changes.",
        response_d="Test velocity",
        feedback_d="",  # missing -- makes this row incomplete
        correct_answer="B",
    ),
    # Messy: stem exceeds the 50-word limit. Complete and structurally
    # valid -- should be a warning, not a rejection.
    student_row(
        name="Frank Foster",
        canvas_id="100006",
        sis_id="fab00006",
        section="LEC0102",
        section_id="200002",
        section_sis_id="CSC101-F-LEC0102-20269",
        submitted="2026-05-31 04:25:00 UTC",
        attempt=1,
        bloom_level="Create",
        keywords="design, architecture",
        stem="In the context of software architecture design, " + words(55) + "?",
        response_a="A monolithic architecture",
        feedback_a="Possible, but usually not the best fit here.",
        response_b="A microservices architecture",
        feedback_b="Correct.",
        response_c="A single script",
        feedback_c="Too simple for the scenario described.",
        response_d="A spreadsheet",
        feedback_d="Not a software architecture.",
        correct_answer="B",
    ),
]


def main():
    """Write HEADER_ROW followed by FABRICATED_ROWS to stdout as CSV."""
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(HEADER_ROW)
    writer.writerows(FABRICATED_ROWS)


if __name__ == "__main__":
    main()
