import { expect, mock, test } from 'claude-code/testing'

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

const POOL = {
  name: 'Ido',
  pets: [
    { id: 2, species: 'Onix', sprite: '0095', tokens: 5, team_pos: 2, shiny: false },
    { id: 1, species: 'Pikachu', sprite: '0025', tokens: 12345, team_pos: 1, shiny: false },
  ],
}

// Two 2x1-cell frames, packed the way /api/cells packs them
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII='

const CELLS = {
  columns: 2,
  rows: 1,
  ms: 300,
  frames: ['gCUAAAAA/wAAAAABIAAAAAAAAAEAAAAB', 'IAAAAAAAAAEAAAABgCUAAAD/AAAAAAAB'],
}

function stubs(on: any, env: Record<string, string> = { HOME: '/home/test' }, cellsBody: any = CELLS) {
  mock.clock(on)
  const fetched: string[] = []
  on('command.register', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('env.get', ($: any, e: any) => ({ value: env[e.name] }))
  on('fs.read', () => ({ value: JSON.stringify({ secret: 's3cr3t', url: 'https://pika.test' }) }))
  on('http.fetch', ($: any, e: any) => {
    fetched.push(e.url)
    const body = e.url.includes('/api/pool') ? POOL : cellsBody
    return { value: { ok: true, status: 200, headers: {}, text: JSON.stringify(body) } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  // Stands for what Claude Code (or a later mod) draws in the band
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  return fetched
}

test('the lead pokemon walks in the band with its label', async ($, on) => {
  const fetched = stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  // slot 1 wins even though the pool lists Onix first
  expect(fetched.some((u) => u.includes('/api/cells/0025'))).toBe(true)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pikachu .*12.*345 tokens/ })).toBeDefined()
  // the engine's own band content is kept below ours
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('a kitty-graphics terminal gets a real Image, not cells', async ($, on) => {
  stubs(on, { HOME: '/home/test', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty' },
        { ...CELLS, img: { columns: 8, rows: 4, frames: [PNG1, PNG1] } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('/pika hides the pokemon and leaves the band to the engine', async ($, on) => {
  stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'pika', args: '' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('the desktop app gets no Raster', async ($, on) => {
  stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
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

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})
