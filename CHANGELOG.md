# Changelog

Dates are the day the work was done. Versions follow the plugin manifest.

## 0.3.0 — 2026-10-07

The phone leg turned out not to be slow or fragile but impossible, and two of the three changes
here follow from that.

### Changed

- **`phone` now defaults to `false`.** On Claude Code 2.1.293 the push cannot arrive, so shipping
  the channel on advertised something the mod cannot do. Turning it on still works and still
  logs what the tool answered, which is how a future mobile channel would be noticed.
- **`phone: sent` is now `phone: requested (no phone delivery on 2.1.293)`.** `PushNotification`
  returns `pushSent: true` as a label computed from a local transport flag, not as a delivery
  receipt — its own wording is "Mobile push requested". 0.2.0 stopped reporting a *skipped* push
  as sent; this stops reporting a *requested* one as sent.
- The idle probe now runs only when `phone` is on, since gating the phone is all it was ever for.
  A default install logs `idle=unknown` and spends no PowerShell call on it.
- `ttlMinutes` is documented as being for the 60-minute cache and anything longer. Below roughly
  ten minutes left a warning is too late to be worth sending, so short lifetimes are out of
  scope until a `fast` option exists.

### Fixed

- **The quoted message could be the harness's, not yours.** The notification quotes the last
  user-role message, but Claude Code posts its own as user messages — `<task-notification>`,
  slash-command wrappers, IDE selections, reminders — with no flag to tell them apart. A session
  that had run a background command showed a raw `<task-notification><task-id>…` in its popup.
  Known envelopes are now skipped, and a message still opening with `<` is dropped rather than
  quoted.

### Documented

- `docs/01-phone-push.md`: why the phone leg cannot deliver, read out of the 2.1.293 binary, with
  the extracted code, three live attempts, and the limit of what was traced.
- The status table records what was seen live on 2026-10-07: a scheduled warning firing in a real
  interactive terminal session and in a VS Code window, several sessions warning at once, and the
  re-arm guard absorbing a host clock that returned a 50-minute timer 231 s early.
- Claude Code's presence check behaves differently per surface: a terminal session refused a send
  with `user_present` where a VS Code session answered `no_transport` under the same conditions.
- The host's monotonic skew is not a stable rate — +8.33% and +6.99% on the same machine on the
  same day — which is the argument for re-arming rather than correcting.

## 0.2.0 — 2026-10-07

### Changed

- Every channel reports what actually happened. Until 0.2.0 any non-error result from
  `PushNotification` was logged as `phone: sent`, so a push skipped at one of its gates looked
  like a delivered one.
- The phone leg is decided from the machine's own idle time (`GetLastInputInfo` on Windows,
  `xprintidle` or Mutter on Linux), not from Claude Code's presence check, which counts a window
  left focused and walked away from as present indefinitely.

### Added

- The firing log (`~/.cache/cache-watch/fire.log`, `/cache-watch log`): one line per firing with
  the anchor, the time the warning was meant for, the drift between them, the measured idle time,
  the session and folder, and what each channel did.
- A timer that returns more than 30 seconds early is re-armed for the rest of its wait, up to
  three times, and the early return is logged. The warning names the minutes really left.
- Discovery metadata: `.claude-plugin/marketplace.json`, and `displayName`, `homepage`,
  `repository`, `license` and `keywords` in `plugin.json`.
