# Cache Watch

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that warns you a few
minutes before a session's prompt cache goes cold, so you can send something and keep it warm.

Claude Code caches your conversation on the API side with a one-hour lifetime. While that entry
is alive, your next message re-reads it cheaply; once it lapses, the whole conversation is sent
and written again at the cache-write price. If you step away from a long session for an hour,
you come back to a bill you could have avoided with one keystroke.

Cache Watch sends one notification per idle stretch, `warnMinutes` (10 by default) before the
cache's assumed end: a desktop popup that stays until you dismiss it, a phone push if one can be
delivered, and optionally a sound. It says nothing when the cache actually goes cold — by then
there is nothing to save.

> **Why I built it.** I keep several long Claude Code sessions open and I walk away from them.
> This is a personal tool I'm sharing as it is. Issues and ideas are welcome.

## Status: what has been tested

Being open about this, since it's a young project and some of it can only be checked by living
with it.

| Part | Status |
|---|---|
| Windows popup under **WSL2** (`bin/toast.ps1`) | **Works.** Seen live, and again on 2026-10-07 |
| Windows popup **with sound** (`sound: true`) | **Works.** Toast shown with the reminder audio attached, and the chime confirmed heard on 2026-10-07 |
| `/cache-watch` and `/cache-watch test` in the **VS Code** extension | **Work** |
| `/cache-watch` and `/cache-watch test` in a **terminal** session | **Work.** Checked on 2026-10-07 in print mode, both with `claude --plugin-dir` and loaded from `settings.json` |
| **Windows idle detection** (`bin/idle.ps1`, `GetLastInputInfo`) | **Works.** Checked live on 2026-10-07: reported 4 s and 40 s correctly, and gated the phone |
| **Linux idle detection** (`xprintidle`, Mutter) | **Untested.** Covered by the test suite against a fake command; no X11 or GNOME session on this WSL box to try it against |
| Firing log (`~/.cache/cache-watch/fire.log`, `/cache-watch log`) | **Works.** Written live on 2026-10-07, directory created on first use |
| **Phone push** | **Never confirmed to arrive.** Both gates have been seen to block it (`user_present` live on 2026-10-07; `no_transport` without a bridge). See *The phone leg* |
| Warning timing (fires once, at `ttlMinutes - warnMinutes`, subagent requests ignored, settings honoured, logged) | **Covered by the test suite** (13 tests, mocked clock, `claude plugin test .`) |
| Warning timing in a **real** idle session | **Explained, not yet re-measured.** The early firing was the host's `CLOCK_MONOTONIC` running 8.33% fast, not the mod. See *Known issue: WSL2 clock skew* |
| **Linux desktop** popup and sound (`notify-send`) | **Untested on a real desktop.** The automated test drives a fake `notify-send`; it has never run against a notification daemon |
| macOS | **Not supported.** No popup path; `/cache-watch test` reports `desktop: no notifier found` |

Built and run on Ubuntu 24.04 under WSL2, with Claude Code 2.1.291. It needs a version that
loads mods (function hooks).

## How the time is computed, and why it is a guess

**A mod cannot read the cache's real state.** On 2.1.291 nothing on `$` carries an expiry or a
warm/cold flag: `$.session.usage()` has the context window, the rate-limit windows and the cost,
and the only `prompt_cache_warm` in the whole API lives inside model-switch events. So this mod
keeps its own clock:

- The cache is taken as warm for `ttlMinutes` (60) after the **last model request of the main
  conversation**. Each new request restarts it.
- Requests from subagents are ignored (`e.agentId`): they use other caches. So do other mods'
  calls to other models.
- The clock is set **twice per request** — when the request goes out, and again when its
  response is in. The second one is the anchor that matters, because the API writes the cache
  entry when the response completes.

That model is not guesswork about the hour itself. On about 110 idle stretches of more than 30
minutes across my own transcripts, every gap of **59.9 minutes or less** between consecutive
assistant messages came back with a large `cache_read_input_tokens`, and every gap of **60.7
minutes or more** came back with `cache_read` near zero and the whole prefix written again. The
boundary is sharp and it sits at 60 minutes from the previous response.

**If Claude Code ever exposes the real cache state to mods**, switch to it. The places to change
are `schedule()` and `status()` in `hooks/register.ts`.

## The phone leg

This is the part that does not fully work, and it is worth reading before you turn it on.

The mod asks for the push through Claude Code's own `PushNotification` tool. Read out of the
2.1.291 binary, that tool decides like this:

```js
isRemote  = env.CLAUDE_CODE_REMOTE || caps().workspace === "remote"
transport = isRemote || surfaceCapabilities.replBridgeActive()   // Remote Control's bridge

if (transport && !isRemote && !agentPushNotifEnabled)        -> config_off
if (!isRemote && !env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
                && userPresent())                            -> user_present
if (!transport)                                              -> no_transport (local popup only)
else                                                         -> pushSent
```

Two gates, and both of them can swallow your warning.

**The transport.** A phone gets the notification because it is a *connected surface*: the tool
emits an internal `os_notification` event and each attached surface renders it on its own
platform. The only way a phone is attached to a local session is **Remote Control**
(`/remote-control`, "Control this session from your phone or claude.ai/code"), and that is a live
bridge belonging to that one session — there is no stored setting for it, and no server-side send
path in the CLI. So: no bridge, no phone, and with several sessions open it is one bridge each.

**The presence check.** Claude Code's own idea of whether you are there:

```js
userPresent() = terminalFocus() ?? (Date.now() - lastInteractionTime() < 60_000)
```

If the surface reports focus, focus alone decides. So **a window you left focused and walked away
from reads as present for ever** — exactly when a push would be the only thing that reaches you.
`CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK=1` in your settings `env` switches that check
off; it also stops Claude's own pushes being suppressed, so it is left to you. The firing log
records `user_present` when it happens, which is the evidence to decide on rather than a guess.

**What the mod does instead.** It asks the machine, not Claude Code:

| Machine | How |
|---|---|
| Windows (incl. WSL) | `GetLastInputInfo`, system-wide: counts you typing in *any* window |
| Linux | `xprintidle`, else GNOME's `org.gnome.Mutter.IdleMonitor.GetIdletime` over D-Bus |
| Neither answers | idle unknown, and the mod assumes you are away |

The phone is tried only when the machine says nobody has touched it for `awayMinutes` (2 by
default). Under that, the desktop popup has already reached you and a push would be noise. The
measured idle time goes into every log line, and `/cache-watch test` prints it:

```
Test sent: Windows: shown, phone: not sent (Claude Code took you to be at the keyboard).
(you last touched this machine 4s ago; a real warning skips the phone under 2 min.)
```

`/cache-watch test` always attempts the push, because a test fired by hand is fired by someone
present, so it can never show you the real thing.

Until version 0.2.0 the mod reported `phone: sent` for any result that was not an error — so a
skipped push looked like a delivered one. That was the bug behind "it says sent and my phone is
silent". Now every channel reports what actually happened.

Push also needs `"agentPushNotifEnabled": true` in your settings; with it off the tool answers
`config_off` and the mod says so. One trap: setting `CLAUDE_CODE_REMOTE` makes `transport` true
unconditionally, so the tool reports `pushSent: true` with nothing on the other end. Don't.

## What is not verified

The status table above says what has been checked. This is the other half of it, in one place,
because a young tool that is vague about its gaps is worse than one that names them.

**Never seen happen, on any machine.** These are not believed to be broken; nobody has watched
them:

- A warning firing in an **interactive** session. Every firing observed so far was triggered by
  hand with `/cache-watch test`; the scheduled path has only ever run under the test suite's
  mocked clock. Print mode (`claude -p`) cannot show it either — the process exits long before the
  timer is due, taking the timer with it.
- A **phone push arriving**. Both gates have been seen to refuse one, and a successful send has
  never been confirmed at the phone. See *The phone leg*.
- A firing **across a machine sleep**. The re-arm guard is written for a timer that returns early,
  but a suspended host has not been tried.
- **Several sessions warning at once.** The folder in each title is meant to tell them apart; that
  has not been watched in anger.
- A **5-minute cache** (`ttlMinutes: 5`). Unit-tested, never lived with.

**Untested because this machine cannot test it.** Built and run on Ubuntu 24.04 under WSL2, so
every Linux-desktop path is exercised against a fake command in the test suite and has never met a
real notification daemon:

- The `notify-send` popup, and whether `--urgency=critical` really stays until dismissed outside
  GNOME.
- The Linux sound path (`canberra-gtk-play`, then `paplay`).
- Linux idle detection (`xprintidle`, else GNOME's Mutter idle monitor over D-Bus).
- **macOS is not supported at all** — there is no popup path, and `/cache-watch test` says
  `desktop: no notifier found`.

**Code with no coverage.** One path in the mod is untested and cannot be tested here: the re-arm
branch that catches a timer returning more than 30 seconds early. A mocked clock fires exactly on
time, so the test kit cannot produce an early timer; it is written to be plainly correct rather
than proven, and a skewed host (see *Known issue: WSL2 clock skew*) is the only thing that
exercises it.

**Known to be incomplete, by choice.** When the warning fires and the machine says you are still
at the keyboard, the phone leg is dropped rather than deferred. Re-probing the machine a few
minutes later, and pushing only if you have gone away by then, would be better and is not built.

The two things that cannot be built at all are below.

## Not possible yet

Two things this mod should do and cannot, both waiting on Claude Code rather than on the mod.
Checked against 2.1.291; if a later build adds either, the mod is a few lines from using it.

**`phone: all` — a push that does not need a live bridge.** What you want is the notification
Claude's web chat sends to your phone: one that arrives whichever session it came from, with no
per-session Remote Control. The CLI has no way to ask for it. The phone is a surface, and a push
is an event rendered by attached surfaces; the one notification endpoint in the binary,
`/api/claude_code/notification/preferences`, reads and writes two booleans
(`agentPushNotifEnabled`, `inputNeededNotifEnabled`) and sends nothing. Server-side pushes exist,
but they belong to sessions Anthropic's backend owns — cloud agents, scheduled routines,
teleported sessions — not to a local one. Until a mod can emit one, `phone` stays per-session and
the honest default is to leave it that way: it also means a long-running session cannot spam every
device you own.

**The cache's real state.** There is no warm/cold flag or expiry on `$`: `$.session.usage()`
carries the context window, the rate-limit windows and the cost, and the only `prompt_cache_warm`
in the API lives inside model-switch events, where a mod cannot read it for the session it is in.
So the countdown here is a clock of our own, and the one number it needs — when the entry really
lapses — is the one number nobody will tell it. If that ever appears, `schedule()` and `status()`
in `hooks/register.ts` are the two places to change.

## The timing

The clock is anchored on the last model request of the main conversation, and the arithmetic from
there is exact — the test suite schedules and fires it on a mocked clock. What is *not* exact is
the host timer the mod waits on: on a machine whose monotonic clock runs at the wrong rate the
warning lands early or late in real time, by a margin that grows with the wait. That is a host
problem, described in *Known issue: WSL2 clock skew* below, and the mod does not try to correct
for it. What it does instead is generic, and absorbs the common cases:

- Every firing appends a line to `~/.cache/cache-watch/fire.log` with the anchor, the time the
  warning was *meant* for, the drift between them, which session and folder it came from, and
  what each channel did. `/cache-watch log` prints the last ten.
- A timer that comes back **more than 30 seconds early** is re-armed for the rest of its wait, up
  to three times, and the early return is logged. On a host 8.33% fast — the skew measured while
  building this — the first 50-minute wait returns 231 s early, the re-arm covers the remainder,
  and the warning lands within about 20 s of its time.
- The warning names the minutes that are really left at the moment it fires, not the configured
  `warnMinutes`, so a timer that drifts either way still tells the truth.

If you simply prefer a wider margin, that is a setting rather than a bug to live with:
`warnMinutes: 15` costs you one message.

## Known issue: WSL2 clock skew makes warnings early

Not a bug in this mod, but it changes when your warnings land, so it is worth knowing before you
file one against the mod.

Under WSL2, a `systemd-timesyncd` left running alongside Hyper-V's own time synchronisation leaves
the kernel's `tick` wrong, and then `CLOCK_MONOTONIC` — the clock host timers run on — advances at
the wrong *rate* while `CLOCK_REALTIME` stays correct. Ubuntu 24.04 and earlier enable timesyncd
by default, against Microsoft's own recommendation for WSL, so the default install is affected.
It is [open upstream](https://github.com/microsoft/WSL/issues/12583) and unpatched.

The error is a rate, so it scales with the wait: at the 8.33% measured on the machine this was
built on, a 50-minute timer ends after 46.2 real minutes and the warning arrives with about
**14 minutes** of cache left instead of 10. The sign is not the same everywhere — the upstream
report measures 6.9% the other way, firing *late* — which is why the mod does not try to correct
it. Check your own machine:

```bash
python3 -c "import time; m=time.clock_gettime(time.CLOCK_MONOTONIC); r=time.clock_gettime(time.CLOCK_MONOTONIC_RAW); print(f'monotonic is {(m/r-1)*100:+.2f}% off')"
```

Roughly `+0.00%` is healthy. Anything else is the host, and the fix is on the host: disable
`systemd-timesyncd` and restore the tick with `sudo adjtimex --tick 10000`. Either way the mod's
re-arm guard absorbs most of it — *The timing* above says what it does, and `/cache-watch log`
shows what it did.

## Notifications

Which desktop popup is used depends on the machine. The mod checks each time it notifies:

| Machine | Popup | Sound (if on) |
|---|---|---|
| **WSL** (Windows' `powershell.exe` reachable) | Windows "reminder" notification, stays until dismissed (`bin/toast.ps1`) | Windows reminder sound |
| **Linux desktop** (`notify-send` on PATH) | `notify-send --urgency=critical`; GNOME keeps it until dismissed, other desktops may time it out | `canberra-gtk-play`, else `paplay` with the freedesktop sound |
| Neither (macOS, a server) | none: `/cache-watch test` reports `desktop: no notifier found` | none |

Defaults: popup on, phone on, sound off, log on. Every notification names the project folder and
the start of your last message, so warnings from parallel sessions can be told apart:

```
Claude cache cold in 10 min · api-server
“rename the config loader”. Send a message to keep it warm.
```

Linux packages, if missing (Ubuntu names): `sudo apt install libnotify-bin` for `notify-send`,
and for sound `sudo apt install pulseaudio-utils` for `paplay`. `canberra-gtk-play` is used first
if the desktop already has it.

## Scope

- **Loaded everywhere** if you list the folder in `env.CLAUDE_CODE_PLUGIN_DIRS`: every VS Code
  window, every project, the terminal.
- **Survives restarts:** the mod and its settings are plain files. Sessions started after a
  reboot load it as before.
- **Settings are global:** one set of values for all sessions, in `pluginConfigs`.
- **Only the countdown is per session:** each session has its own cache, so each keeps its own
  clock and warns on its own. A session that is not running (window closed, machine off) has no
  clock and warns nobody.
- **Parallel sessions warn in parallel.** Seven open sessions are seven clocks. The folder in the
  title is how you tell which one is asking.

## Install

From a Claude Code session:

```text
/plugin marketplace add Ev3nt1ne/cache-watch
/plugin install cache-watch@cache-watch
```

Or clone it and load it in every session through `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/cache-watch" } }
```

To try it once without changing settings: `claude --plugin-dir /path/to/cache-watch`.

## Settings

`/config` lists them under cache-watch, or put them in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "cache-watch": {
    "options": {
      "warnMinutes": 10,
      "ttlMinutes": 60,
      "desktop": true,
      "phone": true,
      "awayMinutes": 2,
      "sound": false,
      "log": true
    }
  }
}
```

| Setting | Default | What it does |
|---|---|---|
| `warnMinutes` | 10 | How long before the assumed end of the cache to warn |
| `ttlMinutes` | 60 | The cache's assumed lifetime. 5 for a 5-minute cache |
| `desktop` | true | The desktop popup |
| `phone` | true | Try the phone push (read *The phone leg* first) |
| `awayMinutes` | 2 | Count you away from the machine after this long. Under it, the phone is not tried |
| `sound` | false | Play the reminder sound with the popup |
| `log` | true | Append one line per firing to `~/.cache/cache-watch/fire.log` |

## Commands

- `/cache-watch` — the settings and the time left in this session
- `/cache-watch test` — notify now, on every channel that is on, and report what each one did
- `/cache-watch log` — the last ten firings, with their drift

## Limits

- The cache's real state is invisible to mods, so everything here is a clock, not a reading.
- **A skewed host clock moves the warning.** Host timers use `CLOCK_MONOTONIC`, and under WSL2 that
  clock commonly runs at the wrong rate; see *Known issue: WSL2 clock skew* above.
- The phone needs that session's Remote Control bridge to be live, and Claude Code's own presence
  check can still refuse it; see *The phone leg* and *Not possible yet*.
- After the mod reloads mid-session the clock continues from the last request, but a warning
  whose time has already passed is skipped.
- Changes to the mod's files reach a VS Code session only after a window reload (SDK hosts watch
  a plugin folder only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`).
- The warning is one notification per idle stretch. It does not nag, and it will not send
  anything on your behalf to keep the cache warm — that is your keystroke to make.

## Files

- `hooks/register.ts` — the mod
- `bin/toast.ps1` — the Windows notification
- `bin/idle.ps1` — how long since you last touched the Windows desktop
- `tests/cache-watch.test.ts` — `claude plugin test .`
- `types/index.d.ts` — the session value it keeps (`cache-watch.lastRequestAt`)

## Checks

```bash
claude plugin validate .      # manifest, hooks, the calls and state it uses
claude plugin test .          # 13 tests, mocked clock, popups, idle and push
tsc -p .                      # after Claude Code has loaded the mod once
```

## Licence

MIT. See [LICENSE](LICENSE).
