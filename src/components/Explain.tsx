import { CircleHelp } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { cn } from '@/lib/utils.ts'

/**
 * The long answer, on a heading that has room for a glyph and not a paragraph.
 *
 * A popover rather than a tooltip, and the distinction is the whole point: a
 * tooltip is a mouse affordance that a phone can never open, and this product's
 * second job is teaching someone standing over a half-built machine holding a
 * phone. Anything a reader might actually need is opened by a tap.
 *
 * It is the third tier of explanation, not a replacement for the other two. The
 * notes layer prints what a control measures under every row; a `Tip` names an
 * icon; this carries the paragraph that neither has room for — why a rule of
 * thumb exists, what the number is for at the bench, what to do about it.
 */
export function Explain({
  title,
  children,
  className,
}: {
  /** Names the thing being explained. Also the popover's own heading. */
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${title.toLowerCase()}`}
          /* `Section` puts this inside a `<summary>`. The browser does not fold
             a details element when the click lands on interactive content
             inside its summary, so that case is already safe — but the click
             still bubbles, and this sits beside headings that have handlers of
             their own. Opening the help must never also do something else.
             `preventDefault` is not the tool: Radix reads it off the trigger and
             would skip the toggle, so the popover would never open. */
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'tap-target relative shrink-0 rounded-sm p-px text-ink-3 transition-colors hover:text-verdigris aria-expanded:text-verdigris',
            className,
          )}
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(21rem,calc(100vw-1.5rem))] gap-0 p-0"
      >
        <h4 className="stencil rule-b px-3 py-2 text-ink">{title}</h4>
        <div className="body space-y-2 px-3 py-2.5 text-ink-2">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
