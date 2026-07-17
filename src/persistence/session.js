const STORAGE_KEY = "survey-to-qti:session";

// Bumped whenever the shape of a stored session changes -- lets loadSession
// refuse a session from an incompatible version instead of silently
// misinterpreting it. Bumped to 2 for Planned rework item 6: Question `id`
// is now composite (sisLoginId:attempt) and attempts are no longer deduped
// at parse time, so a schema-1 session's `questions` (deduped, plain-id)
// isn't safe to reinterpret under the new code.
const SCHEMA_VERSION = 2;

/**
 * @typedef {object} Session
 * @property {object[]} questions - Question objects (Section 4's data model).
 * @property {number | null} pointsPossible - The shared points-possible value.
 * @property {string} statusFilter - The Queue's active status filter.
 * @property {Record<string, number>} attemptSelection - TA-chosen attempt
 *   numbers per student (Planned rework item 6, src/attempts.js), keyed by
 *   sisLoginId. A student with no entry here uses `defaultAttempt` instead.
 * @property {"first" | "latest"} defaultAttempt - Which attempt counts as
 *   "the" attempt for a student who has more than one and no explicit
 *   `attemptSelection` entry yet, chosen on the Upload screen.
 */

/**
 * @param {Session} session
 * @returns {object} A plain, JSON-safe, versioned representation of `session`.
 */
function toStorable(session) {
  return {
    schemaVersion: SCHEMA_VERSION,
    questions: session.questions,
    pointsPossible: session.pointsPossible,
    statusFilter: session.statusFilter,
    attemptSelection: session.attemptSelection,
    defaultAttempt: session.defaultAttempt,
  };
}

/**
 * @param {unknown} data - A parsed JSON value from localStorage.
 * @returns {Session | null} `null` if `data` isn't a well-formed session of
 *   the current schema version.
 */
function fromStorable(data) {
  if (
    !data ||
    typeof data !== "object" ||
    data.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(data.questions)
  ) {
    return null;
  }
  return {
    questions: data.questions,
    pointsPossible: data.pointsPossible ?? null,
    statusFilter: data.statusFilter ?? "all",
    attemptSelection: data.attemptSelection ?? {},
    defaultAttempt: data.defaultAttempt ?? "first",
  };
}

/**
 * Autosave the current session to localStorage. Doesn't throw on failure
 * (quota exceeded, private browsing, localStorage unavailable) -- callers
 * aren't required to handle an error, but can check the return value to
 * let the TA know autosave isn't working (e.g. an unobtrusive banner).
 *
 * @param {Session} session
 * @returns {boolean} Whether the save succeeded.
 */
export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStorable(session)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a previously autosaved session, if one exists and matches the
 * current schema version.
 *
 * @returns {Session | null}
 */
export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : fromStorable(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Discard any autosaved session (e.g. the TA chose to start over rather
 * than resume).
 */
export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort; see saveSession's doc comment.
  }
}
