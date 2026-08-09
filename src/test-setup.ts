/**
 * jsdom shims for the browser APIs Radix primitives reach for.
 *
 * jsdom implements no layout engine, so ResizeObserver and the pointer-capture
 * methods simply do not exist. Radix's slider measures its own thumb on mount
 * and captures the pointer on drag, so without these every component test dies
 * in a layout effect before it can assert anything. Stubs are enough: the tests
 * here assert values and ARIA state, never pixel geometry.
 */

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
