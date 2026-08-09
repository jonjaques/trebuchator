import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils.ts'

/**
 * The app's slider: a hairline track with a slide-rule cursor for a handle.
 *
 * Built on the Radix primitive directly rather than on the vendored shadcn
 * wrapper for two reasons. The wrapper renders its thumbs internally, so there
 * is no way to give the `role="slider"` element an accessible name or a
 * value-text — a screen reader would announce a bare number with no idea what
 * it measures or in what unit. And a rounded pill handle belongs to a different
 * design language than the rest of this sheet.
 */
export function DraftSlider({
  className,
  label,
  valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  label: string
  valueText?: string
}) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-px w-full grow bg-rule">
        <SliderPrimitive.Range className="absolute h-px bg-ink-3" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className={cn(
          'group relative block h-3.5 w-[7px] shrink-0 cursor-grab',
          'before:absolute before:inset-y-0 before:left-0 before:w-full before:border-x before:border-ink-2',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-quench',
          'hover:before:border-ink focus-visible:outline-none',
          'focus-visible:before:border-verdigris focus-visible:after:bg-verdigris',
          'active:cursor-grabbing',
        )}
      />
    </SliderPrimitive.Root>
  )
}
