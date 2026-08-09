import { describe, expect, it } from 'vitest'
import { presetFromUrl, shareUrl, withMachine } from './share.ts'
import { PRESETS } from './treb/presets.ts'

const HERE = 'https://trebuchator.app/'

describe('sharing a machine', () => {
  it('links every machine in the list', () => {
    for (const p of PRESETS) {
      const href = shareUrl(p.id, HERE)
      expect(href).not.toBeNull()
      expect(presetFromUrl(href!)).toBe(p.id)
    }
  })

  it('refuses a machine the recipient could not possibly load', () => {
    // A saved machine's id names a row in *this* browser's storage; an edited
    // one is not a preset at all. Neither has anything to link to.
    expect(shareUrl('saved-1712345678901', HERE)).toBeNull()
    expect(shareUrl(null, HERE)).toBeNull()
  })

  it('drops the parameter rather than leaving it pointing at the wrong machine', () => {
    // The failure this prevents: load Warwolf, change the sling, copy the
    // address bar, and send someone a link that loads Warwolf.
    const shared = withMachine(HERE, 'warwolf')
    expect(presetFromUrl(shared)).toBe('warwolf')
    expect(presetFromUrl(withMachine(shared, null))).toBeNull()
    expect(presetFromUrl(withMachine(shared, 'saved-1712345678901'))).toBeNull()
  })

  it('ignores a machine that no longer exists', () => {
    // Links outlive builds. An id that has been renamed or dropped opens the
    // default machine rather than an empty sheet.
    expect(presetFromUrl(`${HERE}?m=trebuchet-of-theseus`)).toBeNull()
    expect(presetFromUrl(HERE)).toBeNull()
  })

  it('leaves the rest of the address alone', () => {
    const href = withMachine(`${HERE}sheet?utm=x#top`, 'siege')
    expect(href).toContain('utm=x')
    expect(href).toContain('#top')
    expect(href).toContain('/sheet')
  })
})
