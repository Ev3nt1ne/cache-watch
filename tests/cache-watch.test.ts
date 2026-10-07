import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]

const MINUTE = 60_000
const START = Date.parse('2026-10-07T12:00:00.000Z')

// Beneath the plugin: the clock, the Windows toast (PowerShell), the phone push,
// the files, the environment and the session the warning describes.
function ran(stdout = '', exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

type Push = { pushSent?: boolean; localSent?: boolean; disabledReason?: 'config_off' | 'user_present' | 'no_transport' }

type WorldOptions = {
  /** Which desktop notifier the machine has: WSL's PowerShell, or Linux's notify-send. */
  platform?: 'wsl' | 'linux'
  /** What `PushNotification` answers. */
  push?: Push
  /** How long one model request takes, so the end of the request can be told from its start. */
  stepMs?: number
}

function world(on: On, options: WorldOptions = {}) {
  const { platform = 'wsl', push = { pushSent: true }, stepMs = 0 } = options
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME: '/home/test' })
  const toasts: Record<string, string>[] = []
  const linux: string[][] = []
  const pushes: string[] = []
  const files: Record<string, string> = {}
  on('fs.stat', () => {
    if (platform === 'linux') throw new Error('ENOENT')
    return { value: { isFile: true } } as never
  })
  on('process.run', (_$, e) => {
    const [cmd, , script] = e.argv
    if (cmd === 'sh' && script === 'command -v notify-send') return ran('', platform === 'linux' ? 0 : 1)
    if (cmd === 'mkdir') return ran()
    if (cmd === 'notify-send' || cmd === 'sh') {
      linux.push([...e.argv])
      return ran()
    }
    toasts.push({ ...(e.init?.env ?? {}) })
    return ran('shown\n')
  })
  on('tool.call', (_$, e) => {
    pushes.push(String((e as unknown as { message: string }).message))
    return { result: push, text: 'recorded' } as never
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('toast.ps1')) return { value: '# toast script' } as never
    const held = files[e.path]
    if (held === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: held } as never
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/home/giova/recovery' }))
  on('session.id', () => ({ value: '0c6aba9f-bc29-41a4-b06d-fa609c2ec4dd' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'check the flash log', toolUses: [] }] }) as never)
  on('turn.step', async function* (_$, e) {
    if (stepMs) await clock.sleep(stepMs)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  return { clock, toasts, linux, pushes, files, log: () => files['/home/test/.cache/cache-watch/fire.log'] ?? '' }
}

/** One model request of the main conversation (or of a subagent, with `agentId`). */
function request($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, ...(agentId ? { agentId } : {}) })
  return (async () => {
    for await (const _ of stream) {
      // drained
    }
  })()
}

test('warns once, 10 minutes before a 60-minute cache goes cold, on Windows and phone', async ($, on) => {
  const { clock, toasts, pushes } = world(on)
  await request($)

  await clock.advance(49 * MINUTE)
  expect(toasts).toHaveLength(0)

  await clock.advance(1 * MINUTE + 1000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]?.CW_TITLE).toBe('Claude cache cold in 10 min · recovery')
  expect(toasts[0]?.CW_BODY).toContain('“check the flash log”')
  expect(toasts[0]?.CW_SOUND).toBe('0')
  expect(pushes).toHaveLength(1)
  expect(pushes[0]).toContain('Claude cache cold in 10 min')

  await clock.advance(30 * MINUTE)
  expect(toasts).toHaveLength(1)
})

test('each main-conversation request restarts the clock; subagent requests do not', async ($, on) => {
  const { clock, toasts } = world(on)
  await request($)
  await clock.advance(40 * MINUTE)
  await request($)
  await clock.advance(40 * MINUTE)
  expect(toasts).toHaveLength(0)

  await request($, 'agent-1')
  await clock.advance(10 * MINUTE + 1000)
  expect(toasts).toHaveLength(1)
})

test('the clock runs from the end of a request, not its start', async ($, on) => {
  const { clock, toasts } = world(on, { stepMs: 4 * MINUTE })
  const sent = request($)
  await clock.advance(4 * MINUTE)
  await sent

  // 48 minutes after the response came in; 52 after the request went out.
  await clock.advance(48 * MINUTE)
  expect(toasts).toHaveLength(0)

  await clock.advance(2 * MINUTE + 1000)
  expect(toasts).toHaveLength(1)
})

test(
  'honours the settings: warning time, cache lifetime, channels and sound',
  { options: { warnMinutes: 2, ttlMinutes: 5, phone: false, sound: true } },
  async ($, on) => {
    const { clock, toasts, pushes } = world(on)
    await request($)
    await clock.advance(3 * MINUTE + 1000)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.CW_TITLE).toBe('Claude cache cold in 2 min · recovery')
    expect(toasts[0]?.CW_SOUND).toBe('1')
    expect(pushes).toHaveLength(0)
  },
)

test('/cache-watch shows the time left, and `test` notifies now', async ($, on) => {
  const { clock, toasts, pushes } = world(on)
  const run = (args: string) => $.command.run({ command: 'cache-watch', args } as never)

  expect((await run('')).text).toContain('No request sent yet')
  await request($)
  await clock.advance(15 * MINUTE)
  expect((await run('')).text).toContain('via desktop popup + phone')
  expect((await run('')).text).toContain('About 45 min left; the warning comes in 35 min')

  expect((await run('test')).text).toBe('Test sent: Windows: shown, phone: sent.')
  expect(toasts).toHaveLength(1)
  expect(pushes).toHaveLength(1)
})

test(
  'on a Linux desktop the popup goes through notify-send, critical, with the sound when on',
  { options: { sound: true } },
  async ($, on) => {
    const { clock, toasts, linux, pushes } = world(on, { platform: 'linux' })
    await request($)
    await clock.advance(50 * MINUTE + 1000)
    expect(toasts).toHaveLength(0)
    expect(linux[0]?.slice(0, 4)).toEqual([
      'notify-send',
      '--app-name=Claude Code',
      '--urgency=critical',
      'Claude cache cold in 10 min · recovery',
    ])
    expect(linux[1]?.[2]).toContain('canberra-gtk-play')
    expect(pushes).toHaveLength(1)
    expect((await $.command.run({ command: 'cache-watch', args: 'test' } as never)).text).toBe(
      'Test sent: Linux: shown, sound played, phone: sent.',
    )
  },
)

test('a push that did not reach a phone is reported as what it was, not as sent', async ($, on) => {
  const { clock } = world(on, { push: { localSent: true, disabledReason: 'no_transport' } })
  await request($)
  await clock.advance(50 * MINUTE + 1000)
  const said = (await $.command.run({ command: 'cache-watch', args: 'test' } as never)).text
  expect(said).toContain('phone: not sent (no phone reachable: Remote Control is not connected')
  expect(said).not.toContain('phone: sent')
})

test('a push skipped because you are at the keyboard says so', async ($, on) => {
  world(on, { push: { localSent: true, disabledReason: 'user_present' } })
  const said = (await $.command.run({ command: 'cache-watch', args: 'test' } as never)).text
  expect(said).toContain('phone: not sent (Claude Code took you to be at the keyboard)')
})

test('each firing is logged with the clock drift, and `log` reads the log back', async ($, on) => {
  const { clock, log } = world(on)
  expect((await $.command.run({ command: 'cache-watch', args: 'log' } as never)).text).toContain('No warning has fired yet')

  await request($)
  await clock.advance(50 * MINUTE + 1000)

  const line = log().trim()
  expect(line).toContain('2026-10-07 12:50:00 fire')
  expect(line).toContain('anchor=2026-10-07 12:00:00')
  expect(line).toContain('planned=2026-10-07 12:50:00')
  expect(line).toContain('drift=0s')
  expect(line).toContain('left=10min warn=10 ttl=60 rearms=0')
  expect(line).toContain('session=0c6aba9f cwd=recovery')
  expect(line).toContain('Windows: shown, phone: sent')

  const shown = (await $.command.run({ command: 'cache-watch', args: 'log' } as never)).text
  expect(shown).toContain('last 1 of 1')
  expect(shown).toContain('fire')
})
