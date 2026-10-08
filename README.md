# Cache Watch

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that warns you a few
minutes before a session's prompt cache goes cold, so you can send something and keep it warm.

Claude Code caches your conversation on the API side with a one-hour lifetime. While that entry
is alive, your next message re-reads it cheaply; once it lapses, the whole conversation is sent
and written again at the cache-write price. If you step away from a long session for an hour,
you come back to a bill you could have avoided with one keystroke.

Cache Watch sends one notification per idle stretch, `warnMinutes` (10 by default) before the
cache's assumed end: a desktop popup that stays until you dismiss it, optionally a sound, and —
if you switch it on — a phone push, which on Claude Code 2.1.293 has nowhere to go. That leg
ships off for exactly that reason; *The phone leg* is the whole story. It says nothing when the
cache actually goes cold — by then there is nothing to save.

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
| **Several sessions warning at once** | **Works.** Watched live on 2026-10-07: parallel warnings landed and the folder in each title told them apart. It also turned up the quoting bug below |
| **Phone push** | **Cannot arrive.** Read out of the 2.1.293 binary on 2026-10-07: the tool has no mobile channel at all. Three live attempts with Remote Control connected in the phone app delivered nothing. See *The phone leg* and [docs/01-phone-push.md](docs/01-phone-push.md) |
| Warning timing (fires once, at `ttlMinutes - warnMinutes`, subagent requests ignored, settings honoured, logged) | **Covered by the test suite** (15 tests, mocked clock, `claude plugin test .`) |
| A **scheduled** warning firing in a live session | **Works.** Seen on 2026-10-07 in an interactive terminal session and in a VS Code window — not `/cache-watch test`, but the timer's own firing, logged as `fire` |
| Warning timing in a **real** idle session | **Works, and the re-arm guard with it.** On 2026-10-07 the log paired `early … drift=-231s re-armed` with `fire … rearms=1 drift=-17s`: the host's clock returned the timer nearly four minutes early, the re-arm covered the rest, and the warning landed within 17 s of its time. See *The timing* |
| **Linux desktop** popup and sound (`notify-send`) | **Untested on a real desktop.** The automated test drives a fake `notify-send`; it has never run against a notification daemon |
| macOS | **Not supported.** No popup path; `/cache-watch test` reports `desktop: no notifier found` |

Built and run on Ubuntu 24.04 under WSL2, with Claude Code 2.1.291, and the phone leg re-read
against 2.1.293. It needs a version that loads mods (function hooks). Everything below that is
read out of the binary carries the version it was read from, because these internals move.

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

**This part does not work, and on 2.1.293 it cannot.** The phone leg has no delivery path at
all: `PushNotification` reports a push that it never had a way to send. Read this before you
turn `phone` on and trust what the log tells you. The full reading, with the extracted code, is
in [docs/01-phone-push.md](docs/01-phone-push.md).

The mod asks for the push through Claude Code's own `PushNotification` tool. Read out of the
2.1.293 binary, that tool decides like this:

```js
isRemote  = env.CLAUDE_CODE_REMOTE || isRemoteSession()
transport = isRemote || surfaceCapabilities.replBridgeActive() || <a third source, unresolved>

if (transport && !isRemote && !agentPushNotifEnabled)        -> config_off
if (!isRemote && !env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
                && userPresent())                            -> user_present
emit({ type: "os_notification", notificationType: "push_notification" })  // the only send
if (!transport)                                              -> no_transport (local popup only)
else                                                         -> pushSent
```

Two gates — and then a send that goes nowhere near a phone.

**The delivery, which is the whole problem.** That `emit` is the tool's entire output. There is
no device token, no APNs or FCM call, no request to any server. `pushSent` is assigned from the
`transport` flag and `localSent` from whether the session is interactive: both are labels
computed from local state, not receipts. The tool's own wording for that branch is *"Mobile push
requested."* And the event they label is documented for local surfaces only:

> The surface dispatches to its platform notification channel (iTerm2/Kitty/Ghostty/bell in the
> terminal; native IPC for desktop/IDE).

No mobile channel is named, the event is dropped from the serialized event stream, and the only
consumer found anywhere is the local terminal UI. Measured against that: three live attempts on
2026-10-07 — one scheduled warning, two from ordinary turns — with Remote Control connected in
the Claude phone app and its notification permission known good. All three reported success.
None arrived, and none showed up in the Remote Control session view either.

**The transport flag.** `replBridgeActive()` is a plain in-memory boolean recording that
Remote Control (`/remote-control`, "Control this session from your phone or claude.ai/code")
attached to *this* session. It does not mean the bridge is still alive, and, as above, it does
not mean anything on the far end will render a notification. It is also per-session, so with
several sessions open it is one bridge each: a bridge on the session you are sitting in does
nothing for a warning fired by another one.

**The presence check.** Claude Code's own idea of whether you are there:

```js
userPresent() = terminalFocus() ?? (Date.now() - lastInteractionTime() < 60_000)
```

If the surface reports focus, focus alone decides. So **a window you left focused and walked away
from reads as present for ever** — exactly when a push would be the only thing that reaches you.
`CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK=1` in your settings `env` switches that check
off; it also stops Claude's own pushes being suppressed, so it is left to you. The firing log
records `user_present` when it happens, which is the evidence to decide on rather than a guess.

This check also behaves differently per surface, which matters if you try to test the leg by
hand. On 2026-10-07, with a message typed seconds earlier: a terminal session refused the send
with `user_present`, while a VS Code session under the same conditions answered `no_transport`
instead — the check never fired there. So a hand test in VS Code tells you nothing about the
gate, and a hand test in a terminal is swallowed by it unless you set that variable first.

**What the mod does instead.** It asks the machine, not Claude Code:

| Machine | How |
|---|---|
| Windows (incl. WSL) | `GetLastInputInfo`, system-wide: counts you typing in *any* window |
| Linux | `xprintidle`, else GNOME's `org.gnome.Mutter.IdleMonitor.GetIdletime` over D-Bus |
| Neither answers | idle unknown, and the mod assumes you are away |

The phone is tried only when the machine says nobody has touched it for `awayMinutes` (2 by
default). Under that, the desktop popup has already reached you and a push would be noise.

Since 2.1.293 gates a leg that cannot deliver, `phone` now ships **off**, and the probe only
runs when you switch the phone on — it exists to gate the phone and nothing else, so a default
install spends no PowerShell call on it and logs `idle=unknown`. The code is kept as it is: it
is correct, and if a mobile channel ever appears the leg starts working by flipping one setting.
With the phone on, the measured idle time goes into every log line, and `/cache-watch test`
prints it:

```
Test sent: Windows: shown, phone: not sent (Claude Code took you to be at the keyboard).
(you last touched this machine 4s ago; a real warning skips the phone under 2 min.)
```

`/cache-watch test` always attempts the push, because a test fired by hand is fired by someone
present, so it can never show you the real thing.

Until version 0.2.0 the mod reported `phone: sent` for any result that was not an error — so a
skipped push looked like a delivered one. That was the first half of "it says sent and my phone
is silent". The second half was that `phone: sent` then repeated the tool's own `pushSent` as
though it were a delivery; it now reads `phone: requested`, which is all the tool ever knew.

Push also needs `"agentPushNotifEnabled": true` in your settings; with it off the tool answers
`config_off` and the mod says so. One trap: setting `CLAUDE_CODE_REMOTE` makes `transport` true
unconditionally, so the tool reports `pushSent: true` with nothing on the other end. Don't.

## What is not verified

The status table above says what has been checked. This is the other half of it, in one place,
because a young tool that is vague about its gaps is worse than one that names them.

One item that used to sit in this list has been settled, and not in the mod's favour: **a phone
push arriving** cannot happen on 2.1.293, because no mobile channel exists. See *The phone leg*
and [docs/01-phone-push.md](docs/01-phone-push.md).

**Never seen happen, on any machine.** These are not believed to be broken; nobody has watched
them:

- A firing **across a machine sleep**. The re-arm guard is written for a timer that returns early,
  but a suspended host has not been tried.
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
exercises it. That host has now exercised it repeatedly — every `early … re-armed` line in the
firing log of 2026-10-07 is this branch running — so it is observed, and still untested.

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
teleported sessions — not to a local one. And the per-session path is no fallback: on 2.1.293 it
does not deliver either, because the event a local session emits is dispatched only to terminal
and desktop/IDE channels (*The phone leg*). So there is no push from a local Claude Code session
to a phone at all, by either route. The mod keeps asking and keeps reporting what came back, so
the day a channel appears the firing log will show it.

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
  and the warning lands within about 20 s of its time. That is measured, not predicted: on
  2026-10-07 the log recorded `early … drift=-231s re-armed` followed by `fire … rearms=1
  drift=-17s`, four times over.
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
it. Nor is the rate steady on one machine: this one read **+8.33%** in the afternoon of
2026-10-07 and **+6.99%** the same evening — positive both times, and it has never been measured
negative here. A correction factor would have to be re-measured to stay right, which is the
argument for re-arming instead. Check your own machine:

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

Defaults: popup on, **phone off**, sound off, log on. The phone ships off because on 2.1.293 it
cannot arrive — see *The phone leg*. Every notification names the project folder and the start of
your last message, so warnings from parallel sessions can be told apart:

```
Claude cache cold in 10 min · api-server
“rename the config loader”. Send a message to keep it warm.
```

**The quoted message is the last one *you* typed.** Not every user-role message is: the harness
posts its own as user messages — background-task notifications, slash-command wrappers, IDE
selections, reminders — and they carry no flag that tells them apart. Quoting one put a raw
`<task-notification><task-id>…` in a live popup on 2026-10-07, in a terminal session that had
run a background command; the same warning read cleanly from a VS Code session that had not.
They are now recognised by their opening tag and skipped, and a message that opens with a tag
this mod has not met is dropped rather than quoted.

Linux packages, if missing (Ubuntu names): `sudo apt install libnotify-bin` for `notify-send`,
and for sound `sudo apt install pulseaudio-utils` for `paplay`. `canberra-gtk-play` is used first
if the desktop already has it.

## Scope

- **Built for the long cache.** `ttlMinutes` defaults to 60 because that is the lifetime Claude
  Code uses, and this mod is for that one and for any longer period a later build might use.
  Below roughly ten minutes left there is too little time to act on for a warning to be worth
  sending, so short lifetimes are out of scope today. A `fast` option — off by default, switched
  on deliberately, firing one minute before the cache goes cold whatever `ttlMinutes` says —
  would cover every lifetime. It is not built.
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
      "phone": false,
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
| `ttlMinutes` | 60 | The cache's assumed lifetime. Built for the 60-minute cache and anything longer — see *Scope* |
| `desktop` | true | The desktop popup |
| `phone` | **false** | Ask for the phone push. Off by default because on 2.1.293 nothing delivers it — read *The phone leg* before turning it on |
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
- **The phone leg cannot deliver on 2.1.293**, which is why it ships off. A live Remote Control
  bridge is not enough, and Claude Code's own presence check can refuse the attempt before that
  even matters; see *The phone leg* and *Not possible yet*.
- After the mod reloads mid-session the clock continues from the last request, but a warning
  whose time has already passed is skipped.
- Changes to the mod's files reach a VS Code session only after a window reload (SDK hosts watch
  a plugin folder only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`).
- The warning is one notification per idle stretch. It does not nag, and it will not send
  anything on your behalf to keep the cache warm — that is your keystroke to make.

## Files

- `hooks/register.ts` — the mod
- `CHANGELOG.md` — what changed in each version, and why
- `docs/01-phone-push.md` — why the phone leg cannot deliver on 2.1.293, with the code it was read from
- `bin/toast.ps1` — the Windows notification
- `bin/idle.ps1` — how long since you last touched the Windows desktop
- `tests/cache-watch.test.ts` — `claude plugin test .`
- `types/index.d.ts` — the session value it keeps (`cache-watch.lastRequestAt`)

## Checks

```bash
claude plugin validate .      # manifest, hooks, the calls and state it uses
claude plugin test .          # 15 tests, mocked clock, popups, idle and push
npx tsc -p .                  # after `npm i`, and after Claude Code has loaded the mod once
```

## Licence

MIT. See [LICENSE](LICENSE).
