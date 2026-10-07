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
| Windows popup **with sound** (`sound: true`) | **Fires**: PowerShell reports the toast shown with the reminder audio attached. Nobody has yet confirmed hearing the chime |
| `/cache-watch` and `/cache-watch test` in the **VS Code** extension | **Work** |
| `/cache-watch` and `/cache-watch test` in a **terminal** session | **Work.** Checked on 2026-10-07 with `claude --plugin-dir` in print mode |
| **Phone push** | **Never confirmed to arrive.** See *The phone leg* below: the tool reports it was skipped, and the mod now says so instead of claiming success |
| Warning timing (fires once, at `ttlMinutes - warnMinutes`, subagent requests ignored, settings honoured, logged) | **Covered by the test suite** (9 tests, mocked clock, `claude plugin test .`) |
| Warning timing in a **real** idle session | **Fires, but one real firing looked about 4 minutes early.** Unexplained; now instrumented. See *The timing* |
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

This is the part that does not work, and it is worth reading before you turn it on.

The mod asks for the push through Claude Code's own `PushNotification` tool. That tool:

- sends a **desktop** notification on the machine running the session, and reaches **your phone
  only if Remote Control is connected** there;
- **deliberately skips itself when it judges you present at the keyboard**, returning a result
  that says `disabledReason: "user_present"`. Not an error — a refusal to interrupt you with
  something you can already see.

A test fired by hand can therefore never demonstrate the phone leg: typing `/cache-watch test`
makes you present by definition. On 2026-10-07, in a terminal session, the tool answered exactly
that:

```
Test sent: Windows: shown, phone: not sent (Claude Code took you to be at the keyboard).
```

Whether a *real* firing, 50 minutes into an idle session, is judged the same way is unknown.
The firing log now records the answer, so the next real warning will settle it.

Until version 0.2.0 the mod reported `phone: sent` for any result that was not an error — so a
skipped push looked like a delivered one. That was the bug behind "it says sent and my phone is
silent". Now every channel reports what actually happened.

Push also needs `"agentPushNotifEnabled": true` in your settings; with it off the tool answers
`config_off` and the mod says so.

## The timing

In my own use, the warning seemed to arrive with about **14 minutes** left rather than the
configured 10 — consistently, not randomly. I could not reproduce it from the code or the data:

- `turn.step` fires once per **model request**, so the clock is anchored on the last request of
  a turn, not on your message. Across 983 turns in my transcripts, the final request of a turn
  took a median of 2 seconds and at most 1.5 minutes, so "the turn took four minutes" cannot
  explain a four-minute error.
- The test suite schedules and fires on a mocked clock, and the arithmetic is exact there.

Two candidates remain, neither confirmed: the host firing a 50-minute timer early, or a warning
from one of several open sessions being read against the window I happened to be looking at
(each session has its own cache and its own clock, and warns on its own).

So version 0.2.0 instruments it instead of guessing:

- Every firing appends a line to `~/.cache/cache-watch/fire.log` with the anchor, the time the
  warning was *meant* for, the drift between them, which session and folder it came from, and
  what each channel did. `/cache-watch log` prints the last ten.
- A timer that comes back **more than 30 seconds early** is re-armed for the rest of its wait,
  up to three times, and the early return is logged. (This path cannot be exercised by the test
  suite — a mocked clock fires exactly on time — so it is written to be plainly correct rather
  than proven.)
- The warning names the minutes that are really left at the moment it fires, not the configured
  `warnMinutes`, so a late timer tells the truth.

If you prefer to be warned earlier, that is a setting, not a bug to live with: `warnMinutes: 15`
costs you one message and buys a wider margin.

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
Claude cache cold in 10 min · recovery
“check the flash log”. Send a message to keep it warm.
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
| `sound` | false | Play the reminder sound with the popup |
| `log` | true | Append one line per firing to `~/.cache/cache-watch/fire.log` |

## Commands

- `/cache-watch` — the settings and the time left in this session
- `/cache-watch test` — notify now, on every channel that is on, and report what each one did
- `/cache-watch log` — the last ten firings, with their drift

## Limits

- The cache's real state is invisible to mods, so everything here is a clock, not a reading.
- The phone leg depends on Claude Code's own judgement of whether you are present; see above.
- After the mod reloads mid-session the clock continues from the last request, but a warning
  whose time has already passed is skipped.
- Changes to the mod's files reach a VS Code session only after a window reload (SDK hosts watch
  a plugin folder only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`).
- The warning is one notification per idle stretch. It does not nag, and it will not send
  anything on your behalf to keep the cache warm — that is your keystroke to make.

## Files

- `hooks/register.ts` — the mod
- `bin/toast.ps1` — the Windows notification
- `tests/cache-watch.test.ts` — `claude plugin test .`
- `types/index.d.ts` — the session value it keeps (`cache-watch.lastRequestAt`)

## Checks

```bash
claude plugin validate .      # manifest, hooks, the calls and state it uses
claude plugin test .          # 9 tests, mocked clock, popups and push
tsc -p .                      # after the engine has loaded the mod once
```

## Licence

MIT. See [LICENSE](LICENSE).
