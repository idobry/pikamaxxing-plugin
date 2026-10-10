// PikaMaxxing mod: your team's pokemon lives in the band above the prompt and
// acts out what Claude is doing, with the same behaviour model as the Mac app
// (client/pet_overlay.py): Charge routine while thinking, a move per tool,
// victory pose when a turn ends, idle antics, roaming walks, naps when quiet.
// Left controls: stop, previous / next team member, open the trainer page.
const FALLBACK = 'https://pikamaxxing.vercel.app'
const TICK = 100        // ms per engine step; the band redraws at most 10/s
const SLEEP_MS = 300000 // quiet this long -> nap (Mac: SESSION_SLEEP_SECS)
const BTN_W = 4, INFO_W = 20, CTRL_W = BTN_W + INFO_W + 1 // terminal left side, columns

// behaviour tables, verbatim from the Mac app
const IDLE_BEHAVIORS = ['Eat', 'Nod', 'LookUp', 'DeepBreath', 'Shake', 'Trip', 'Laying']
const THINK_FLOURISH = ['DeepBreath', 'Shake', 'Nod', 'LookUp', 'Hop', 'Double', 'Trip']
const TOOL_ANIM = [['bash', 'Attack'], ['edit', 'Swing'], ['write', 'Swing'],
                   ['web', 'Shoot'], ['task', 'Double'], ['agent', 'Double']]
const ROAM_LEN = [1, 3]
const ROAM_GAP = { think: [1, 4], work: [2, 6], idle: [3, 8] }

export function animFor(phase, tool = '') {
  if (phase === 'think') return 'Charge'
  if (phase === 'tool') {
    const t = tool.toLowerCase()
    const hit = TOOL_ANIM.find(([frag]) => t.includes(frag))
    return hit ? hit[1] : 'Walk'
  }
  return { alert: 'Hop', done: 'Sit', sleep: 'Sleep' }[phase] || 'Idle'
}

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]
const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n)

let base = FALLBACK, secret = '', page = ''
let team = []            // slot-ordered pets from /api/pool
let idx = 0              // which team member this session shows
const packs = {}         // 'mode:sprite' -> frames for that mode
const loading = new Set()
let gfx = false          // kitty graphics (Ghostty, kitty): real pixel frames
// png: terminal Image (kitty graphics), cells: terminal Raster, svg: desktop app
let mode = 'cells'
const SVG_H = 56, SVG_SPEED = 6 // desktop sprite height and walk speed, CSS px
const GAUGE_W = 14              // terminal EXP bar cells
// the PikaMaxxing logo, 14x12 pixel art: PNG for the terminal, paths for the desktop card
const LOGO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAHAAAABgCAYAAADFNvbQAAABM0lEQVR42u3cUQ3CMBRA0ZXghfAzBwhAAQbwgAY8YAAFE4CD/hDUgIM18Ea7wTnfBMJu+pKXJU2Xff/sAo5DTh0fiz7/lUe4bAIKiIAIKCACUl96nA6je8gt30M/8O97YnTP2/VbJ9AIRUAEREABEZBJ98DSB+yJbfe8zfmanEAjFAEREAEFREAmtI5+QWmPKRryoh9g+P87gUYoAiIgAgqIgNQVfhdXel/IuNL7PifQCEVABERAARGQ2nugPW/ee6ITaIQiIAIKiIAIyLt7oD3PCURABBQQAREQAQVEQAREQAEREAER8GcV74mJ3gfa+h6V1r79/JxAIxQBEVBABERABBQQAREQAQVEQARkhHtiZs49MUYoAiIgAgqIgNTeA+2Jbfc8J9AIRUAEREABEZCJvQBa9TbM3y6NugAAAABJRU5ErkJggg=='
const LOGO_SVG = '<path fill="#9c492e" d="M0 0h2v1h-2zM12 0h2v1h-2zM1 1h2v1h-2zM11 1h2v1h-2zM2 2h2v1h-2zM10 2h2v1h-2zM1 8h2v1h-2zM11 8h2v1h-2zM1 9h2v1h-2zM11 9h2v1h-2z"/><path fill="#d97757" d="M0 1h1v1h-1zM13 1h1v1h-1zM1 2h1v1h-1zM12 2h1v1h-1zM1 3h3v1h-3zM10 3h3v1h-3zM2 4h10v1h-10zM1 5h12v1h-12zM0 6h14v1h-14zM0 7h14v1h-14zM0 8h1v1h-1zM3 8h8v1h-8zM13 8h1v1h-1zM0 9h1v1h-1zM3 9h8v1h-8zM13 9h1v1h-1zM1 10h12v1h-12zM2 11h10v1h-10z"/>'
let stopped = false
let compact = false      // minimized: one slim line, just the pokemon
let cols = 80            // band width, learned at render
let phase = 'idle', tool = '', quietMs = 0

// one pokemon's animation state, as the Mac app's Sprite
const P = { anim: null, show: null, fi: 0, left: 0, once: null, dir: 1, x: null,
            roamIn: rand(1, 4) * 1000, roamLeft: 0, thinkQ: [], thinkLeft: 0,
            thinkShow: 'Charge', idleIn: rand(10, 30) * 1000, idleMode: 'Sit', idleHold: 0 }

const cur = () => team[idx]
const pack = () => cur() && packs[mode + ':' + cur().sprite]
const has = (name) => mode === 'cells' || Boolean(pack()?.anims?.[name])
const modeFor = (surface) => surface === 'desktop' ? 'svg' : surface === 'terminal' ? (gfx ? 'png' : 'cells') : null
const cut = () => { P.fi = 0; P.left = 0 }

function nextBeat() {
  if (!P.thinkQ.length) {
    const moves = [...THINK_FLOURISH].sort(() => Math.random() - 0.5).slice(0, 3)
    P.thinkQ = moves.flatMap((m) => [['Charge', 800 + Math.random() * 700], [m, 700 + Math.random() * 600]])
  }
  const [show, ms] = P.thinkQ.shift()
  P.thinkLeft = ms
  return show
}

function roam(show, kind) {
  if (show === 'Walk' || show === 'Sleep' || P.once) return show
  if (P.roamLeft > 0) {
    P.roamLeft -= TICK
    if (P.roamLeft <= 0) cut()
    return 'Walk'
  }
  P.roamIn -= TICK
  if (P.roamIn <= 0) {
    P.roamIn = rand(...ROAM_GAP[kind]) * 1000
    P.roamLeft = rand(...ROAM_LEN) * 1000
    if (Math.random() < 0.45) P.dir *= -1
    cut()
    return 'Walk'
  }
  return show
}

function step() {
  quietMs += TICK
  const resting = phase === 'idle' || phase === 'done'
  const name = animFor(resting && quietMs > SLEEP_MS ? 'sleep' : phase, tool)
  let show
  if (name === 'Charge') { // thinking: the person is watching, so perform
    if (P.anim !== 'Charge') {
      Object.assign(P, { anim: 'Charge', once: null, idleHold: 0, thinkQ: [], thinkShow: 'Charge' })
      P.thinkLeft = rand(100, 2000)
    }
    P.thinkLeft -= TICK
    if (P.thinkLeft <= 0) { P.thinkShow = nextBeat(); cut() }
    show = P.once || roam(P.thinkShow, 'think')
  } else {
    if (name !== P.anim) {
      if (name === 'Sit' && P.anim !== null) P.once = 'Pose' // victory pose when work finishes
      P.anim = name
      cut()
      P.idleHold = 0
      P.idleIn = rand(10, 30) * 1000
    }
    let n = name
    if (name === 'Sit' || name === 'Idle') { // idle life: antics, strolls, naps
      if (P.idleHold > 0) {
        P.idleHold -= TICK
        n = P.idleMode
      } else if (!P.once) {
        P.idleIn -= TICK
        if (P.idleIn <= 0) {
          P.idleIn = rand(10, 30) * 1000
          const r = Math.random()
          if (r < 0.4) P.once = pick(IDLE_BEHAVIORS)
          else if (r < 0.75) { P.idleMode = 'Walk'; P.idleHold = rand(8, 20) * 1000 }
          else { P.idleMode = 'Sleep'; P.idleHold = rand(15, 40) * 1000 }
          cut()
        }
      }
    }
    show = roam(P.once || n, name === 'Sit' || name === 'Idle' ? 'idle' : 'work')
  }
  if (P.once && !has(P.once)) P.once = null // species without that antic
  if (!has(show)) show = 'Idle'
  if (show !== P.show) { P.show = show; cut() }

  const frames = frameList()
  P.left -= TICK
  while (P.left <= 0 && frames.ms.length) {
    if (++P.fi >= frames.ms.length) {
      P.fi = 0
      if (P.once) P.once = null
    }
    P.left += frames.ms[P.fi]
  }

  const { w, stage, speed } = geo()
  if (P.x === null) P.x = rand(0, stage - w)
  if (show === 'Walk') {
    if (P.x <= 0 && P.dir < 0) P.dir = 1
    else if (P.x >= stage - w && P.dir > 0) P.dir = -1
    P.x += P.dir * speed
  }
  P.x = Math.max(0, Math.min(P.x, stage - w))
}

// where the pokemon roams: terminal columns, or CSS px on the desktop stage
function geo() {
  const b = box()
  if (mode === 'svg') {
    const h = compact ? STRIP_SPR : SVG_H
    return { w: Math.round(h * b.w / b.h), stage: (compact ? STRIP_W : STAGE_W) - 16, speed: SVG_SPEED }
  }
  if (compact) { // the minimized line: a 2-row pokemon after the expand button
    const w = miniCols()
    return { w, stage: Math.max(w, cols - 4), speed: 1 }
  }
  const w = b.columns
  return { w, stage: Math.max(w, cols - CTRL_W - 2), speed: 1 }
}

const MINI_ROWS = 2
const miniCols = () => mode === 'cells' ? box().columns : Math.max(1, Math.round(box().columns * MINI_ROWS / box().rows))

// current animation's frames: {ms, imgs}; cells mode only has the walk cycle
function frameList() {
  const p = pack()
  if (!p) return { ms: [], imgs: [] }
  if (mode === 'cells') return { ms: p.frames.map(() => p.ms), imgs: p.frames }
  const a = p.anims[P.show] || p.anims.Idle || p.anims.Walk
  const imgs = P.show === 'Walk' ? (P.dir < 0 ? a.left : a.right) : a.down
  return { ms: a.ms, imgs }
}

const box = () => {
  const p = pack()
  return !p ? { columns: 1, rows: 1, w: 1, h: 1 } : mode === 'cells' ? { columns: p.columns, rows: p.rows } : p.box
}

async function loadPack($, sprite) {
  const key = mode + ':' + sprite
  if (packs[key] || loading.has(key)) return
  loading.add(key)
  const path = { png: '/api/pack/' + sprite, svg: '/api/pack/' + sprite + '?fmt=svg', cells: '/api/cells/' + sprite }[mode]
  try {
    const r = await $.http.fetch(base + path)
    if (r.ok) packs[key] = JSON.parse(r.text)
  } catch (e) { /* keep showing what we have */ }
  loading.delete(key)
}

async function loadTeam($) {
  try {
    const home = await $.env.get('HOME')
    const cfg = JSON.parse(await $.fs.read(home + '/Library/Application Support/PikaMaxxing/config.json'))
    base = (cfg.url || FALLBACK).replace(/\/+$/, '')
    secret = cfg.secret
    const pool = JSON.parse((await $.http.fetch(base + '/api/pool?secret=' + secret)).text)
    const pets = pool.pets || []
    const slotted = pets.filter((p) => p.team_pos).sort((a, b) => a.team_pos - b.team_pos)
    team = slotted.length ? slotted : pets.slice(0, 1)
    page = pool.page || base + '/u/' + secret
    idx = Math.min(idx, Math.max(0, team.length - 1))
    if (cur()) await loadPack($, cur().sprite)
  } catch (e) { /* unlinked Mac or dead server must never break the session */ }
}

async function setCompact($, value) {
  compact = value
  P.x = null // re-place on the new stage
  await $.store.set('compact', value)
  $.ui.invalidate('ui.render')
}

async function setStopped($, value) {
  stopped = value
  await $.store.set('stopped', value)
  $.ui.invalidate('ui.render')
}

async function switchTo($, delta) {
  if (team.length < 2) return
  idx = (idx + delta + team.length) % team.length
  await loadPack($, cur().sprite)
  Object.assign(P, { anim: null, show: null, once: null, x: null })
  $.ui.invalidate('ui.render')
}

// gating events: if our hook ever fails, the call goes through untouched
function passThrough($, e, next) {
  return next.called ? undefined : next(e)
}

async function openPage($) {
  for (const opener of ['open', 'xdg-open']) {
    try {
      if ((await $.process.run([opener, page])).exitCode === 0) return
    } catch (e) { /* try the next opener */ }
  }
  $.ui.toast(page)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pika', description: 'Stop or resume your PikaMaxxing pokemon' })
    stopped = (await $.store.get('stopped')) === true
    compact = (await $.store.get('compact')) === true
    gfx = Boolean((await $.env.get('GHOSTTY_RESOURCES_DIR')) || (await $.env.get('KITTY_WINDOW_ID')))
    mode = modeFor(e.surface) || mode
    await loadTeam($)
    $.clock.every(TICK, () => {
      if (stopped || !pack()) return
      step()
      $.ui.invalidate('ui.render')
    })
    $.clock.every(300000, () => loadTeam($)) // tokens and team order change on the site
    return next(e)
  })

  on('command.run', { command: 'pika' }, async ($) => {
    await setStopped($, !stopped)
    return {}
  })

  // Claude's actions drive the phase (the Mac app reads these from hook files)
  on('turn.start', async ($, e, next) => {
    phase = 'think'; quietMs = 0
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    phase = 'tool'; tool = e.tool || ''; quietMs = 0
    try {
      return await next(e)
    } finally {
      if (phase === 'tool') phase = 'think'
    }
  }).catch(passThrough)
  on('turn.complete', async ($, e, next) => {
    phase = 'done'; quietMs = 0
    return next(e)
  })
  on('classic.Notification', async ($, e, next) => {
    phase = 'alert'; quietMs = 0
    return next(e)
  }).catch(passThrough)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const want = modeFor(e.surface)
    if (!want || !cur()) return next(e)
    if (want !== mode) { mode = want; P.x = null } // session shown on another app
    if (!pack()) { loadPack($, cur().sprite).then(() => $.ui.invalidate('ui.render')); return next(e) }
    const { Box, Text, Button, Raster, Image, Svg } = $.ui.resolve(e)
    cols = e.props.bodyColumns
    const theirs = await next(e)
    const below = theirs ? [theirs] : []

    if (stopped) {
      return Box({
        flexDirection: 'column',
        children: [
          Box({ flexDirection: 'row', columnGap: 1, children: [
            Button({ key: 'resume', label: '▶', plain: true, onPress: () => setStopped($, false) }),
            Text({ dimColor: true, children: [cur().species + ' is resting'] }),
          ] }),
          ...below,
        ],
      })
    }

    const b = box(), f = frameList()
    const img = f.imgs[P.fi % Math.max(1, f.imgs.length)]
    const pet = cur()
    const name = pet.species + (pet.shiny ? ' ✦' : '')
    const pct = Math.max(0, Math.min(100, pet.exp_pct ?? 0))

    // desktop: a red frame on the app's own background, so its native buttons
    // look as the app intends in dark and light themes; the drawing uses
    // mid-tone colours that read on both. Minimize/expand sits top-left.
    const dbtn = (key, label, onPress) => Button({ key, label, onPress })
    const corner = Box({ alignSelf: 'flex-start', children: [compact
      ? dbtn('expand', '+', () => setCompact($, false))
      : dbtn('minimize', '–', () => setCompact($, true))] })
    const frame = (children) => Box({
      flexDirection: 'column',
      children: [
        Box({ key: 'card', flexDirection: 'row', alignItems: 'center', width: '100%', columnGap: 2,
              borderStyle: 'round', borderColor: C.edge, paddingX: 1, children }),
        ...below,
      ],
    })

    if (mode === 'svg' && compact) {
      return frame([corner, Svg({ alt: name, width: STRIP_W, height: STRIP_H, source: strip(img, b) })])
    }

    if (mode === 'svg') {
      return frame([
        corner,
        Svg({ alt: name + ', ' + phaseLabel() + ', ' + pct + '% to next level',
              width: CARD_W, height: CARD_H, source: card(pet, name, pct, img, b) }),
        Box({ flexGrow: 1 }),
        Box({ flexDirection: 'column', rowGap: 1, children: [
          Box({ flexDirection: 'row', columnGap: 1, children: [
            dbtn('prev', '‹', () => switchTo($, -1)),
            Text({ dimColor: true, children: [(idx + 1) + ' / ' + team.length] }),
            dbtn('next', '›', () => switchTo($, 1)),
          ] }),
          Box({ flexDirection: 'row', columnGap: 1, children: [
            dbtn('stop', 'Stop', () => setStopped($, true)),
            dbtn('page', 'Trainer page ↗', () => openPage($)),
          ] }),
        ] }),
      ])
    }

    const btn = (key, label, onPress) => Button({ key, label, plain: true, dimColor: true, onPress })
    if (compact) { // minimized: the pokemon walks one slim line, nothing else asks for attention
      const m = mode === 'png'
        ? Image({ key: 'pika', source: { png: img }, columns: miniCols(), rows: MINI_ROWS, alt: pet.species })
        : Raster({ key: 'pika', columns: b.columns, rows: b.rows, cells: img })
      return Box({
        flexDirection: 'column',
        children: [
          Box({ flexDirection: 'row', children: [
            Box({ width: 3, children: [btn('expand', '+', () => setCompact($, false))] }),
            Box({ paddingLeft: P.x || 0, children: [m] }),
          ] }),
          ...below,
        ],
      })
    }

    const mon = mode === 'png'
      ? Image({ key: 'pika', source: { png: img }, columns: b.columns, rows: b.rows, alt: pet.species })
      : Raster({ key: 'pika', columns: b.columns, rows: b.rows, cells: img })
    const full = Math.round(GAUGE_W * pct / 100)
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          children: [
            // controls: minimize in the top-left corner, then switch, then stop / page
            Box({ flexDirection: 'column', width: BTN_W, children: [
              btn('minimize', '−', () => setCompact($, true)),
              Box({ flexDirection: 'row', columnGap: 1, children: [
                btn('prev', '‹', () => switchTo($, -1)), btn('next', '›', () => switchTo($, 1)) ] }),
              Box({ flexDirection: 'row', columnGap: 1, children: [
                btn('stop', '■', () => setStopped($, true)), btn('page', '↗', () => openPage($)) ] }),
            ] }),
            // who it is, how far to the next level, and whose app this is
            Box({ flexDirection: 'column', width: INFO_W, children: [
              Text({ wrap: 'truncate', children: [Text({ bold: true, children: [name] }), ' ',
                                                  Text({ dimColor: true, children: [(idx + 1) + '/' + team.length] })] }),
              Box({ key: 'exp', flexDirection: 'row', children: [
                Text({ color: pct >= 100 ? 'yellow' : 'cyan', children: ['━'.repeat(full)] }),
                Text({ dimColor: true, children: ['─'.repeat(GAUGE_W - full) + ' '] }),
                Text({ dimColor: pct < 100, color: pct >= 100 ? 'yellow' : undefined,
                       children: [pct >= 100 ? 'MAX' : pct + '%'] }),
              ] }),
              Box({ flexDirection: 'row', columnGap: 1, children: [
                ...(mode === 'png' ? [Image({ key: 'logo', source: { png: LOGO_PNG }, columns: 2, rows: 1, alt: ' ' })] : []),
                Text({ color: 'red', dimColor: true, children: ['PikaMaxxing'] }),
              ] }),
            ] }),
            Box({ paddingLeft: P.x || 0, children: [mon] }),
          ],
        }),
        ...below,
      ],
    })
  })
}

// ---- desktop card: one SVG in the PikaMaxxing pokedex palette ----
const CARD_W = 560, CARD_H = 104
const STAGE_X = 176, STAGE_Y = 8, STAGE_W = CARD_W - STAGE_X - 10, STAGE_H = CARD_H - 20
const GROUND = STAGE_Y + STAGE_H - 10
// mid-tones that read on the desktop app's dark and light backgrounds alike
const C = { edge: '#b91c1c', name: '#d97757', brand: '#e0553f', dim: '#8b8b8b', ground: '#8b8b8b',
            track: 'rgba(139,139,139,.28)', exp: '#3b82f6', max: '#d4a017', ball: '#e0553f', hole: '#f5f5f5' }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function phaseLabel() {
  const resting = phase === 'idle' || phase === 'done'
  if (resting && quietMs > SLEEP_MS) return 'napping'
  if (phase === 'tool') return 'using ' + (tool || 'a tool')
  return { think: 'thinking…', done: 'done!', alert: 'needs you', idle: 'hanging out' }[phase] || 'hanging out'
}

const STRIP_W = 560, STRIP_H = 40, STRIP_SPR = 32 // minimized desktop line

function strip(img, b) {
  const sw = Math.round(STRIP_SPR * b.w / b.h), x = 8 + (P.x || 0), ground = STRIP_H - 4
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="0 0 ${STRIP_W} ${STRIP_H}">`
    + `<line x1="4" y1="${ground}" x2="${STRIP_W - 4}" y2="${ground}" stroke="${C.ground}" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round"/>`
    + (img ? `<ellipse cx="${x + sw / 2}" cy="${ground}" rx="${sw * 0.28}" ry="2" fill="#000" opacity=".22"/>`
      + `<svg x="${x}" y="${ground - STRIP_SPR + 2}" width="${sw}" height="${STRIP_SPR}" viewBox="0 0 ${b.w} ${b.h}" `
      + `shape-rendering="crispEdges">${img}</svg>` : '')
    + `</svg>`
}

function card(pet, name, pct, img, b) {
  const font = `font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`
  const dots = team.map((_, i) => {
    const cx = 18 + i * 14
    return i === idx
      ? `<circle cx="${cx}" cy="74" r="5" fill="${C.ball}" stroke="${C.ball}" stroke-width="1.5"/>`
        + `<line x1="${cx - 5}" y1="74" x2="${cx + 5}" y2="74" stroke="${C.hole}" stroke-width="1.2"/>`
        + `<circle cx="${cx}" cy="74" r="1.8" fill="${C.hole}" stroke="${C.hole}" stroke-width="1"/>`
      : `<circle cx="${cx}" cy="74" r="4" fill="none" stroke="${C.dim}" stroke-width="1.2" opacity=".55"/>`
  }).join('')
  const bx = 38, bw = 92, maxed = pct >= 100
  const sw = Math.round(SVG_H * b.w / b.h), x = STAGE_X + 8 + (P.x || 0)
  const sprite = img
    ? `<ellipse cx="${x + sw / 2}" cy="${GROUND}" rx="${sw * 0.28}" ry="3" fill="#000" opacity=".22"/>`
      + `<svg x="${x}" y="${GROUND - SVG_H + 3}" width="${sw}" height="${SVG_H}" viewBox="0 0 ${b.w} ${b.h}" `
      + `shape-rendering="crispEdges">${img}</svg>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">`
    + `<svg x="14" y="10" width="17" height="15" viewBox="0 0 14 12" shape-rendering="crispEdges">${LOGO_SVG}</svg>`
    + `<text x="36" y="22" ${font} font-size="10" font-weight="700" letter-spacing="1.5" fill="${C.brand}">PIKAMAXXING</text>`
    + `<text x="14" y="45" ${font} font-size="15" font-weight="700" fill="${C.name}">${esc(name)}</text>`
    + `<text x="14" y="60" ${font} font-size="11" fill="${C.dim}">${esc(phaseLabel())}</text>`
    + dots
    + `<text x="14" y="96" ${font} font-size="9" font-weight="700" fill="${C.dim}">EXP</text>`
    + `<rect x="${bx}" y="88" width="${bw}" height="9" rx="4.5" fill="${C.track}"/>`
    + (pct > 0 ? `<rect x="${bx}" y="88" width="${Math.max(9, bw * pct / 100).toFixed(1)}" height="9" rx="4.5" fill="${maxed ? C.max : C.exp}"/>` : '')
    + `<text x="${bx + bw + 6}" y="96" ${font} font-size="9" font-weight="700" fill="${maxed ? C.max : C.dim}">${maxed ? 'MAX' : pct + '%'}</text>`
    + `<line x1="${STAGE_X + 6}" y1="${GROUND}" x2="${STAGE_X + STAGE_W - 6}" y2="${GROUND}" stroke="${C.ground}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`
    + sprite
    + `</svg>`
}
