import { layout, type Font, type Instruction, type MeasureText, type SheetInput } from './sheet.ts'

/**
 * The canvas adapter for the sheet.
 *
 * Everything about *what* the drawing contains lives in `sheet.ts`; this walks
 * the instruction list and puts it on a 2D context. Keeping the two apart is
 * what lets the drafting rules be tested — jsdom has no canvas, so while this
 * was the only way in, none of them could be reached at all.
 *
 * The context is expected to arrive with the device-pixel-ratio transform
 * already applied, and `w`/`h` are therefore CSS pixels.
 */

const FAMILY = {
  sans: "'Instrument Sans Variable', sans-serif",
  mono: "'Geist Mono Variable', monospace",
}

function fontString(font: Font): string {
  return `${font.weight} ${font.size}px ${FAMILY[font.family]}`
}

function trace(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
}

function draw(ctx: CanvasRenderingContext2D, ins: Instruction) {
  ctx.save()
  switch (ins.op) {
    case 'rect':
      ctx.globalAlpha = ins.fill.alpha ?? 1
      ctx.fillStyle = ins.fill.color
      ctx.fillRect(ins.x, ins.y, ins.w, ins.h)
      break

    case 'path': {
      if (!ins.points.length) break
      if (ins.clip) {
        trace(ctx, ins.clip)
        ctx.closePath()
        ctx.clip()
      }
      trace(ctx, ins.points)
      if (ins.close) ctx.closePath()
      if (ins.fill) {
        ctx.globalAlpha = ins.fill.alpha ?? 1
        ctx.fillStyle = ins.fill.color
        ctx.fill()
      }
      if (ins.stroke) applyStroke(ctx, ins.stroke)
      break
    }

    case 'circle':
      ctx.beginPath()
      ctx.arc(ins.x, ins.y, ins.r, 0, Math.PI * 2)
      if (ins.fill) {
        ctx.globalAlpha = ins.fill.alpha ?? 1
        ctx.fillStyle = ins.fill.color
        ctx.fill()
      }
      if (ins.stroke) applyStroke(ctx, ins.stroke)
      break

    case 'arc':
      ctx.beginPath()
      if (ins.sector) ctx.moveTo(ins.x, ins.y)
      ctx.arc(ins.x, ins.y, ins.r, ins.from, ins.to, ins.ccw)
      if (ins.sector) ctx.closePath()
      if (ins.fill) {
        ctx.globalAlpha = ins.fill.alpha ?? 1
        ctx.fillStyle = ins.fill.color
        ctx.fill()
      }
      if (ins.stroke) applyStroke(ctx, ins.stroke)
      break

    case 'text':
      ctx.globalAlpha = ins.fill.alpha ?? 1
      ctx.fillStyle = ins.fill.color
      ctx.font = fontString(ins.font)
      ctx.letterSpacing = ins.font.tracking ? `${ins.font.tracking}em` : '0em'
      ctx.textAlign = ins.align ?? 'left'
      ctx.textBaseline = ins.baseline ?? 'alphabetic'
      ctx.fillText(ins.text, ins.x, ins.y)
      break
  }
  ctx.restore()
}

function applyStroke(
  ctx: CanvasRenderingContext2D,
  stroke: NonNullable<Extract<Instruction, { op: 'path' }>['stroke']>,
) {
  ctx.globalAlpha = stroke.alpha ?? 1
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width ?? 1
  ctx.lineCap = stroke.cap ?? 'butt'
  ctx.lineJoin = stroke.join ?? 'miter'
  ctx.setLineDash(stroke.dash ?? [])
  ctx.stroke()
}

function render(ctx: CanvasRenderingContext2D, instructions: Instruction[]) {
  for (const ins of instructions) draw(ctx, ins)
}

/**
 * Measuring costs a font assignment per call, so the last one is remembered —
 * a sheet with dimensions on measures a dozen figures in the same font.
 */
function canvasMeasurer(ctx: CanvasRenderingContext2D): MeasureText {
  let applied = ''
  return (text, font) => {
    const spec = fontString(font)
    if (spec !== applied) {
      ctx.font = spec
      applied = spec
    }
    return ctx.measureText(text).width
  }
}

export function paint(ctx: CanvasRenderingContext2D, input: SheetInput) {
  ctx.clearRect(0, 0, input.w, input.h)
  render(ctx, layout(input, canvasMeasurer(ctx)))
}

export type { Ghost, Instruction, Palette, SheetInput } from './sheet.ts'
