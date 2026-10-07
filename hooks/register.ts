import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

// The prompt cache's own status is not exposed to mods (checked on 2.1.291:
// neither `$.session.usage()` nor any other noun carries an expiry; only
// model-switch events carry a `prompt_cache_warm` flag), so this mod keeps its
// own clock: the cache is assumed warm for `ttlMinutes` after the last request
// the main conversation sent (subagents and other models use other caches).

type $ = EngineInterface

// WSL reaches Windows' own PowerShell; on it the popup is a Windows notification.
const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
// A Linux desktop's sound, tried in order: libcanberra's event sound, then the file through PulseAudio/PipeWire.
const LINUX_SOUND =
  'canberra-gtk-play -i message-new-instant 2>/dev/null || paplay /usr/share/sounds/freedesktop/stereo/message-new-instant.oga'
const MINUTE = 60_000
// A timer that fires this much before its time is the host's doing, not ours: re-arm instead of warning early.
const EARLY_MS = 30_000
const MAX_REARMS = 3
// The firing log keeps its last lines and nothing else.
const LOG_LINES = 200

const lastRequestAt = atom({ plugin: 'cache-watch', key: 'lastRequestAt' } as const, null)

type Settings = {
  warnMinutes: number
  ttlMinutes: number
  desktop: boolean
  phone: boolean
  sound: boolean
  log: boolean
}

function settingsFrom(options: PluginOptions): Settings {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    warnMinutes: num(options.warnMinutes, 10),
    ttlMinutes: num(options.ttlMinutes, 60),
    desktop: bool(options.desktop, true),
    phone: bool(options.phone, true),
    sound: bool(options.sound, false),
    log: bool(options.log, true),
  }
}

/** The pending warning and what it was scheduled for; a module variable, so a reload drops it and session.start sets it again. */
type Plan = { anchor: number; firesAt: number; rearms: number }
let timer: { cancel: () => void } | null = null

/** One line appended to `~/.cache/cache-watch/fire.log`; never allowed to break a warning. */
async function appendLog($: $, s: Settings, line: string) {
  if (!s.log) return
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const dir = `${home}/.cache/cache-watch`
    const path = `${dir}/fire.log`
    let previous = ''
    try {
      previous = await $.fs.read(path)
    } catch {
      // No log yet.
    }
    const kept = [...previous.split('\n').filter(Boolean), line].slice(-LOG_LINES).join('\n')
    try {
      await $.fs.write(path, `${kept}\n`)
    } catch {
      await $.process.run(['mkdir', '-p', dir], { timeoutMs: 10_000 })
      await $.fs.write(path, `${kept}\n`)
    }
  } catch {
    // The log is a convenience. A machine that will not take it still gets its warning.
  }
}

function iso(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

async function readLog($: $): Promise<string[]> {
  const home = await $.env.get('HOME')
  if (!home) return []
  try {
    return (await $.fs.read(`${home}/.cache/cache-watch/fire.log`)).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function folderOf($: $): Promise<string> {
  const cwd = await $.session.cwd()
  return cwd.split('/').filter(Boolean).at(-1) ?? cwd
}

/** The last thing you asked here, so a warning from one of several open sessions is recognisable. */
async function gistOf($: $): Promise<string> {
  const lastAsk = (await $.session.messages()).filter(m => m.role === 'user' && m.text.trim()).at(-1)
  if (!lastAsk) return ''
  const text = lastAsk.text.trim().replace(/\s+/g, ' ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

type Desktop = 'windows' | 'linux' | 'none'

/** Which desktop popup this machine can raise: Windows through WSL, else a Linux notification daemon. */
async function desktopKind($: $): Promise<Desktop> {
  try {
    await $.fs.stat(POWERSHELL)
    return 'windows'
  } catch {
    // Not WSL, or no Windows drive mounted.
  }
  try {
    const r = await $.process.run(['sh', '-c', 'command -v notify-send'], { timeoutMs: 5_000 })
    if (r.exitCode === 0) return 'linux'
  } catch {
    // No shell to ask.
  }
  return 'none'
}

async function linuxPopup($: $, s: Settings, title: string, body: string): Promise<string> {
  // Critical urgency: GNOME keeps it on screen until dismissed; other desktops may time it out.
  const r = await $.process.run(['notify-send', '--app-name=Claude Code', '--urgency=critical', title, body], {
    timeoutMs: 10_000,
  })
  if (r.exitCode !== 0) return `Linux: failed (${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 120)})`
  if (!s.sound) return 'Linux: shown'
  const snd = await $.process.run(['sh', '-c', LINUX_SOUND], { timeoutMs: 10_000 })
  return snd.exitCode === 0 ? 'Linux: shown, sound played' : 'Linux: shown, sound failed (needs canberra-gtk-play or paplay)'
}

/** What `PushNotification` answers: it reaches a phone only through Remote Control, and skips itself when you are at the keyboard. */
type CallResult = { deny?: string; isError?: boolean; text?: string; result?: unknown }
type PushResult = {
  pushSent?: boolean
  localSent?: boolean
  disabledReason?: 'config_off' | 'user_present' | 'no_transport'
}

/** The phone leg, reported as the tool actually answered it: a non-error result is not the same as a push. */
function phoneReport(r: CallResult): string {
  if (r.deny) return `phone: refused (${r.deny})`
  if (r.isError) return `phone: failed (${String(r.text ?? '').slice(0, 120)})`
  const push = (r.result ?? null) as PushResult | null
  if (push?.pushSent) return 'phone: sent'
  switch (push?.disabledReason) {
    case 'no_transport':
      return 'phone: not sent (no phone reachable: Remote Control is not connected on this machine)'
    case 'user_present':
      return 'phone: not sent (Claude Code took you to be at the keyboard)'
    case 'config_off':
      return 'phone: not sent (push is off: agentPushNotifEnabled in settings)'
  }
  if (push?.localSent) return 'phone: not sent (the terminal popup went out instead)'
  return `phone: not sent (${String(r.text ?? JSON.stringify(push)).slice(0, 100)})`
}

/** Sends the warning on every channel switched on; returns what each one did. */
async function notify($: $, s: Settings, title: string, body: string): Promise<string[]> {
  const done: string[] = []
  const kind = s.desktop ? await desktopKind($) : 'none'
  if (s.desktop && kind === 'none') done.push('desktop: no notifier found (not WSL, and no notify-send)')
  if (kind === 'linux') {
    try {
      done.push(await linuxPopup($, s, title, body))
    } catch (err) {
      done.push(`Linux: failed (${String(err instanceof Error ? err.message : err)})`)
    }
  }
  if (kind === 'windows') {
    try {
      const script = await $.fs.read(`${$.plugin.root}/bin/toast.ps1`)
      const r = await $.process.run([POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
        stdin: script,
        env: {
          CW_TITLE: title,
          CW_BODY: body,
          CW_SOUND: s.sound ? '1' : '0',
          // Hands these variables to the Windows process.
          WSLENV: 'CW_TITLE:CW_BODY:CW_SOUND',
        },
        timeoutMs: 20_000,
      })
      done.push(r.stdout.includes('shown') ? 'Windows: shown' : `Windows: failed (${(r.stderr || r.stdout).trim().slice(0, 120)})`)
    } catch (err) {
      done.push(`Windows: failed (${String(err instanceof Error ? err.message : err)})`)
    }
  }
  if (s.phone) {
    try {
      const r = (await $.tool.call({
        tool: 'PushNotification',
        message: `${title}: ${body}`.slice(0, 190),
        status: 'proactive',
      })) as CallResult
      done.push(phoneReport(r))
    } catch (err) {
      done.push(`phone: failed (${String(err instanceof Error ? err.message : err)})`)
    }
  }
  if (!done.length) done.push('no channel is switched on')
  return done
}

/**
 * The warning itself, told how long it had meant to wait, so a timer the host
 * fires early is re-armed and one it fires late says the time that is really left.
 */
async function warn($: $, s: Settings, plan: Plan) {
  const now = await $.clock.now()
  const drift = now - plan.firesAt
  if (drift < -EARLY_MS && plan.rearms < MAX_REARMS) {
    // The host's timer came back before its time; wait out the rest.
    await appendLog(
      $,
      s,
      `${iso(now)} early  anchor=${iso(plan.anchor)} planned=${iso(plan.firesAt)} drift=${Math.round(drift / 1000)}s re-armed`,
    )
    timer = $.clock.after(plan.firesAt - now, () => void warn($, s, { ...plan, rearms: plan.rearms + 1 }))
    return
  }
  const left = Math.max(0, Math.round((plan.anchor + s.ttlMinutes * MINUTE - now) / MINUTE))
  const folder = await folderOf($)
  const gist = await gistOf($)
  const done = await notify(
    $,
    s,
    `Claude cache cold in ${left} min · ${folder}`,
    `${gist ? `“${gist}”. ` : ''}Send a message to keep it warm.`,
  )
  $.ui.log(`cache-watch: warned (${done.join(', ')})`)
  await appendLog(
    $,
    s,
    `${iso(now)} fire   anchor=${iso(plan.anchor)} planned=${iso(plan.firesAt)} drift=${Math.round(drift / 1000)}s ` +
      `left=${left}min warn=${s.warnMinutes} ttl=${s.ttlMinutes} rearms=${plan.rearms} ` +
      `session=${(await $.session.id()).slice(0, 8)} cwd=${folder} | ${done.join(', ')}`,
  )
}

/** Sets the one pending warning from the last request's time. */
async function schedule($: $, s: Settings) {
  timer?.cancel()
  timer = null
  const anchor = await read($, lastRequestAt)
  if (anchor === null || s.warnMinutes >= s.ttlMinutes) return
  const firesAt = anchor + (s.ttlMinutes - s.warnMinutes) * MINUTE
  const delay = firesAt - (await $.clock.now())
  // Already inside the warning window (a reload, or settings changed): too late to warn usefully.
  if (delay <= 0) return
  timer = $.clock.after(delay, () => void warn($, s, { anchor, firesAt, rearms: 0 }))
}

/** Marks the cache as refreshed now and moves the warning with it. */
async function touch($: $, s: Settings) {
  const now = await $.clock.now()
  await update($, lastRequestAt, () => now)
  await schedule($, s)
}

function minutes(ms: number) {
  return `${Math.max(0, Math.round(ms / MINUTE))} min`
}

async function status($: $, s: Settings): Promise<string> {
  const anchor = await read($, lastRequestAt)
  const channels = [s.desktop && 'desktop popup', s.phone && 'phone', s.sound && 'sound'].filter(Boolean).join(' + ') || 'none'
  const conf = `Warns ${s.warnMinutes} min before a ${s.ttlMinutes}-min cache goes cold, via ${channels}.`
  if (anchor === null) return `${conf}\nNo request sent yet in this session: nothing to keep warm.`
  const left = anchor + s.ttlMinutes * MINUTE - (await $.clock.now())
  if (left <= 0) return `${conf}\nThe cache is probably cold (last request ${minutes(-left + s.ttlMinutes * MINUTE)} ago).`
  return `${conf}\nAbout ${minutes(left)} left; the warning ${left > s.warnMinutes * MINUTE ? `comes in ${minutes(left - s.warnMinutes * MINUTE)}` : 'window has started'}.`
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-watch',
      description: 'Cache warning: time left in this session, `test` to notify now, `log` for the last firings',
      argumentHint: '[test|log]',
    })
    // After a reload, the clock picks up from the last request this session recorded.
    await schedule($, s)
    return next(e)
  })

  // Each request of the main conversation refreshes its cache, so the clock restarts.
  // Twice per request: before it goes out, and again when the response is in, which is
  // when the API writes the cache entry the next request will read.
  on('turn.step', async function* ($, e, next) {
    const main = !e.agentId
    if (main) await touch($, s)
    const result = yield* next(e)
    if (main) await touch($, s)
    return result
  })

  on('command.run', { command: 'cache-watch' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'test') {
      const folder = await folderOf($)
      const gist = await gistOf($)
      const done = await notify(
        $,
        s,
        `Claude cache: test notification · ${folder}`,
        `${gist ? `“${gist}”. ` : ''}This is how the warning will look.`,
      )
      // Logged like a firing, so the log's own plumbing is checked by the same command.
      await appendLog(
        $,
        s,
        `${iso(await $.clock.now())} test   session=${(await $.session.id()).slice(0, 8)} cwd=${folder} | ${done.join(', ')}`,
      )
      return { text: `Test sent: ${done.join(', ')}.` }
    }
    if (arg === 'log') {
      const lines = await readLog($)
      if (!lines.length) return { text: s.log ? 'No warning has fired yet on this machine.' : 'The firing log is switched off (`log: false`).' }
      return { text: `~/.cache/cache-watch/fire.log, last ${Math.min(10, lines.length)} of ${lines.length}:\n${lines.slice(-10).join('\n')}` }
    }
    return { text: await status($, s) }
  })
}
