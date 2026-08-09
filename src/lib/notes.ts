import { createContext, use } from 'react'

/**
 * Whether the rails print their explanatory notes.
 *
 * Every hint in this app used to live only in a `title` attribute: a phone
 * cannot show one at all, and a screen reader announces one only if the reader
 * has opted into it. So most of what the app knows about its own domain — what
 * a hanger length is, what "best case" re-cocks, why the beam bending figure is
 * the one to size an axle from — was unreachable to a good share of the people
 * it was written for, on a product whose stated job is half teaching.
 *
 * The fix is not a tooltip that works better. Every hint is now always in the
 * DOM and, where it describes a control, wired to it with `aria-describedby`;
 * this flag only decides whether it is painted or `sr-only`. That makes it an
 * annotation layer over the rails, which is exactly what dimensions and angles
 * already are over the sheet — and it is switched the same way, from a toggle.
 *
 * Defaulted to `true` here so a component rendered without the provider (every
 * test does this) still shows what it knows.
 */
export const NotesContext = createContext(true)

export function useNotes(): boolean {
  return use(NotesContext)
}
