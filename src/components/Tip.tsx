import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'

/**
 * The name an icon-only control cannot show.
 *
 * A replacement for `title`, which this app leaned on in about thirty places and
 * which is the wrong control in every one of them: the browser's tip waits a
 * second, cannot be set in the sheet's own type, and is read out by some screen
 * readers *on top of* the `aria-label` that is already there. This one is
 * immediate and drafted like everything else.
 *
 * The trigger is `asChild`, so the control keeps its own element and its own
 * `aria-label` — the tooltip adds a description, never a second name.
 *
 * Touch is deliberately unchanged: Radix does not open a tooltip on a tap,
 * because a tap is an activation. So nothing a reader on a phone *needs* may
 * live here — that is what `Explain` and the notes layer are for. A tip repeats
 * what the glyph already means; it never carries the only copy of something.
 */
export function Tip({
  children,
  text,
  side = 'top',
}: {
  children: React.ReactNode
  /** No text, no tooltip — the child is returned untouched. Callers whose hint
   *  is conditional (the notes layer prints its own) can wrap unconditionally. */
  text?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  if (!text) return children
  return (
    /* The provider is here rather than once at the root, which is what the
       shadcn instructions say to do. Radix's `Tooltip` *throws* without one, so
       rooting it means every component test that happens to render a labelled
       control dies in a context lookup pointing at a file six directories away.
       Nesting providers is supported, and the only thing a shared one buys is
       the grouped `skipDelayDuration` — which is worth nothing at
       `delayDuration: 0`, and zero is right for a bar of adjacent icon chips
       that a reader sweeps along to find a control. */
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} className="body max-w-[15rem] px-2 py-1.5">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
