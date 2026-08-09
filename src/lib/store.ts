/**
 * Durable local state.
 *
 * The product has no backend by constraint, so "saved" means this browser and
 * nothing else. That is a real limitation and the copy around these stores says
 * so rather than implying a sync that does not exist.
 *
 * Every read is defensive, for two reasons that have nothing to do with each
 * other. `localStorage` is not merely empty in some private modes — the getter
 * itself throws, so an unguarded read at module scope takes the whole page down
 * before React mounts. And its contents are user-editable text that an older
 * version of this app may have written in a different shape, so anything parsed
 * out of it is untrusted input, not a value of type `T`. A store that cannot be
 * read is treated as absent; losing a saved list is bad, refusing to start is
 * worse.
 */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exhausted or storage denied. There is nothing useful to tell the
    // reader here — the alternative is an error toast every time they nudge a
    // slider — so the write is dropped and the session carries on in memory.
  }
}

/** A stable id for a locally-created record. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}
