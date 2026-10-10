// PikaMaxxing: your Claude Code token usage raises pokemon. This mod is the
// whole client: it reports each turn's tokens, and your team lives in the band
// above the prompt, acting out what Claude is doing (Charge routine while
// thinking, a move per tool, victory pose, idle antics, roaming, naps).
// Every session's pokemon shares one scene, so parallel agents battle when
// idle and charge together when busy, and a pokemon that levels up evolves
// on screen. Terminal (kitty graphics or colored cells) and desktop app (SVG).
const VERSION = '2.0.0'
const FALLBACK = 'https://pikamaxxing.vercel.app'
const TICK = 100         // ms per engine step; the terminal band redraws at most 10/s
const SLEEP_MS = 300000  // quiet this long -> nap
const LIVE_MS = 15000    // a session not heard from this long has left the scene
const BEAT_MS = 5000     // presence heartbeat
const POLL_MS = 2000     // how often a session reads the others
const MAX_PETS = 3
const LEFT_W = 16, RIGHT_W = 29 // terminal: brand on the left, info and controls on the right, columns
const LINK_TOOL = 'link'

// behaviour tables (from the original PikaMaxxing desktop overlay)
const IDLE_BEHAVIORS = ['Eat', 'Nod', 'LookUp', 'DeepBreath', 'Shake', 'Trip', 'Laying']
const THINK_FLOURISH = ['DeepBreath', 'Shake', 'Nod', 'LookUp', 'Hop', 'Double', 'Trip']
const POKES = ['Pose', 'Hop', 'Shake', 'Nod']
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

// tokens a turn earns: the same fields PikaMaxxing has always counted (cache reads excluded)
export function earned(usage) {
  if (!usage) return 0
  return (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_creation_input_tokens || 0)
}

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]
const newer = (a, b) => { // is version a newer than b
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

// ---- state ----
let base = FALLBACK, secret = '', page = FALLBACK
let account = 'unlinked'  // unlinked | ok | no_pet | unknown_secret
let team = []             // slot-ordered pets from /api/pool
let mySid = 'local'
const pets = new Map()    // sid -> pokemon in the scene (this session's and the others')
const packs = {}          // 'mode:sprite' -> frames for that mode
const loading = new Set()
const lastDex = {}        // pet id -> dex last seen, to catch an evolution
let gfx = false           // kitty graphics (Ghostty, kitty): real pixel frames
let mode = 'cells'        // png: terminal Image, cells: terminal Raster, svg: desktop app
let stopped = false, compact = false
let cols = 80
let lastScene = '', drawSeq = 0, lastBeat = 0
let battle = null         // shared fight: {start, winner, a, b, manual}
let battleIn = rand(180, 420) * 1000, teamIn = rand(10, 20) * 1000
let legacy = false        // the old desktop app's Stop hook still reports; don't double count
let pending = 0           // tokens earned and not yet credited
let updateHint = ''

const SVG_H = 56, SVG_SPEED = 6, GAUGE_W = 14
// the PikaMaxxing logo, 14x12 pixel art: PNG for the terminal, paths for the desktop card
const LOGO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAHAAAABgCAYAAADFNvbQAAABM0lEQVR42u3cUQ3CMBRA0ZXghfAzBwhAAQbwgAY8YAAFE4CD/hDUgIM18Ea7wTnfBMJu+pKXJU2Xff/sAo5DTh0fiz7/lUe4bAIKiIAIKCACUl96nA6je8gt30M/8O97YnTP2/VbJ9AIRUAEREABEZBJ98DSB+yJbfe8zfmanEAjFAEREAEFREAmtI5+QWmPKRryoh9g+P87gUYoAiIgAgqIgNQVfhdXel/IuNL7PifQCEVABERAARGQ2nugPW/ee6ITaIQiIAIKiIAIyLt7oD3PCURABBQQAREQAQVEQAREQAEREAER8GcV74mJ3gfa+h6V1r79/JxAIxQBEVBABERABBQQAREQAQVEQARkhHtiZs49MUYoAiIgAgqIgNTeA+2Jbfc8J9AIRUAEREABEZCJvQBa9TbM3y6NugAAAABJRU5ErkJggg=='
const LOGO_SVG = '<path fill="#9c492e" d="M0 0h2v1h-2zM12 0h2v1h-2zM1 1h2v1h-2zM11 1h2v1h-2zM2 2h2v1h-2zM10 2h2v1h-2zM1 8h2v1h-2zM11 8h2v1h-2zM1 9h2v1h-2zM11 9h2v1h-2z"/><path fill="#d97757" d="M0 1h1v1h-1zM13 1h1v1h-1zM1 2h1v1h-1zM12 2h1v1h-1zM1 3h3v1h-3zM10 3h3v1h-3zM2 4h10v1h-10zM1 5h12v1h-12zM0 6h14v1h-14zM0 7h14v1h-14zM0 8h1v1h-1zM3 8h8v1h-8zM13 8h1v1h-1zM0 9h1v1h-1zM3 9h8v1h-8zM13 9h1v1h-1zM1 10h12v1h-12zM2 11h10v1h-10z"/>'

function newPet(sid, slot) {
  return { sid, slot, phase: 'idle', tool: '', at: Date.now(), anim: null, show: null, fi: 0, left: 0,
           once: null, dir: 1, x: null, roamIn: rand(1, 4) * 1000, roamLeft: 0, thinkQ: [], thinkLeft: 0,
           thinkShow: 'Charge', idleIn: rand(10, 30) * 1000, idleMode: 'Sit', idleHold: 0, ov: null, evo: null }
}
const me = () => pets.get(mySid)
const petOf = (p) => team[Math.min(p.slot, team.length - 1)]
const spriteOf = (p) => p.ov?.sprite || petOf(p)?.sprite
const packFor = (sprite) => sprite && packs[mode + ':' + sprite]
const has = (p, name) => mode === 'cells' || Boolean(packFor(spriteOf(p))?.anims?.[name])
const modeFor = (surface) => surface === 'desktop' ? 'svg' : surface === 'terminal' ? (gfx ? 'png' : 'cells') : null
const cut = (p) => { p.fi = 0; p.left = 0 }
const resting = (p) => p.phase === 'idle' || p.phase === 'done'
const quiet = (p) => Date.now() - p.at
// the scene, in slot order, capped like the original overlay
const scenePets = () => [...pets.values()].sort((a, b) => a.slot - b.slot).slice(0, MAX_PETS)

// ---- behaviour engine (one per pokemon) ----
function nextBeat(p) {
  if (!p.thinkQ.length) {
    const moves = [...THINK_FLOURISH].sort(() => Math.random() - 0.5).slice(0, 3)
    p.thinkQ = moves.flatMap((m) => [['Charge', 800 + Math.random() * 700], [m, 700 + Math.random() * 600]])
  }
  const [show, ms] = p.thinkQ.shift()
  p.thinkLeft = ms
  return show
}

function roam(p, show, kind) {
  if (show === 'Walk' || show === 'Sleep' || p.once) return show
  if (p.roamLeft > 0) {
    p.roamLeft -= TICK
    if (p.roamLeft <= 0) cut(p)
    return 'Walk'
  }
  p.roamIn -= TICK
  if (p.roamIn <= 0) {
    p.roamIn = rand(...ROAM_GAP[kind]) * 1000
    p.roamLeft = rand(...ROAM_LEN) * 1000
    if (Math.random() < 0.45) p.dir *= -1
    cut(p)
    return 'Walk'
  }
  return show
}

function behave(p) {
  const name = animFor(resting(p) && quiet(p) > SLEEP_MS ? 'sleep' : p.phase, p.tool)
  if (name === 'Charge') { // thinking: the person is watching, so perform
    if (p.anim !== 'Charge') {
      Object.assign(p, { anim: 'Charge', once: null, idleHold: 0, thinkQ: [], thinkShow: 'Charge' })
      p.thinkLeft = rand(100, 2000)
    }
    p.thinkLeft -= TICK
    if (p.thinkLeft <= 0) { p.thinkShow = nextBeat(p); cut(p) }
    return p.once || roam(p, p.thinkShow, 'think')
  }
  if (name !== p.anim) {
    if (name === 'Sit' && p.anim !== null) p.once = 'Pose' // victory pose when work finishes
    p.anim = name
    cut(p)
    p.idleHold = 0
    p.idleIn = rand(10, 30) * 1000
  }
  let n = name
  if (name === 'Sit' || name === 'Idle') { // idle life: antics, strolls, naps
    if (p.idleHold > 0) {
      p.idleHold -= TICK
      n = p.idleMode
    } else if (!p.once) {
      p.idleIn -= TICK
      if (p.idleIn <= 0) {
        p.idleIn = rand(10, 30) * 1000
        const r = Math.random()
        if (r < 0.4) p.once = pick(IDLE_BEHAVIORS)
        else if (r < 0.75) { p.idleMode = 'Walk'; p.idleHold = rand(8, 20) * 1000 }
        else { p.idleMode = 'Sleep'; p.idleHold = rand(15, 40) * 1000 }
        cut(p)
      }
    }
  }
  return roam(p, p.once || n, name === 'Sit' || name === 'Idle' ? 'idle' : 'work')
}

function stepPet(p, i, n) {
  let show
  if (p.ov) { // a ceremony (battle, evolution) drives this pokemon
    show = p.ov.name
    if (p.ov.face) p.dir = p.ov.face
  } else {
    show = behave(p)
    if (p.once && !has(p, p.once)) p.once = null // species without that antic
  }
  if (!has(p, show)) show = 'Idle'
  if (show !== p.show) { p.show = show; cut(p) }

  const frames = frameList(p)
  p.left -= TICK
  while (p.left <= 0 && frames.ms.length) {
    if (++p.fi >= frames.ms.length) {
      p.fi = 0
      if (p.once && !p.ov) p.once = null
    }
    p.left += frames.ms[p.fi]
  }

  const g = geo(p, i, n)
  if (p.x === null) p.x = rand(g.lo, g.hi)
  if (show === 'Walk' && !p.ov) {
    if (p.x <= g.lo && p.dir < 0) p.dir = 1
    else if (p.x >= g.hi && p.dir > 0) p.dir = -1
    p.x += p.dir * g.speed
  }
  p.x = Math.max(0, Math.min(p.x, g.stage - g.w))
}

// where a pokemon roams: terminal columns or desktop CSS px; with company,
// each keeps to the neighbourhood of its own home spot
function geo(p, i = 0, n = 1) {
  const b = boxOf(p)
  let w, stage, speed
  if (mode === 'svg') {
    const h = compact ? STRIP_SPR : SVG_H
    w = Math.round(h * b.w / b.h)
    stage = (compact ? STRIP_W : STAGE_W) - 16
    speed = SVG_SPEED
  } else {
    w = compact ? miniCols(p) : b.columns
    stage = Math.max(w, compact ? cols - 3 : cols - LEFT_W - RIGHT_W - 1)
    speed = 1
  }
  let lo = 0, hi = Math.max(0, stage - w)
  if (n > 1) {
    const home = Math.round(stage * (i + 1) / (n + 1) - w / 2), span = Math.round(stage / (n + 1) * 0.8)
    lo = Math.max(0, home - span)
    hi = Math.min(stage - w, home + span)
  }
  return { w, stage, speed, lo, hi }
}

const MINI_ROWS = 2
function miniCols(p) {
  const b = boxOf(p)
  return mode === 'cells' ? b.columns : Math.max(1, Math.round(b.columns * MINI_ROWS / b.rows))
}

function boxOf(p) {
  const k = packFor(spriteOf(p))
  return !k ? { columns: 1, rows: 1, w: 1, h: 1 } : mode === 'cells' ? { columns: k.columns, rows: k.rows } : k.box
}

// the frames on screen: {ms, imgs}; cells mode only has the walk cycle
function frameList(p) {
  const k = packFor(spriteOf(p))
  if (!k) return { ms: [], imgs: [] }
  if (mode === 'cells') return { ms: k.frames.map(() => k.ms), imgs: k.frames }
  const a = k.anims[p.show] || k.anims.Idle || k.anims.Walk
  if (p.ov?.glow && a.glow) return { ms: a.ms, imgs: a.glow }
  const sideways = a.right && (p.show === 'Walk' || p.ov)
  return { ms: a.ms, imgs: sideways ? (p.dir < 0 ? a.left : a.right) : a.down }
}

// ---- ceremonies shared by the scene ----
// Battle: the original overlay's mock fight (approach, 4 rounds, finish,
// retreat), on wall-clock time so every session's band plays the same one.
const B_APPROACH = 3000, B_ROUND = 1333, B_FINISH = 2333, B_RETREAT = 3000
const B_TOTAL = B_APPROACH + 4 * B_ROUND + B_FINISH + B_RETREAT

function battleStep(sp) {
  const a = pets.get(battle.a), b = pets.get(battle.b)
  const t = Date.now() - battle.start
  if (!a || !b || t > B_TOTAL || (!battle.manual && (!resting(a) || !resting(b)))) return false
  if (t < 0) return true
  const n = sp.length, ga = geo(a, sp.indexOf(a), n), gb = geo(b, sp.indexOf(b), n)
  const mid = Math.round(ga.stage / 2), L = mid - ga.w - 1, R = mid + 1
  const walkTo = (p, g, tx) => {
    if (p.x === null) p.x = tx
    if (Math.abs(tx - p.x) <= g.speed) { p.x = tx; return true }
    p.x += tx > p.x ? g.speed : -g.speed
    return false
  }
  if (t < B_APPROACH || t >= B_TOTAL - B_RETREAT) {
    const back = t >= B_TOTAL - B_RETREAT
    const ta = back ? Math.round((ga.lo + ga.hi) / 2) : L, tb = back ? Math.round((gb.lo + gb.hi) / 2) : R
    const fa = ta >= a.x ? 1 : -1, fb = tb >= b.x ? 1 : -1
    a.ov = walkTo(a, ga, ta) ? { name: 'Idle', face: back ? fa : 1 } : { name: 'Walk', face: fa }
    b.ov = walkTo(b, gb, tb) ? { name: 'Idle', face: back ? fb : -1 } : { name: 'Walk', face: fb }
  } else if (t < B_APPROACH + 4 * B_ROUND) {
    const round = Math.floor((t - B_APPROACH) / B_ROUND)
    const atk = (round + battle.winner) % 2 === 0 ? a : b, def = atk === a ? b : a
    atk.ov = { name: 'Attack', face: atk === a ? 1 : -1 }
    def.ov = { name: 'Hurt', face: def === a ? 1 : -1 }
  } else {
    const win = battle.winner === 0 ? a : b, lose = win === a ? b : a
    win.ov = { name: 'Pose', face: win === a ? 1 : -1 }
    lose.ov = { name: 'Tumble', face: lose === a ? 1 : -1 }
  }
  return true
}

// Evolution: freeze on the old form, flicker old/new white silhouettes with an
// accelerating beat, hold the flash, then reveal with a Pose and Hops.
function evoStep(p) {
  const e = p.evo, t = (e.t += TICK) // local to this band, so tick time, not wall time
  if (t < 667) p.ov = { name: 'Idle', sprite: e.from }
  else if (t < 4333) {
    const ft = (t - 667) / 33.3, period = Math.max(2, 12 - Math.floor(ft / 11))
    p.ov = { name: 'Idle', sprite: Math.floor(ft / period) % 2 === 0 ? e.from : e.to, glow: true }
  } else if (t < 4833) p.ov = { name: 'Idle', sprite: e.to, glow: true }
  else if (t < 6333) p.ov = { name: 'Pose', sprite: e.to }
  else if (t < 8167) p.ov = { name: 'Hop', sprite: e.to }
  else { p.evo = null; p.ov = null }
}

function direct($) {
  const sp = scenePets()
  for (const p of pets.values()) p.ov = null
  for (const p of sp) if (p.evo) evoStep(p)
  if (battle && !battleStep(sp)) {
    if (isLeader()) $.store.delete('battle').catch(() => {})
    battle = null
    for (const p of sp) if (!p.evo) p.ov = null
  }
  // the leader schedules ambient fights while the first two are idle
  if (!battle && isLeader() && sp.length >= 2 && resting(sp[0]) && resting(sp[1])) {
    battleIn -= TICK
    if (battleIn <= 0) {
      battleIn = rand(180, 420) * 1000
      startBattle($, sp[0], sp[1], false)
    }
  }
  // parallel agents thinking: now and then a wave of hops, then charge as one
  const thinkers = sp.filter((p) => p.phase === 'think' && !p.ov)
  if (thinkers.length >= 2) {
    teamIn -= TICK
    if (teamIn <= 0) {
      teamIn = rand(18, 40) * 1000
      thinkers.forEach((p, k) => {
        p.thinkQ = [['Hop', 350 + 180 * k], ['Charge', 2200 - 180 * k]]
        p.thinkLeft = 0; p.roamLeft = 0; p.roamIn = 3000
      })
    }
  } else teamIn = rand(10, 20) * 1000
}

const isLeader = () => scenePets()[0]?.sid === mySid

async function startBattle($, a, b, manual) {
  battle = { start: Date.now() + 2500, winner: rand(0, 1), a: a.sid, b: b.sid, manual }
  await $.store.set('battle', battle)
}

// ---- sessions share the scene through the plugin store ----
async function publish($) {
  const p = me()
  if (!p) return
  lastBeat = Date.now()
  await $.store.set('s:' + mySid, { slot: p.slot, phase: p.phase, tool: p.tool, at: p.at, ts: lastBeat })
}

async function readOthers($) {
  const now = Date.now(), seen = new Set([mySid])
  for (const k of await $.store.keys()) {
    if (!k.startsWith('s:') || k === 's:' + mySid) continue
    const v = await $.store.get(k)
    if (!v || now - v.ts > LIVE_MS) {
      if (v && now - v.ts > 3600000) await $.store.delete(k) // long gone
      continue
    }
    const sid = k.slice(2)
    seen.add(sid)
    const p = pets.get(sid) || newPet(sid, v.slot)
    if (p.slot !== v.slot) { p.slot = v.slot; p.x = null }
    Object.assign(p, { phase: v.phase, tool: v.tool, at: v.at })
    pets.set(sid, p)
    loadPack($, spriteOf(p))
  }
  for (const sid of pets.keys()) if (!seen.has(sid)) pets.delete(sid)
  const b = await $.store.get('battle')
  if (b && (!battle || b.start !== battle.start)) battle = b
}

// a new session takes the lowest team slot nobody in the scene holds
function freeSlot(skip) {
  const taken = new Set([...pets.values()].filter((p) => p.sid !== skip).map((p) => p.slot))
  for (let s = 0; s < Math.max(1, team.length); s++) if (!taken.has(s)) return s
  return 0
}

// ---- server ----
async function api($, path, body) {
  const init = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined
  const r = await $.http.fetch(base + path, init)
  let data = null
  try { data = JSON.parse(r.text) } catch (e) { /* not json */ }
  return { ok: r.ok, status: r.status, data }
}

async function loadPack($, sprite) {
  const key = mode + ':' + sprite
  if (!sprite || packs[key] || loading.has(key)) return
  loading.add(key)
  const path = { png: '/api/pack/' + sprite, svg: '/api/pack/' + sprite + '?fmt=svg', cells: '/api/cells/' + sprite }[mode]
  try {
    const r = await $.http.fetch(base + path)
    if (r.ok) packs[key] = JSON.parse(r.text)
  } catch (e) { /* keep showing what we have */ }
  loading.delete(key)
}

// fold fresh pet data in, and start an evolution for any pokemon in the scene
// whose form changed since we last saw it
function absorb(list) {
  for (const pet of list) {
    const was = lastDex[pet.id]
    lastDex[pet.id] = pet.dex
    if (was && was !== pet.dex) {
      const p = scenePets().find((q) => petOf(q)?.id === pet.id)
      const old = team.find((t) => t.id === pet.id)?.sprite
      if (p && old) p.evo = { t: 0, from: old, to: pet.sprite }
    }
    const i = team.findIndex((t) => t.id === pet.id)
    if (i >= 0) team[i] = { ...team[i], ...pet }
  }
}

async function loadTeam($) {
  if (!secret) { account = 'unlinked'; return }
  try {
    const r = await api($, '/api/pool?secret=' + secret)
    if (r.status === 404) {
      const me404 = await api($, '/api/me?secret=' + secret)
      account = me404.data?.error === 'no_pet' ? 'no_pet' : 'unknown_secret'
      return
    }
    if (!r.ok || !r.data) return
    const ps = r.data.pets || []
    const slotted = ps.filter((p) => p.team_pos).sort((a, b) => a.team_pos - b.team_pos)
    const fresh = slotted.length ? slotted : ps.slice(0, 1)
    if (!fresh.length) { account = 'no_pet'; return }
    page = r.data.page || base + '/u/' + secret
    absorb(fresh) // against the team as it was, to catch a changed form
    team = fresh.map((p) => ({ ...p }))
    account = 'ok'
    for (const p of pets.values()) {
      loadPack($, spriteOf(p))
      if (p.evo) loadPack($, p.evo.to)
    }
  } catch (e) { /* offline: keep what we have */ }
}

async function flush($) {
  if (!secret || legacy || pending <= 0 || account === 'unknown_secret') return
  const sending = pending
  try {
    const r = await api($, '/api/usage', { secret, tokens: sending })
    if (!r.ok) return
    pending = Math.max(0, pending - sending)
    await $.store.set('pending:' + mySid, pending)
    if (r.data?.id) {
      absorb([r.data])
      for (const p of pets.values()) if (p.evo) loadPack($, p.evo.to)
      lastScene = ''
    }
  } catch (e) { /* stays queued for the next try */ }
}

async function link($, value) {
  const s = String(value || '').trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(s)) return 'That is not a trainer secret. Copy the /pika link line from your trainer page.'
  const r = await api($, '/api/me?secret=' + s).catch(() => null)
  if (!r) return 'Could not reach PikaMaxxing. Check your connection and try again.'
  if (r.status === 404 && r.data?.error !== 'no_pet') return 'Unknown secret. Copy the /pika link line from your trainer page.'
  secret = s
  await $.store.set('link', { secret, url: base })
  await loadTeam($)
  const p = me()
  if (p) { p.slot = freeSlot(mySid); await publish($) }
  lastScene = ''
  $.ui.invalidate('ui.render')
  return account === 'no_pet'
    ? 'Linked! Now hatch your first pokemon on your trainer page: ' + base + '/u/' + secret
    : 'Linked! ' + (team[0]?.species || 'Your pokemon') + ' now earns from every Claude turn.'
}

// ---- tidy up the retired desktop app, if this machine still has it ----
const OLD_MARKERS = ['pet_state', 'state_hook', 'state-hook', 'report_usage', 'report-usage']
const OLD_AGENTS = ['com.pikamaxxing.agent', 'com.tokenmon.agent', 'com.pokemonmaxxing.agent']
const OLD_APPS = ['PikaMaxxing', 'PokemonMaxxing', 'Tokenmonmaxxing', 'Tokenmon']

async function retireOldApp($) {
  const home = await $.env.get('HOME')
  if (!home || !home.startsWith('/Users/')) return // the desktop app only ever ran on macOS
  const run = (argv) => $.process.run(argv).catch(() => null)
  const exists = (p) => $.fs.exists(p).catch(() => false)
  const support = home + '/Library/Application Support/PikaMaxxing'
  let removed = false

  if (!secret && await exists(support + '/config.json')) { // keep the trainer linked
    try {
      const cfg = JSON.parse(await $.fs.read(support + '/config.json'))
      if (/^[0-9a-f]{32}$/.test(cfg.secret || '')) {
        secret = cfg.secret
        await $.store.set('link', { secret, url: base })
      }
    } catch (e) { /* unreadable: the user can /pika link */ }
  }

  // its hooks in settings.json would report every turn a second time
  const settings = home + '/.claude/settings.json'
  try {
    const s = JSON.parse(await $.fs.read(settings))
    let changed = false
    for (const [ev, arr] of Object.entries(s.hooks || {})) {
      for (const e of arr) {
        const keep = (e.hooks || []).filter((h) => !OLD_MARKERS.some((m) => String(h.command || '').includes(m)))
        if (keep.length !== (e.hooks || []).length) { e.hooks = keep; changed = true }
      }
      s.hooks[ev] = arr.filter((e) => (e.hooks || []).length)
      if (!s.hooks[ev].length) delete s.hooks[ev]
    }
    if (changed) { // temp file + mv: never leave a half-written settings file
      await $.fs.write(settings + '.pikamaxxing.tmp', JSON.stringify(s, null, 2))
      await run(['mv', settings + '.pikamaxxing.tmp', settings])
      removed = true
    }
  } catch (e) { /* missing or not valid JSON: leave it alone */ }

  for (const a of OLD_AGENTS) {
    const plist = home + '/Library/LaunchAgents/' + a + '.plist'
    if (await exists(plist)) {
      const uid = (await run(['id', '-u']))?.stdout?.trim()
      if (uid) await run(['launchctl', 'bootout', 'gui/' + uid, plist])
      await run(['rm', '-f', plist])
      removed = true
    }
  }
  for (const n of OLD_APPS) {
    for (const dir of ['/Applications/', home + '/Applications/']) {
      if (await exists(dir + n + '.app')) {
        await run(['pkill', '-f', n + '.app/Contents/MacOS/' + n])
        await run(['rm', '-rf', dir + n + '.app'])
        removed = true
      }
    }
  }
  for (const p of [support, home + '/Library/Logs/PikaMaxxing.log']) {
    if (await exists(p)) { await run(['rm', '-rf', p]); removed = true }
  }
  legacy = await stillLegacy($, settings)
  if (removed && !legacy) $.ui.toast('PikaMaxxing now runs inside Claude Code: removed the old desktop app.')
}

async function stillLegacy($, settings) {
  try {
    const text = await $.fs.read(settings)
    return text.includes('report-usage') || text.includes('report_usage')
  } catch (e) { return false }
}

// ---- controls ----
async function setCompact($, value) {
  compact = value
  for (const p of pets.values()) p.x = null // re-place on the new stage
  await $.store.set('compact', value)
  $.ui.invalidate('ui.render')
}

async function setStopped($, value) {
  stopped = value
  await $.store.set('stopped', value)
  $.ui.invalidate('ui.render')
}

async function switchTo($, delta) {
  const p = me()
  if (!p || team.length < 2) return
  const taken = new Set([...pets.values()].filter((q) => q.sid !== mySid).map((q) => q.slot))
  let s = p.slot
  for (let i = 0; i < team.length; i++) { // the next slot nobody else shows, else simply the next
    s = (s + delta + team.length) % team.length
    if (!taken.has(s)) break
  }
  Object.assign(p, { slot: s, anim: null, show: null, once: null, x: null })
  await loadPack($, spriteOf(p))
  await publish($)
  $.ui.invalidate('ui.render')
}

function poke() {
  const p = me()
  if (!p || p.ov) return
  p.once = pick(POKES.filter((a) => has(p, a)).concat('Hop'))
  cut(p); p.idleHold = 0; p.roamLeft = 0
}

async function openPage($) {
  const url = account === 'unlinked' ? base : page
  for (const opener of [['open', url], ['xdg-open', url], ['cmd', '/c', 'start', '', url]]) {
    try {
      if ((await $.process.run(opener)).exitCode === 0) return
    } catch (e) { /* try the next opener */ }
  }
  $.ui.toast(url)
}

// Every button routes here by key. A ui.press hook answers before the
// per-drawing handle lookup, and keys stay stable across redraws.
function pressed($, key) {
  return {
    prev: () => switchTo($, -1), next: () => switchTo($, 1),
    stop: () => setStopped($, true), resume: () => setStopped($, false),
    page: () => openPage($), poke: () => poke(),
    minimize: () => setCompact($, true), expand: () => setCompact($, false),
  }[key]
}

// gating events: if our hook ever fails, the call goes through untouched
function passThrough($, e, next) {
  return next.called ? undefined : next(e)
}

async function setPhase($, phase, tool = '') {
  const p = me()
  if (!p) return
  const changed = p.phase !== phase || p.tool !== tool
  Object.assign(p, { phase, tool, at: Date.now() })
  if (changed) await publish($).catch(() => {})
}

async function pikaCommand($, args) {
  const [verb, ...rest] = String(args || '').trim().split(/\s+/)
  if (verb === 'link') return link($, rest.join(' '))
  if (verb === 'unlink') {
    secret = ''; account = 'unlinked'; team = []
    await $.store.delete('link')
    $.ui.invalidate('ui.render')
    return 'Unlinked. Run /pika link <secret> to connect a trainer again.'
  }
  if (verb === 'stop' || verb === 'resume') { await setStopped($, verb === 'stop'); return verb === 'stop' ? 'Stopped.' : 'Back!' }
  if (verb === 'battle') {
    const sp = scenePets()
    if (sp.length < 2) return 'A battle needs two Claude sessions open at once.'
    await startBattle($, sp[0], sp[1], true)
    return 'Fight!'
  }
  if (account === 'unlinked') return 'Not linked yet. Sign in at ' + FALLBACK + ', then run the /pika link line from your trainer page.'
  const p = me(), pet = p && petOf(p)
  return (pet ? pet.species + ' · ' + pet.tokens.toLocaleString() + ' tokens · ' + (pet.exp_pct ?? 0) + '% to next level\n' : '')
    + 'Commands: /pika link <secret> · /pika unlink · /pika stop · /pika resume · /pika battle'
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pika', description: 'PikaMaxxing: status, link <secret>, unlink, stop, resume, battle',
                               argumentHint: '[link <secret> | unlink | stop | resume | battle]' })
    await $.tool.register({
      name: LINK_TOOL,
      description: 'Link this machine to a PikaMaxxing trainer account using the 32-character secret from the trainer page.',
      inputSchema: { type: 'object', properties: { secret: { type: 'string' } }, required: ['secret'] },
    }).catch(() => {})
    mySid = await $.session.id().catch(() => 'local')
    stopped = (await $.store.get('stopped')) === true
    compact = (await $.store.get('compact')) === true
    gfx = Boolean((await $.env.get('GHOSTTY_RESOURCES_DIR')) || (await $.env.get('KITTY_WINDOW_ID')))
    mode = modeFor(e.surface) || mode
    const saved = await $.store.get('link')
    if (saved?.secret) { secret = saved.secret; base = (saved.url || FALLBACK).replace(/\/+$/, '') }
    await retireOldApp($).catch(() => {})
    pending = Number((await $.store.get('pending:' + mySid)) || 0)
    await readOthers($).catch(() => {})
    await loadTeam($)
    pets.set(mySid, newPet(mySid, freeSlot(mySid)))
    await publish($).catch(() => {})
    await loadPack($, spriteOf(me()))
    flush($)

    $.clock.every(TICK, () => {
      if (stopped || account !== 'ok') return
      direct($)
      const sp = scenePets()
      sp.forEach((p, i) => { if (packFor(spriteOf(p))) stepPet(p, i, sp.length) })
      if (Date.now() - lastBeat > BEAT_MS) publish($).catch(() => {})
      // desktop: the SVG animates itself, so redraw only when the scene
      // changes; every redraw replaces the buttons' press handles
      if (mode === 'svg') {
        const sig = scene()
        if (sig === lastScene) return
        lastScene = sig
      }
      $.ui.invalidate('ui.render')
    })
    $.clock.every(POLL_MS, () => { readOthers($).catch(() => {}) })
    $.clock.every(60000, () => { loadTeam($); flush($) })
    api($, '/api/version').then((r) => {
      if (r.data?.plugin && newer(r.data.plugin, VERSION)) {
        updateHint = 'PikaMaxxing ' + r.data.plugin + ' is out: /plugin marketplace update pikamaxxing, then /reload-plugins'
        $.ui.toast(updateHint)
      }
    }).catch(() => {})
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await $.store.delete('s:' + mySid).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'pika' }, async ($, e) => ({ text: await pikaCommand($, e.args) }))

  // Claude's actions drive this session's pokemon
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await setPhase($, 'think')
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'mcp__pikamaxxing__' + LINK_TOOL) return { result: await link($, e.secret) }
    await setPhase($, 'tool', e.tool || '')
    try {
      return await next(e)
    } finally {
      if (me()?.phase === 'tool') await setPhase($, 'think')
    }
  }).catch(passThrough)
  on('turn.complete', async ($, e, next) => {
    // every turn earns, subagents' included; the old app's hook would count it twice
    const add = legacy ? 0 : earned(e.usage)
    if (add > 0) {
      pending += add
      await $.store.set('pending:' + mySid, pending)
      flush($)
    }
    if (!e.agentId) await setPhase($, 'done')
    return next(e)
  })
  on('classic.Notification', async ($, e, next) => {
    await setPhase($, 'alert')
    return next(e)
  }).catch(passThrough)

  on('ui.press', { plugin: 'pikamaxxing' }, async ($, e, next) => {
    const act = pressed($, e.element)
    if (!act) return next(e)
    await act()
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const want = modeFor(e.surface)
    if (!want) return next(e)
    if (want !== mode) { mode = want; for (const p of pets.values()) p.x = null } // shown on another app
    const { Box, Text, Button, Raster, Image, Svg, Link } = $.ui.resolve(e)
    cols = e.props.bodyColumns
    const theirs = await next(e)
    const below = theirs ? [theirs] : []
    const btn = (key, label, onPress) => Button({ key, label, plain: true, dimColor: true, onPress })

    if (account !== 'ok') { // not linked, no pokemon yet, or a bad secret: one quiet line
      const msg = {
        unlinked: 'Sign in at pikamaxxing.vercel.app, then run the /pika link line from your trainer page',
        no_pet: 'Linked! Open your capsule on your trainer page to hatch your first pokemon',
        unknown_secret: 'This secret is no longer valid: run /pika link with the line from your trainer page',
      }[account]
      if (!msg) return next(e)
      return Box({ flexDirection: 'column', children: [
        Box({ flexDirection: 'row', columnGap: 1, children: [
          Text({ color: 'red', bold: true, children: ['PikaMaxxing'] }),
          Text({ dimColor: true, wrap: 'truncate', children: [msg] }),
          e.surface === 'desktop' ? Button({ key: 'page', label: '\u{1F310}︎', onPress: () => openPage($) }) : btn('page', '↗', () => openPage($)),
        ] }),
        ...below,
      ] })
    }

    const own = me()
    if (!own) return next(e)
    const sp = scenePets()
    if (!sp.some((p) => packFor(spriteOf(p)))) {
      for (const p of sp) loadPack($, spriteOf(p)).then(() => $.ui.invalidate('ui.render'))
      return next(e)
    }

    if (stopped) {
      return Box({ flexDirection: 'column', children: [
        Box({ flexDirection: 'row', columnGap: 1, children: [
          Button({ key: 'resume', label: '▶', plain: true, onPress: () => setStopped($, false) }),
          Text({ dimColor: true, children: [(petOf(own)?.species || 'Your pokemon') + ' is resting'] }),
        ] }),
        ...below,
      ] })
    }

    const pet = petOf(own)
    const name = pet.species + (pet.shiny ? ' ✦' : '')
    const pct = Math.max(0, Math.min(100, pet.exp_pct ?? 0))
    const slotText = (own.slot + 1) + '/' + team.length

    if (mode === 'svg') {
      const dbtn = (key, label, onPress) => Button({ key, label, onPress })
      const corner = Box({ alignSelf: 'flex-start', children: [compact
        ? dbtn('expand', '+', () => setCompact($, false))
        : dbtn('minimize', '–', () => setCompact($, true))] })
      const row = (children) => Box({ flexDirection: 'column', children: [
        Box({ key: 'card', flexDirection: 'row', alignItems: 'center', width: '100%', columnGap: 2, children }),
        ...below,
      ] })
      if (compact) {
        return row([Svg({ alt: name, width: STRIP_W, height: STRIP_H, isInteractive: true, source: strip(sp) }),
                    Box({ flexGrow: 1 }), corner])
      }
      return row([
        Svg({ alt: name + ', ' + phaseLabel(own) + ', ' + pct + '% to next level',
              width: CARD_W, height: CARD_H, isInteractive: true, source: card(pet, name, pct, sp, own) }),
        Box({ flexGrow: 1 }),
        Box({ flexDirection: 'column', rowGap: 1, children: [
          Box({ flexDirection: 'row', columnGap: 1, children: [
            dbtn('prev', '‹', () => switchTo($, -1)),
            Text({ dimColor: true, children: [(own.slot + 1) + ' / ' + team.length] }),
            dbtn('next', '›', () => switchTo($, 1)),
          ] }),
          Box({ flexDirection: 'row', columnGap: 1, children: [
            // flat glyphs: U+FE0E asks for the text (monochrome) form, not the colour emoji
            dbtn('poke', '✋︎', () => poke()),
            dbtn('stop', '⏹︎', () => setStopped($, true)),
            dbtn('page', '\u{1F310}︎', () => openPage($)),
          ] }),
        ] }),
        corner,
      ])
    }

    // terminal: every pokemon in the scene, each placed on a shared stage
    const H = Math.max(...sp.map((p) => compact ? MINI_ROWS : boxOf(p).rows))
    const sprites = sp.map((p) => {
      const b = boxOf(p), f = frameList(p), img = f.imgs[p.fi % Math.max(1, f.imgs.length)]
      if (!img) return null // frames still loading
      const key = p.sid === mySid ? 'pika' : 'pika-' + p.slot
      const rows = compact ? MINI_ROWS : b.rows
      const el = mode === 'png'
        ? Image({ key, source: { png: img }, columns: compact ? miniCols(p) : b.columns, rows, alt: petOf(p)?.species || ' ' })
        : Raster({ key, columns: b.columns, rows: b.rows, cells: img })
      return Box({ position: 'absolute', left: Math.max(0, Math.round(p.x || 0)), top: Math.max(0, H - rows), children: [el] })
    }).filter(Boolean)
    const stage = Box({ flexGrow: 1, position: 'relative', height: H, children: sprites })

    if (compact) { // minimized: the pokemon walk one slim line, expand at the top-right
      return Box({ flexDirection: 'column', children: [
        Box({ flexDirection: 'row', children: [
          stage,
          Box({ alignSelf: 'flex-start', children: [btn('expand', '+', () => setCompact($, false))] }),
        ] }),
        ...below,
      ] })
    }

    const full = Math.round(GAUGE_W * pct / 100)
    return Box({ flexDirection: 'column', children: [
      Box({ flexDirection: 'row', children: [
        // left: the brand, centred in the band's height
        Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, width: LEFT_W, height: H, children: [
          ...(mode === 'png' ? [Image({ key: 'logo', source: { png: LOGO_PNG }, columns: 2, rows: 1, alt: ' ' })] : []),
          Text({ color: 'red', bold: true, children: ['PikaMaxxing'] }),
        ] }),
        stage,
        // right: name (press it to poke) with minimize in the corner, then EXP bar and controls
        Box({ flexDirection: 'column', width: RIGHT_W, children: [
          Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
            Box({ flexDirection: 'row', columnGap: 1, children: [
              Button({ key: 'poke', label: name, plain: true, onPress: () => poke() }),
              Text({ dimColor: true, children: [slotText] }),
            ] }),
            btn('minimize', '−', () => setCompact($, true)),
          ] }),
          Box({ flexDirection: 'row', columnGap: 2, children: [
            Box({ key: 'exp', flexDirection: 'row', children: [
              Text({ color: pct >= 100 ? 'yellow' : 'cyan', children: ['━'.repeat(full)] }),
              Text({ dimColor: true, children: ['─'.repeat(GAUGE_W - full) + ' '] }),
              Text({ dimColor: pct < 100, color: pct >= 100 ? 'yellow' : undefined,
                     children: [pct >= 100 ? 'MAX' : pct + '%'] }),
            ] }),
            Box({ flexDirection: 'row', columnGap: 1, children: [
              btn('prev', '‹', () => switchTo($, -1)), btn('next', '›', () => switchTo($, 1)),
              btn('stop', '■', () => setStopped($, true)), btn('page', '↗', () => openPage($)),
            ] }),
          ] }),
        ] }),
      ] }),
      ...below,
    ] })
  })
}

// ---- desktop drawing: SVG in the PikaMaxxing palette ----
const CARD_W = 560, CARD_H = 104
const STAGE_X = 176, STAGE_Y = 8, STAGE_W = CARD_W - STAGE_X - 10, STAGE_H = CARD_H - 20
const GROUND = STAGE_Y + STAGE_H - 10
const STRIP_W = 560, STRIP_H = 40, STRIP_SPR = 32 // minimized desktop line
// mid-tones that read on the desktop app's dark and light backgrounds alike
const C = { name: '#d97757', brand: '#e0553f', dim: '#8b8b8b', ground: '#8b8b8b',
            track: 'rgba(139,139,139,.28)', exp: '#3b82f6', max: '#d4a017', ball: '#e0553f', hole: '#f5f5f5' }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function phaseLabel(p) {
  if (p.evo) return 'evolving!'
  if (battle && (battle.a === p.sid || battle.b === p.sid) && Date.now() >= battle.start) return 'battling!'
  if (resting(p) && quiet(p) > SLEEP_MS) return 'napping'
  if (p.phase === 'tool') return 'using ' + (p.tool || 'a tool')
  return { think: 'thinking…', done: 'done!', alert: 'needs you', idle: 'hanging out' }[p.phase] || 'hanging out'
}

// what the desktop drawing shows; a change here is the only thing that redraws
// it, except during ceremonies, whose every step is a scene change
function scene() {
  const sp = scenePets()
  const busy = sp.some((p) => p.ov)
  return [compact, team.length, me()?.slot, petOf(me() || {})?.exp_pct, busy ? Date.now() : '',
          ...sp.map((p) => [p.sid, p.slot, p.show, p.dir, phaseLabel(p)].join(':'))].join('|')
}

const FRAME_BUDGET = 100000 // chars of frame markup per drawing; an Svg takes at most 131072

// One pokemon's current animation as self-running SVG: every frame once in
// <defs> (sheets repeat frames), each shown in turn by a discrete SMIL
// animation at its PMD timing, gliding to its roam edge while it walks.
// Too heavy (Moltres' Double) -> every other frame, durations merged.
function animSprite(p, i, n, left, ground, h, budget) {
  const k = packFor(spriteOf(p))
  if (!k) return ''
  let { ms, imgs } = frameList(p)
  if (!imgs.length) return ''
  while (imgs.length > 1 && [...new Set(imgs)].reduce((s, f) => s + f.length, 0) > budget) {
    ms = ms.filter((_, j) => j % 2 === 0).map((d, j) => d + (ms[2 * j + 1] || 0))
    imgs = imgs.filter((_, j) => j % 2 === 0)
  }
  const b = k.box, tag = 'p' + (++drawSeq).toString(36) + 'f', ids = new Map()
  const defs = imgs.map((f) => {
    if (ids.has(f)) return ''
    ids.set(f, tag + ids.size)
    return `<g id="${ids.get(f)}">${f}</g>`
  }).join('')
  const total = ms.reduce((a, d) => a + d, 0)
  let t = 0
  const uses = imgs.map((f, j) => {
    const a = t / total, z = (t + ms[j]) / total
    t += ms[j]
    const values = imgs.length === 1 ? 'visible' : j === 0 ? 'visible;hidden' : z >= 1 ? 'hidden;visible' : 'hidden;visible;hidden'
    const times = imgs.length === 1 ? '0' : j === 0 ? `0;${z.toFixed(4)}` : z >= 1 ? `0;${a.toFixed(4)}` : `0;${a.toFixed(4)};${z.toFixed(4)}`
    return `<use href="#${ids.get(f)}" visibility="hidden"><animate attributeName="visibility" values="${values}" `
         + `keyTimes="${times}" dur="${total}ms" calcMode="discrete" repeatCount="indefinite"/></use>`
  }).join('')
  const sw = Math.round(h * b.w / b.h), x0 = left + (p.x || 0)
  let glide = ''
  if (p.show === 'Walk' && !p.ov) { // same speed the engine moves at, so its x and the picture agree
    const g = geo(p, i, n)
    const to = left + (p.dir > 0 ? g.hi : g.lo), secs = Math.abs(to - x0) / (g.speed * 1000 / TICK)
    if (secs > 0.05) glide = `<animateTransform attributeName="transform" type="translate" from="${x0} 0" to="${to} 0" dur="${secs.toFixed(2)}s" fill="freeze"/>`
  }
  const white = p.ov?.glow
    ? `<filter id="${tag}w"><feFlood flood-color="#fff"/><feComposite in2="SourceAlpha" operator="in"/></filter>` : ''
  return `<defs>${defs}${white}</defs><g transform="translate(${x0} 0)">${glide}`
    + `<ellipse cx="${sw / 2}" cy="${ground}" rx="${sw * 0.28}" ry="${h > 40 ? 3 : 2}" fill="#000" opacity=".22"/>`
    + `<svg x="0" y="${ground - h + 3}" width="${sw}" height="${h}" viewBox="0 0 ${b.w} ${b.h}" shape-rendering="crispEdges"`
    + `${white ? ` filter="url(#${tag}w)"` : ''}>${uses}</svg></g>`
}

const sprites = (sp, left, ground, h) => sp.map((p, i) => animSprite(p, i, sp.length, left, ground, h,
                                                                    FRAME_BUDGET / sp.length)).join('')

function strip(sp) {
  const ground = STRIP_H - 4
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STRIP_W}" height="${STRIP_H}" viewBox="0 0 ${STRIP_W} ${STRIP_H}">`
    + `<line x1="4" y1="${ground}" x2="${STRIP_W - 4}" y2="${ground}" stroke="${C.ground}" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round"/>`
    + sprites(sp, 8, ground, STRIP_SPR)
    + `</svg>`
}

function card(pet, name, pct, sp, own) {
  const font = `font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`
  const dots = team.map((_, i) => {
    const cx = 18 + i * 14
    return i === own.slot
      ? `<circle cx="${cx}" cy="74" r="5" fill="${C.ball}" stroke="${C.ball}" stroke-width="1.5"/>`
        + `<line x1="${cx - 5}" y1="74" x2="${cx + 5}" y2="74" stroke="${C.hole}" stroke-width="1.2"/>`
        + `<circle cx="${cx}" cy="74" r="1.8" fill="${C.hole}" stroke="${C.hole}" stroke-width="1"/>`
      : `<circle cx="${cx}" cy="74" r="4" fill="none" stroke="${C.dim}" stroke-width="1.2" opacity=".55"/>`
  }).join('')
  const bx = 38, bw = 92, maxed = pct >= 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">`
    + `<svg x="14" y="10" width="17" height="15" viewBox="0 0 14 12" shape-rendering="crispEdges">${LOGO_SVG}</svg>`
    + `<text x="36" y="22" ${font} font-size="10" font-weight="700" letter-spacing="1.5" fill="${C.brand}">PIKAMAXXING</text>`
    + `<text x="14" y="45" ${font} font-size="15" font-weight="700" fill="${C.name}">${esc(name)}</text>`
    + `<text x="14" y="60" ${font} font-size="11" fill="${C.dim}">${esc(phaseLabel(own))}</text>`
    + dots
    + `<text x="14" y="96" ${font} font-size="9" font-weight="700" fill="${C.dim}">EXP</text>`
    + `<rect x="${bx}" y="88" width="${bw}" height="9" rx="4.5" fill="${C.track}"/>`
    + (pct > 0 ? `<rect x="${bx}" y="88" width="${Math.max(9, bw * pct / 100).toFixed(1)}" height="9" rx="4.5" fill="${maxed ? C.max : C.exp}"/>` : '')
    + `<text x="${bx + bw + 6}" y="96" ${font} font-size="9" font-weight="700" fill="${maxed ? C.max : C.dim}">${maxed ? 'MAX' : pct + '%'}</text>`
    + `<line x1="${STAGE_X + 6}" y1="${GROUND}" x2="${STAGE_X + STAGE_W - 6}" y2="${GROUND}" stroke="${C.ground}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`
    + sprites(sp, STAGE_X + 8, GROUND, SVG_H)
    + `</svg>`
}
