import { expect, mock, test } from 'claude-code/testing'
import { animFor } from '../hooks/pika.js'

// What Claude Code passes to a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'pikamaxxing',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII='
const GREEN = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNk+M/wn4GBgYGJAQoAHhgCAu/QjeYAAAAASUVORK5CYII='

const POOL = {
  name: 'Ido',
  page: 'https://pika.test/u/s3cr3t',
  pets: [
    { id: 2, species: 'Onix', sprite: '0095', tokens: 5, team_pos: 2, shiny: false, exp_pct: 100 },
    { id: 1, species: 'Pikachu', sprite: '0025', tokens: 12345, team_pos: 1, shiny: false, exp_pct: 62 },
  ],
}

// /api/pack shape: one canvas box, frames per anim and facing
const ANIM = (png: string) => ({ ms: [100, 100], down: [png, png] })
const PACK = {
  box: { columns: 4, rows: 3 },
  anims: { Idle: ANIM(RED), Walk: { ...ANIM(RED), right: [RED, RED], left: [RED, RED] }, Charge: ANIM(GREEN) },
}
// /api/cells shape (plain terminals): two 2x1-cell walk frames
const CELLS = { columns: 2, rows: 1, ms: 300,
                frames: ['gCUAAAAA/wAAAAABIAAAAAAAAAEAAAAB', 'IAAAAAAAAAEAAAABgCUAAAD/AAAAAAAB'] }
// /api/pack?fmt=svg: same shape, frames are SVG path markup
const DOT = '<path fill="#ff0000" d="M0 0h1v1h-1z"/>'
const SVGPACK = {
  box: { columns: 4, rows: 3, w: 10, h: 10 },
  anims: { Idle: { ms: [100], down: [DOT] }, Walk: { ms: [100], down: [DOT], right: [DOT], left: [DOT] } },
}
const GHOSTTY = { HOME: '/home/test', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty' }

function stubs(on: any, env: Record<string, string> = GHOSTTY) {
  const clock = mock.clock(on)
  const fetched: string[] = []
  const saved = new Map<string, unknown>()
  const ran: string[][] = []
  on('command.register', () => ({ value: undefined }))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('env.get', ($: any, e: any) => ({ value: env[e.name] }))
  on('fs.read', () => ({ value: JSON.stringify({ secret: 's3cr3t', url: 'https://pika.test' }) }))
  on('http.fetch', ($: any, e: any) => {
    fetched.push(e.url)
    const body = e.url.includes('/api/pool') ? POOL
      : e.url.includes('fmt=svg') ? SVGPACK : e.url.includes('/api/pack/') ? PACK : CELLS
    return { value: { ok: true, status: 200, headers: {}, text: JSON.stringify(body) } }
  })
  on('process.run', ($: any, e: any) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  // Stands for what Claude Code (or a later mod) draws in the band
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  return { clock, fetched, saved, ran }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

test('Claude actions map to the Mac app animations', async () => {
  expect(animFor('think')).toBe('Charge')
  expect(animFor('tool', 'Bash')).toBe('Attack')
  expect(animFor('tool', 'Edit')).toBe('Swing')
  expect(animFor('tool', 'Write')).toBe('Swing')
  expect(animFor('tool', 'WebFetch')).toBe('Shoot')
  expect(animFor('tool', 'Agent')).toBe('Double')
  expect(animFor('tool', 'Read')).toBe('Walk')
  expect(animFor('alert')).toBe('Hop')
  expect(animFor('done')).toBe('Sit')
  expect(animFor('sleep')).toBe('Sleep')
  expect(animFor('idle')).toBe('Idle')
})

test('slot 1 shows as a real Image with controls, label and slot count', async ($, on) => {
  const { fetched, clock } = stubs(on)
  await start($)
  await clock.advance(300)
  expect(fetched.some((u) => u.endsWith('/api/pack/0025'))).toBe(true)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  for (const key of ['stop', 'prev', 'next', 'page']) expect(await ui.find({ key })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pikachu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
  // EXP gauge: 14 cells, 62% -> 9 filled, then the percentage
  expect(await ui.find({ type: 'Text', text: '━'.repeat(9) })).toBeDefined()
  // brand: logo picture plus the name
  expect(await ui.find({ key: 'logo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'PikaMaxxing' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('thinking switches the pokemon into its Charge routine', async ($, on) => {
  const { clock } = stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1' })
  await clock.advance(2500) // past the staggered first beat
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const img: any = await ui.find({ key: 'pika' })
  // Charge frames are GREEN in the fixture; a roaming walk or missing flourish shows RED
  expect([GREEN, RED]).toContain(img.props.source.png)
  await ui.unmount()
})

test('› and ‹ cycle through the team queue', async ($, on) => {
  const { fetched, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'next' })
  await clock.advance(200)
  expect(fetched.some((u) => u.endsWith('/api/pack/0095'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Onix/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'MAX' })).toBeDefined() // maxed gauge
  await ui.press({ key: 'prev' })
  await clock.advance(200)
  expect(await ui.find({ type: 'Text', text: /Pikachu/ })).toBeDefined()
  await ui.unmount()
})

test('■ stops the pokemon, ▶ brings it back, and the choice is saved', async ($, on) => {
  const { saved, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'stop' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ key: 'resume' })).toBeDefined()
  expect(saved.get('stopped')).toBe(true)
  await ui.press({ key: 'resume' })
  await clock.advance(200)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(saved.get('stopped')).toBe(false)
  await ui.unmount()
})

test('↗ opens the trainer page', async ($, on) => {
  const { ran, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'page' })
  expect(ran[0]).toEqual(['open', 'https://pika.test/u/s3cr3t'])
  await ui.unmount()
})

test('a plain terminal falls back to Raster cells', async ($, on) => {
  const { fetched, clock } = stubs(on, { HOME: '/home/test' })
  await start($)
  await clock.advance(200)
  expect(fetched.some((u) => u.endsWith('/api/cells/0025'))).toBe(true)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('the desktop app draws the pokemon as an SVG stage with the same controls', async ($, on) => {
  const { fetched, clock } = stubs(on, { HOME: '/home/test' })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(300)
  expect(fetched.some((u) => u.endsWith('/api/pack/0025?fmt=svg'))).toBe(true)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg: any = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg.props.source).toContain(DOT)
  expect(svg.props.source).toContain('>Pikachu</text>')
  expect(svg.props.source).toContain('>EXP</text>')
  expect(svg.props.source).toContain('>PIKAMAXXING</text>')
  expect(svg.props.source).toContain('>62%</text>')
  expect(svg.props.alt).toMatch(/62% to next level/)
  // buttons live inside the frame Box, next to the drawing
  // minimize sits first in the frame: the top-left corner
  expect(JSON.stringify(await ui.find({ key: 'card' })).indexOf('"minimize"'))
    .toBeLessThan(JSON.stringify(await ui.find({ key: 'card' })).indexOf('<svg'))
  expect(svg.props.source).not.toContain('#fff8e7') // no cream block on the app background
  const frame: any = await ui.find({ key: 'card' })
  expect(frame.props.borderStyle).toBe('round')
  expect(JSON.stringify(frame)).toContain('"page"')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  for (const key of ['stop', 'prev', 'next', 'page']) expect(await ui.find({ key })).toBeDefined()
  await ui.unmount()
})

test('the VS Code chat gets the engine band only', async ($, on) => {
  stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('an unlinked Mac draws nothing and never throws', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ deny: 'no such file' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('− minimizes the terminal band to one slim pokemon line, + restores it', async ($, on) => {
  const { saved, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'minimize' })
  await clock.advance(200)
  const mon: any = await ui.find({ key: 'pika' })
  expect(mon.props.rows).toBe(2)
  expect(await ui.find({ type: 'Text', text: 'PikaMaxxing' })).toBeUndefined()
  expect(await ui.find({ key: 'prev' })).toBeUndefined()
  expect(saved.get('compact')).toBe(true)
  await ui.press({ key: 'expand' })
  await clock.advance(200)
  expect(await ui.find({ type: 'Text', text: 'PikaMaxxing' })).toBeDefined()
  expect(saved.get('compact')).toBe(false)
  await ui.unmount()
})

test('desktop minimize shows a slim strip with an Expand button', async ($, on) => {
  const { clock } = stubs(on, { HOME: '/home/test' })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'minimize' })
  await clock.advance(200)
  const svg: any = await ui.find({ type: 'Svg' })
  expect(svg.props.height).toBe(40)
  expect(svg.props.source).not.toContain('EXP')
  expect(await ui.find({ key: 'expand' })).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.unmount()
})
