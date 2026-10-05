// PikaMaxxing mod: your lead pokemon walks in the band above the prompt while
// Claude works. Frames come pre-packed for Raster from /api/cells, because the
// mod runtime has no PNG decoding and $.http.fetch is text-only.
// /pika toggles it. Draws nothing when the Mac isn't linked or the server is down.
const FALLBACK = 'https://pikamaxxing.vercel.app'

let pet = null     // {columns, rows, ms, frames: [base64]} from /api/cells
let label = ''
let hidden = false
let working = false

async function load($) {
  try {
    const home = await $.env.get('HOME')
    const cfg = JSON.parse(await $.fs.read(home + '/Library/Application Support/PikaMaxxing/config.json'))
    const base = (cfg.url || FALLBACK).replace(/\/+$/, '')
    const pool = JSON.parse((await $.http.fetch(base + '/api/pool?secret=' + cfg.secret)).text)
    const team = (pool.pets || []).filter(p => p.team_pos).sort((a, b) => a.team_pos - b.team_pos)
    const mon = team[0] || (pool.pets || [])[0]
    if (!mon) return
    const r = await $.http.fetch(base + '/api/cells/' + mon.sprite)
    if (!r.ok) return
    pet = JSON.parse(r.text)
    label = mon.species + (mon.shiny ? ' ✦' : '') + ' · ' + mon.tokens.toLocaleString() + ' tokens'
  } catch (e) { /* unlinked Mac or dead server must never break the session */ }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pika', description: 'Show or hide your PikaMaxxing pokemon' })
    hidden = (await $.store.get('hidden')) === true
    await load($)
    if (pet) $.clock.every(pet.ms, () => { if (working && !hidden) $.ui.invalidate('ui.render') })
    return next(e)
  })

  on('command.run', { command: 'pika' }, async ($) => {
    hidden = !hidden
    await $.store.set('hidden', hidden)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('turn.start', async ($, e, next) => {
    working = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    working = false
    $.ui.invalidate('ui.render')  // settle back to the standing frame
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (hidden || !pet || e.surface !== 'terminal') return next(e)
    const { Box, Text, Raster } = $.ui.resolve(e)
    const theirs = await next(e)
    const i = working ? Math.floor(Date.now() / pet.ms) % pet.frames.length : 0
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Raster({ key: 'pika', columns: pet.columns, rows: pet.rows, cells: pet.frames[i] }),
            Text({ dimColor: true, children: [label] }),
          ],
        }),
        ...(theirs ? [theirs] : []),
      ],
    })
  })
}
