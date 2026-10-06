// PikaMaxxing mod: your lead pokemon walks in the band above the prompt.
// Frames come pre-packed for Raster from /api/cells, because the mod runtime
// has no PNG decoding and $.http.fetch is text-only.
// /pika toggles it. Draws nothing when the Mac isn't linked or the server is down.
const FALLBACK = 'https://pikamaxxing.vercel.app'

let pet = null     // {columns, rows, ms, frames, img} from /api/cells
let label = ''
let hidden = false
let gfx = false    // terminal speaks the kitty graphics protocol: real pixels

async function load($) {
  try {
    const home = await $.env.get('HOME')
    const cfg = JSON.parse(await $.fs.read(home + '/Library/Application Support/PikaMaxxing/config.json'))
    const base = (cfg.url || FALLBACK).replace(/\/+$/, '')
    const pool = JSON.parse((await $.http.fetch(base + '/api/pool?secret=' + cfg.secret)).text)
    const team = (pool.pets || []).filter(p => p.team_pos).sort((a, b) => a.team_pos - b.team_pos)
    const mon = team[0] || (pool.pets || [])[0]
    if (!mon) return
    const r = await $.http.fetch(base + '/api/cells/' + mon.sprite)  // server picks the size
    if (!r.ok) return
    pet = JSON.parse(r.text)
    label = mon.species + (mon.shiny ? ' ✦' : '') + ' · ' + mon.tokens.toLocaleString() + ' tokens'
  } catch (e) { /* unlinked Mac or dead server must never break the session */ }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pika', description: 'Show or hide your PikaMaxxing pokemon' })
    hidden = (await $.store.get('hidden')) === true
    gfx = Boolean((await $.env.get('GHOSTTY_RESOURCES_DIR')) || (await $.env.get('KITTY_WINDOW_ID')))
    await load($)
    if (pet) $.clock.every(pet.ms, () => { if (!hidden) $.ui.invalidate('ui.render') })
    return next(e)
  })

  on('command.run', { command: 'pika' }, async ($) => {
    hidden = !hidden
    await $.store.set('hidden', hidden)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (hidden || !pet || e.surface !== 'terminal') return next(e)
    const { Box, Text, Raster, Image } = $.ui.resolve(e)
    const theirs = await next(e)
    const i = Math.floor(Date.now() / pet.ms) % pet.frames.length
    const mon = gfx && pet.img
      ? Image({ key: 'pika', source: { png: pet.img.frames[i % pet.img.frames.length] },
                columns: pet.img.columns, rows: pet.img.rows, alt: label })
      : Raster({ key: 'pika', columns: pet.columns, rows: pet.rows, cells: pet.frames[i] })
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [mon, Text({ dimColor: true, children: [label] })],
        }),
        ...(theirs ? [theirs] : []),
      ],
    })
  })
}
