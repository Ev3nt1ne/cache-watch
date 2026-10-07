# Cache Watch — what is missing

State as of 2026-10-07, Claude Code 2.1.291, Ubuntu 24.04 under WSL2.
Everything below is either untested, undone, or impossible today. What *is* verified lives in the
README's status table, and what is impossible has its reasons there too.

## 1. Designed, not built

### 1.1 Re-probe the machine instead of dropping the phone (the user's design, 2026-10-07)

Today, when the warning fires and the OS says you touched the machine less than `awayMinutes` ago,
the phone leg is simply not tried: the desktop popup is taken to be enough. Wanted instead:

- On firing, read the idle time. If it is below `awayMinutes`, **start a second timer** of
  `awayMinutes - idle`.
- When that timer resolves, **re-probe the OS**. If you have gone away by then, send the phone push.

Open points to settle when building it (not decided):

- If you are *still* at the machine, does it probe again (a loop), or give up?
- A loop needs a stop: the obvious one is the cache's own end (`anchor + ttlMinutes`) — past that
  a push is pointless. A cap on probes is the other.
- The desktop popup must not repeat; only the phone leg is pending.
- Every probe should add a log line, or the log stops being the record of what happened.
- A new request cancels the plan, which already cancels the pending timer — keep that true for the
  second timer too (one `timer` variable holds only one of them today).

### 1.2 Read the cache's TTL instead of assuming 60 minutes

`ttlMinutes` is a setting because the mod cannot read the real lifetime. But model-switch events
carry `cache_ttl: '5m' | '1h'` beside `prompt_cache_warm`. Hooking those events would let the mod
set its own `ttlMinutes` from what the session actually uses, and notice a switch that changes it.
Not attempted; worth checking whether such an event is visible to a mod at a useful moment.

### 1.3 Smaller ideas, none started

- `$.ui.status()` could show the minutes left in the status line. That would also make the timing
  question answer itself, at a glance, in every session.
- `$.audio.play({ asset })` is in the mod API: one sound file in the repo would replace both the
  Windows and the Linux sound paths, and work where neither tool exists.
- A `content` setting for how much a notification may say (folder only / folder + gist). Today it
  is always folder + the first 60 characters of your last message.
- macOS has no popup path at all (`osascript -e 'display notification'` or `terminal-notifier`).

## 2. Waiting on Claude Code (cannot be built here)

Both are written up in the README under *Not possible yet*, with the evidence:

- **The cache's real state.** No warm/cold flag or expiry on `$`.
- **`phone: all`** — a push that does not need that session's live Remote Control bridge. The phone
  is reached only as a connected surface; the CLI has no server-side send path.

## 3. Never observed live

The important one is first, and only time closes it.

- [ ] **A real firing in an idle session.** The log holds only `test` lines so far. It will show
      `drift=` (the ~4-minute puzzle), the measured `idle=`, and what the phone gate did.
- [ ] **A phone push arriving.** Needs `/remote-control` live in a session *and* an idle firing.
      Until then the phone leg is unproven end to end.
- [ ] **Whether `CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK=1` is needed.** Decide from a log
      line that says `user_present` while the machine reports half an hour idle — not from a guess.
      It is global and it also stops Claude's own pushes being suppressed.
- [ ] **A firing in an interactive terminal session.** Only print mode (`claude -p`) has been
      checked. The interactive case is the one where `terminalFocus()` is most likely to be
      reported, which is exactly what makes the presence check bite.
- [ ] **A firing in a VS Code window.** Only `/cache-watch test` has been seen there.
- [ ] **A timer across a machine sleep.** Shut the lid for ten minutes inside the 50-minute wait and
      see whether the warning still lands where it should. This is a live candidate for the
      4-minute drift.
- [ ] **Several sessions warning at once.** The folder in the title is the fix for telling them
      apart; nobody has watched it happen.
- [ ] **A 5-minute cache** (`ttlMinutes: 5`). Unit-tested only.
- [ ] **Linux desktop, all of it**: the `notify-send` popup, whether `--urgency=critical` really
      stays until dismissed, the sound through `canberra-gtk-play`/`paplay`, and idle detection
      through `xprintidle` or Mutter. There is no X11 or GNOME session on this machine; the test
      suite only drives fake commands. Needs a real Linux desktop.
- [ ] **macOS**: unsupported by design today, see 1.3.

## 4. Tests to add

13 pass now. Missing cases, roughly in order of what would catch a real bug:

- [ ] **Reload inside the warning window**: `session.start` with an anchor already past the firing
      time must schedule nothing. That branch (`delay <= 0` in `schedule()`) has no test.
- [ ] **`desktop: false, phone: true`**: the machine must still be probed for idle time. The code
      probes it independently of the popup setting on purpose; nothing holds that true.
- [ ] **Log pruning** at `LOG_LINES` (200). Only ever exercised with one line.
- [ ] **`warnMinutes >= ttlMinutes`**: schedules nothing, and `status()` still reads sensibly.
- [ ] **Every channel off**: `notify()` answers `no channel is switched on`.
- [ ] **The remaining phone branches**: `config_off`, a `deny`, an `isError`, and a result with
      neither `pushSent` nor a `disabledReason`. Only `no_transport` and `user_present` are covered.
- [ ] **A failed Windows toast**: PowerShell exits non-zero, or prints no `shown` → `Windows: failed`.
- [ ] **A failed `notify-send`**, and sound failing while the popup worked.
- [ ] **The re-arm path** (`drift < -30s`). Known gap: a mocked clock fires exactly on time, so the
      test kit cannot produce an early timer. If that ever becomes possible, this is the first test
      to write — it is the only logic in the mod with no coverage at all.
- [ ] **`idleMs` parsing**: junk on stdout, a timeout, a negative or absurd number.

## 5. Repo and publishing

- [ ] **Push.** `gh repo create Ev3nt1ne/cache-watch --public --source=. --push` (the user's call;
      deliberately not done). `grammar-guard` is in the same unpushed state.
- [ ] **Tag the release** once pushed: `claude plugin tag .` creates `cache-watch--v0.2.0` and
      checks that `plugin.json` and the marketplace entry agree.
- [ ] **Repo description and topics** on GitHub, after the push (web UI; nothing local to do).
- [ ] **A screenshot** of the toast in the README. Cannot be produced from here.
- [x] **Discovery metadata**, to match grammar-guard: `.claude-plugin/marketplace.json` (so
      `/plugin marketplace add Ev3nt1ne/cache-watch` works the moment the repo is public), plus
      `displayName`, `homepage`, `repository`, `license` and `keywords` in `plugin.json`. Both
      manifests pass `claude plugin validate`.
- [ ] **The public plugin directory** (3,234 listings in this build's cache, most from community
      repos, unreviewed entries included). There is **no CLI command** that submits one:
      `claude plugin` has install/validate/tag/eval but no publish. Getting listed is an
      out-of-band step, and nothing here can verify it.

## 6. Rough edges worth knowing

- The notification always names the folder and the first 60 characters of your last message. That
  is a deliberate choice (it is how you tell seven sessions apart), but it does travel to the
  phone. See 1.3 for the setting that would make it adjustable.
- One `timer` module variable holds the single pending warning. A reload drops it and
  `session.start` rebuilds it from the stored anchor; the second timer in 1.1 will need more care.
- `appendLog` reads the whole log and writes it back on every firing. Fine at 200 lines, wrong if
  that number ever grows a lot.
- The mod spawns PowerShell twice per firing on Windows (toast, then idle). Measurable but
  irrelevant at once per idle stretch; worth remembering before adding a third.
