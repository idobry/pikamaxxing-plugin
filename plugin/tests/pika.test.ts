import { expect, mock, test } from 'claude-code/testing'
import { animFor, earned } from '../hooks/pika.js'

// What Claude Code passes to a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'pikamaxxing',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
           scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII='
const GREEN = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNk+M/wn4GBgYGJAQoAHhgCAu/QjeYAAAAASUVORK5CYII='
const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYPj/n4GBgYGJAQoAHRkCAjRcHicAAAAASUVORK5CYII='
const WHITE = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8////fwYGBgYmBigAAD34BADaOyqcAAAAAElFTkSuQmCC'
const SECRET = 'a'.repeat(32)

const PIKACHU = { id: 1, species: 'Pikachu', dex: '0025', sprite: '0025', tokens: 12345, team_pos: 1, shiny: false, exp_pct: 62 }
const ONIX = { id: 2, species: 'Onix', dex: '0095', sprite: '0095', tokens: 5, team_pos: 2, shiny: false, exp_pct: 100 }

// /api/pack: one canvas box; Idle (with white evolution silhouettes), sideways
// Walk/Attack/Hurt for roaming and battles, GREEN Charge for thinking
const ANIM = (png: string) => ({ ms: [100, 100], down: [png, png] })
const SIDE = (png: string) => ({ ...ANIM(png), right: [png, png], left: [png, png] })
const PACK = {
  box: { columns: 4, rows: 3, w: 10, h: 10 },
  anims: { Idle: { ...ANIM(RED), glow: [WHITE, WHITE] }, Walk: SIDE(RED), Charge: ANIM(GREEN),
           Attack: SIDE(BLUE), Hurt: SIDE(BLUE), Pose: ANIM(RED), Tumble: SIDE(RED), Hop: ANIM(RED) },
}
const DOT = '<path fill="#ff0000" d="M0 0h1v1h-1z"/>'
const SVGPACK = { box: PACK.box, anims: { Idle: { ms: [100], down: [DOT] }, Walk: { ms: [100], down: [DOT], right: [DOT], left: [DOT] } } }
const CELLS = { columns: 2, rows: 1, ms: 300, frames: ['gCUAAAAA/wAAAAABIAAAAAAAAAEAAAAB', 'IAAAAAAAAAEAAAABgCUAAAD/AAAAAAAB'] }
const GHOSTTY = { HOME: '/home/test', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty' }

type Opts = { env?: Record<string, string>, linked?: boolean, store?: Record<string, unknown>,
              files?: Record<string, string>, usageOk?: () => boolean, pets?: () => unknown[],
              me?: (s: string) => { status: number, body: unknown }, plugin?: string }

function stubs(on: any, o: Opts = {}) {
  const env = o.env || GHOSTTY
  const clock = mock.clock(on)
  const saved = new Map<string, unknown>(Object.entries(o.store || {}))
  if (o.linked !== false && !saved.has('link')) saved.set('link', { secret: SECRET, url: 'https://pika.test' })
  const files = new Map<string, string>(Object.entries(o.files || {}))
  const posts: any[] = [], ran: string[][] = [], toasts: string[] = []
  const reply = (status: number, body: unknown) => ({ value: { ok: status < 400, status, headers: {}, text: JSON.stringify(body) } })
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: 'mcp__pikamaxxing__link' } }))
  on('session.id', () => ({ value: 'sess-A' }))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { saved.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('env.get', ($: any, e: any) => ({ value: env[e.name] }))
  on('fs.exists', ($: any, e: any) => ({ value: files.has(e.path) }))
  on('fs.read', ($: any, e: any) => files.has(e.path) ? { value: files.get(e.path) } : { deny: 'no such file' })
  on('fs.write', ($: any, e: any) => { files.set(e.path, e.content ?? e.data ?? e.text); return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    const argv = [...e.argv]
    ran.push(argv)
    if (argv[0] === 'mv') { files.set(argv[2], files.get(argv[1])!); files.delete(argv[1]) }
    if (argv[0] === 'rm') files.delete(argv[argv.length - 1])
    return { value: { exitCode: 0, stdout: argv[0] === 'id' ? '501\n' : '', stderr: '' } }
  })
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('http.fetch', ($: any, e: any) => {
    const url: string = e.url
    if (url.includes('/api/usage')) {
      const body = JSON.parse(e.init.body)
      posts.push(body)
      return (o.usageOk ? o.usageOk() : true) ? reply(200, { ...PIKACHU, tokens: PIKACHU.tokens + body.tokens }) : reply(503, {})
    }
    if (url.includes('/api/pool')) return reply(200, { name: 'Ido', page: 'https://pika.test/u/' + SECRET, pets: o.pets ? o.pets() : [ONIX, PIKACHU] })
    if (url.includes('/api/me')) {
      const s = new URL(url).searchParams.get('secret') || ''
      const r = o.me ? o.me(s) : { status: 200, body: PIKACHU }
      return reply(r.status, r.body)
    }
    if (url.includes('/api/version')) return reply(200, { plugin: o.plugin || '2.0.0' })
    if (url.includes('fmt=svg')) return reply(200, SVGPACK)
    if (url.includes('/api/pack/')) return reply(200, PACK)
    return reply(200, CELLS)
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({}))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  // Stands for what Claude Code (or a later mod) draws in the band
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  return { clock, saved, files, posts, ran, toasts }
}

const start = ($: any, surface = 'terminal') => $.session.start({ surface, isInteractive: true, cwd: '/work' })
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9999, cache_creation_input_tokens: 25, model: 'm' }
const turn = ($: any, usage: unknown = USAGE, agentId?: string) =>
  $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: false, usage, ...(agentId ? { agentId } : {}) })

test('Claude actions map to the original animations', async () => {
  expect(animFor('think')).toBe('Charge')
  expect(animFor('tool', 'Bash')).toBe('Attack')
  expect(animFor('tool', 'Edit')).toBe('Swing')
  expect(animFor('tool', 'WebFetch')).toBe('Shoot')
  expect(animFor('tool', 'Agent')).toBe('Double')
  expect(animFor('tool', 'Read')).toBe('Walk')
  expect(animFor('alert')).toBe('Hop')
  expect(animFor('done')).toBe('Sit')
  expect(animFor('idle')).toBe('Idle')
})

test('a turn earns input + output + cache writes, never cache reads', async () => {
  expect(earned(USAGE)).toBe(175)
  expect(earned(null)).toBe(0)
})

test('each turn reports its tokens to the trainer, subagent turns included', async ($, on) => {
  const { posts, clock } = stubs(on)
  await start($)
  await turn($)
  await turn($, { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'agent-1')
  await clock.advance(100)
  expect(posts.map((p) => p.tokens)).toEqual([175, 10])
  expect(posts[0].secret).toBe(SECRET)
})

test('a failed report stays queued and goes out with the next one', async ($, on) => {
  let up = false
  const { posts, saved, clock } = stubs(on, { usageOk: () => up })
  await start($)
  await turn($)
  await clock.advance(100)
  expect(saved.get('pending:sess-A')).toBe(175)
  up = true
  await turn($)
  await clock.advance(100)
  expect(posts[posts.length - 1].tokens).toBe(350)
  expect(saved.get('pending:sess-A')).toBe(0)
})

test('unlinked: a quiet sign-in line, nothing reported', async ($, on) => {
  const { posts, clock } = stubs(on, { linked: false })
  await start($)
  await turn($)
  await clock.advance(200)
  expect(posts.length).toBe(0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\/pika link/ })).toBeDefined()
  expect(await ui.find({ key: 'pika' })).toBeUndefined()
  await ui.unmount()
})

test('/pika link checks the secret, saves it, and the pokemon appears', async ($, on) => {
  const { saved, clock } = stubs(on, { linked: false })
  await start($)
  const bad: any = await $.command.run({ command: 'pika', args: 'link nope' })
  expect(bad.text).toMatch(/not a trainer secret/)
  const ok: any = await $.command.run({ command: 'pika', args: 'link ' + SECRET })
  expect(ok.text).toMatch(/^Linked!/)
  expect((saved.get('link') as any).secret).toBe(SECRET)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'pika' })).toBeDefined()
  await ui.unmount()
})

test('an unknown secret is refused', async ($, on) => {
  stubs(on, { linked: false, me: () => ({ status: 404, body: { error: 'unknown_secret' } }) })
  await start($)
  const r: any = await $.command.run({ command: 'pika', args: 'link ' + SECRET })
  expect(r.text).toMatch(/Unknown secret/)
})

test('Claude can link through the setup tool', async ($, on) => {
  const { saved } = stubs(on, { linked: false })
  await start($)
  const r: any = await $.tool.call({ tool: 'mcp__pikamaxxing__link', secret: SECRET })
  expect(String(r.result)).toMatch(/^Linked!/)
  expect((saved.get('link') as any).secret).toBe(SECRET)
})

test('the old desktop app is removed, its secret kept, its hooks stripped, nothing else touched', async ($, on) => {
  const home = '/Users/test'
  const settings = {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: '"/Applications/PikaMaxxing.app/Contents/MacOS/PikaMaxxing" report-usage 2>/dev/null || true' }] },
             { hooks: [{ type: 'command', command: 'say done' }] }],
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '"/x/PikaMaxxing" state-hook 2>/dev/null || true' }] }],
    },
  }
  const { saved, files, ran, toasts, posts, clock } = stubs(on, {
    linked: false, env: { HOME: home, GHOSTTY_RESOURCES_DIR: '/g' },
    files: {
      [home + '/Library/Application Support/PikaMaxxing/config.json']: JSON.stringify({ secret: SECRET, url: 'https://pika.test' }),
      [home + '/.claude/settings.json']: JSON.stringify(settings),
      [home + '/Library/LaunchAgents/com.pikamaxxing.agent.plist']: '<plist/>',
      ['/Applications/PikaMaxxing.app']: 'dir',
    },
  })
  await start($)
  expect((saved.get('link') as any).secret).toBe(SECRET)
  const after = JSON.parse(files.get(home + '/.claude/settings.json')!)
  expect(after.model).toBe('opus')
  expect(after.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'say done' }] }])
  expect(after.hooks.PreToolUse).toBeUndefined()
  const cmds = ran.map((a) => a.join(' '))
  expect(cmds).toContain('launchctl bootout gui/501 ' + home + '/Library/LaunchAgents/com.pikamaxxing.agent.plist')
  expect(cmds).toContain('pkill -f PikaMaxxing.app/Contents/MacOS/PikaMaxxing')
  expect(cmds).toContain('rm -rf /Applications/PikaMaxxing.app')
  expect(toasts.some((t) => /removed the old desktop app/.test(t))).toBe(true)
  // with the old Stop hook gone, the mod reports, once
  await turn($)
  await clock.advance(100)
  expect(posts.map((p) => p.tokens)).toEqual([175])
})

test('while the old reporting hook survives, the mod does not count turns twice', async ($, on) => {
  const home = '/Users/test'
  const { posts, clock } = stubs(on, {
    env: { HOME: home },
    files: { [home + '/.claude/settings.json']: '{ not json, report-usage' }, // unparseable: left alone
  })
  await start($)
  await turn($)
  await clock.advance(100)
  expect(posts.length).toBe(0)
})

test('slot 1 shows as a real Image with controls, poke-able name, slot count and EXP gauge', async ($, on) => {
  const { clock } = stubs(on)
  await start($)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'pika' })).toBeDefined()
  for (const key of ['stop', 'prev', 'next', 'page', 'minimize']) expect(await ui.find({ key })).toBeDefined()
  expect((await ui.find({ key: 'poke' }) as any).props.label).toBe('Pikachu')
  expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '━'.repeat(9) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
  expect(await ui.find({ key: 'logo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('thinking switches the pokemon into its Charge routine', async ($, on) => {
  const { clock } = stubs(on)
  await start($)
  await $.turn.start({ turnId: 't1' })
  await clock.advance(2500)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const img: any = await ui.find({ key: 'pika' })
  expect([GREEN, RED]).toContain(img.props.source.png) // Charge, or a roaming walk
  await ui.unmount()
})

test('another live session shares the scene and this one takes the next free slot', async ($, on) => {
  const now = Date.now()
  const { clock } = stubs(on, { store: { 's:sess-B': { slot: 0, phase: 'think', tool: '', at: now, ts: now } } })
  await start($)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'pika' })).toBeDefined()   // this session: Onix in slot 2
  expect(await ui.find({ key: 'pika-0' })).toBeDefined() // the other session's Pikachu
  expect((await ui.find({ key: 'poke' }) as any).props.label).toBe('Onix')
  await ui.unmount()
})

test('a shared battle plays the same fight in every band', async ($, on) => {
  const now = Date.now()
  const { clock } = stubs(on, { store: {
    's:sess-B': { slot: 0, phase: 'idle', tool: '', at: now, ts: now },
    battle: { start: now - 3500, winner: 0, a: 'sess-B', b: 'sess-A', manual: true }, // mid round 1
  } })
  await start($)
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const img: any = await ui.find({ key: 'pika' })
  expect(img.props.source.png).toBe(BLUE) // Attack or Hurt frames
  await ui.unmount()
})

test('a pokemon whose form changes evolves on screen', async ($, on) => {
  let pets: any[] = [PIKACHU, ONIX]
  const { clock } = stubs(on, { pets: () => pets })
  await start($)
  await clock.advance(300)
  pets = [{ ...PIKACHU, dex: '0026', sprite: '0026', species: 'Raichu' }, ONIX]
  await clock.advance(60000) // the next team refresh sees Raichu
  await clock.advance(1000)  // into the white flicker
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const img: any = await ui.find({ key: 'pika' })
  expect(img.props.source.png).toBe(WHITE)
  await ui.unmount()
})

test('a newer plugin version shows an update hint', async ($, on) => {
  const { toasts, clock } = stubs(on, { plugin: '9.9.9' })
  await start($)
  await clock.advance(100)
  expect(toasts.some((t) => t.includes('9.9.9') && t.includes('/plugin marketplace update pikamaxxing'))).toBe(true)
})

test('› and ‹ cycle through the team queue', async ($, on) => {
  const { clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'next' })
  await clock.advance(200)
  expect((await ui.find({ key: 'poke' }) as any).props.label).toBe('Onix')
  expect(await ui.find({ type: 'Text', text: 'MAX' })).toBeDefined()
  await ui.press({ key: 'prev' })
  await clock.advance(200)
  expect((await ui.find({ key: 'poke' }) as any).props.label).toBe('Pikachu')
  await ui.unmount()
})

test('■ stops the pokemon, ▶ brings it back, and the choice is saved', async ($, on) => {
  const { saved, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'stop' })
  expect(await ui.find({ key: 'pika' })).toBeUndefined()
  expect(saved.get('stopped')).toBe(true)
  await ui.press({ key: 'resume' })
  await clock.advance(200)
  expect(await ui.find({ key: 'pika' })).toBeDefined()
  expect(saved.get('stopped')).toBe(false)
  await ui.unmount()
})

test('↗ opens the trainer page', async ($, on) => {
  const { ran, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'page' })
  expect(ran[ran.length - 1]).toEqual(['open', 'https://pika.test/u/' + SECRET])
  await ui.unmount()
})

test('a plain terminal falls back to Raster cells', async ($, on) => {
  const { clock } = stubs(on, { env: { HOME: '/home/test' } })
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'pika' }) as any).type).toBe('Raster')
  await ui.unmount()
})

test('the desktop app draws a self-animating SVG with native buttons and no frame', async ($, on) => {
  const { clock } = stubs(on, { env: { HOME: '/home/test' } })
  await start($, 'desktop')
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg: any = await ui.find({ type: 'Svg' })
  expect(svg.props.isInteractive).toBe(true)
  expect(svg.props.source).toContain(DOT)
  expect(svg.props.source).toContain('>Pikachu</text>')
  expect(svg.props.source).toContain('<animate attributeName="visibility"')
  expect(svg.props.alt).toMatch(/62% to next level/)
  for (const key of ['stop', 'prev', 'next', 'page', 'poke', 'minimize']) expect(await ui.find({ key })).toBeDefined()
  expect((await ui.find({ key: 'card' }) as any).props.borderStyle).toBeUndefined()
  await ui.unmount()
})

test('presses route by key through ui.press, across redraws', async ($, on) => {
  const { clock } = stubs(on, { env: { HOME: '/home/test' } })
  await start($, 'desktop')
  await clock.advance(300)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(1000)
  await $.ui.press({ plugin: 'pikamaxxing', key: 'next', surface: 'desktop' })
  await clock.advance(300)
  expect((await ui.find({ type: 'Svg' }) as any).props.source).toContain('>Onix</text>')
  await ui.unmount()
})

test('− minimizes the terminal band to one slim line, + restores it', async ($, on) => {
  const { saved, clock } = stubs(on)
  await start($)
  await clock.advance(200)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'minimize' })
  await clock.advance(200)
  expect((await ui.find({ key: 'pika' }) as any).props.rows).toBe(2)
  expect(await ui.find({ key: 'prev' })).toBeUndefined()
  expect(saved.get('compact')).toBe(true)
  await ui.press({ key: 'expand' })
  await clock.advance(200)
  expect(await ui.find({ key: 'prev' })).toBeDefined()
  await ui.unmount()
})

test('the VS Code chat gets the engine band only', async ($, on) => {
  stubs(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  expect(await ui.find({ key: 'pika' })).toBeUndefined()
  await ui.unmount()
})
