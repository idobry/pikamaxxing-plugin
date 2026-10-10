// PikaMaxxing mod: your team's pokemon lives in the band above the prompt and
// acts out what Claude is doing, with the same behaviour model as the Mac app
// (client/pet_overlay.py): Charge routine while thinking, a move per tool,
// victory pose when a turn ends, idle antics, roaming walks, naps when quiet.
// Left controls: stop, previous / next team member, open the trainer page.
const FALLBACK = 'https://pikamaxxing.vercel.app'
const TICK = 100        // ms per engine step; the band redraws at most 10/s
const SLEEP_MS = 300000 // quiet this long -> nap (Mac: SESSION_SLEEP_SECS)
const CTRL_W = 14       // columns for the left controls

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
const SVG_STAGE = 320, SVG_H = 56, SVG_SPEED = 6 // desktop stage in CSS px
let stopped = false
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
  if (mode === 'svg') {
    const b = box()
    return { w: Math.round(SVG_H * b.w / b.h), stage: SVG_STAGE, speed: SVG_SPEED }
  }
  const w = box().columns
  return { w, stage: Math.max(w, cols - CTRL_W - 2), speed: 1 }
}

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
    let mon
    if (mode === 'svg') { // the pokemon roams inside one SVG stage; viewBox in sprite px
      const s = SVG_H / b.h
      mon = Svg({
        alt: cur().species, width: SVG_STAGE, height: SVG_H,
        source: `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_STAGE}" height="${SVG_H}" `
              + `viewBox="0 0 ${(SVG_STAGE / s).toFixed(2)} ${b.h}" shape-rendering="crispEdges">`
              + `<g transform="translate(${((P.x || 0) / s).toFixed(2)} 0)">${img || ''}</g></svg>`,
      })
    } else if (mode === 'png') {
      mon = Image({ key: 'pika', source: { png: img }, columns: b.columns, rows: b.rows, alt: cur().species })
    } else {
      mon = Raster({ key: 'pika', columns: b.columns, rows: b.rows, cells: img })
    }
    const pet = cur()
    return Box({
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          children: [
            Box({ flexDirection: 'column', ...(mode === 'svg' ? {} : { width: CTRL_W }), children: [
              Box({ flexDirection: 'row', columnGap: 2, children: [
                Button({ key: 'stop', label: '■', plain: true, dimColor: true, onPress: () => setStopped($, true) }),
                Button({ key: 'prev', label: '‹', plain: true, dimColor: true, onPress: () => switchTo($, -1) }),
                Button({ key: 'next', label: '›', plain: true, dimColor: true, onPress: () => switchTo($, 1) }),
                Button({ key: 'page', label: '↗', plain: true, dimColor: true, onPress: () => openPage($) }),
              ] }),
              Text({ wrap: 'truncate', children: [pet.species + (pet.shiny ? ' ✦' : '')] }),
              Text({ dimColor: true, wrap: 'truncate',
                     children: [(idx + 1) + '/' + team.length + ' · ' + short(pet.tokens)] }),
            ] }),
            mode === 'svg' ? mon : Box({ paddingLeft: P.x || 0, children: [mon] }),
          ],
        }),
        ...below,
      ],
    })
  })
}
