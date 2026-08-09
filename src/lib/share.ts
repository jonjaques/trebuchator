import { presetById } from './treb/presets.ts'

/**
 * The machine in the address bar.
 *
 * One query parameter carrying a built-in preset's id, which is the whole of
 * what can honestly be shared. The two machines it deliberately refuses are
 * refused for different reasons, and both matter:
 *
 * A machine the builder **saved** lives in their own browser's storage — the
 * product has no backend by constraint — so its id names nothing on anyone
 * else's screen. A machine they have **edited** is thirty-odd numbers that would
 * have to be serialised into the URL to survive the trip, and a link that
 * silently loads a *different* machine from the one the sender was looking at is
 * worse than no link at all. So the parameter is removed the moment the machine
 * stops being a preset, rather than left behind pointing at the machine they
 * started from.
 *
 * Every function here takes the href rather than reading `window.location`, so
 * the rule about what is shareable can be asserted without a DOM.
 */

export const MACHINE_PARAM = 'm'

/** The preset a link names, if it names one that still exists. */
export function presetFromUrl(href: string): string | null {
  const id = new URL(href).searchParams.get(MACHINE_PARAM)
  return id && presetById(id) ? id : null
}

/** `href` with the parameter set to a shareable machine, or with it removed. */
export function withMachine(href: string, presetId: string | null): string {
  const url = new URL(href)
  if (presetId && presetById(presetId)) url.searchParams.set(MACHINE_PARAM, presetId)
  else url.searchParams.delete(MACHINE_PARAM)
  return url.toString()
}

/** A link to this machine, or null when there is nothing honest to link to. */
export function shareUrl(presetId: string | null, href: string): string | null {
  if (!presetId || !presetById(presetId)) return null
  return withMachine(href, presetId)
}
