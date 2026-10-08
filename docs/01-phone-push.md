# 01 — The phone leg cannot deliver on Claude Code 2.1.293

Read out of the binary on 2026-10-07, after three live attempts with Remote Control connected
delivered nothing to the phone. This supersedes the earlier reading of 2.1.291 in the README,
which had the two gates right and the delivery wrong: a push that passes both gates still has
nowhere to go.

## What was observed first

| When | Path | What the tool answered | What reached the phone |
|---|---|---|---|
| 16:28, the scheduled warning, `idle=4min` | the mod's timer, no turn in flight | `pushSent: true` → logged as `phone: sent` | nothing |
| 19:23, the assistant called the tool after a 10 s wait | an ordinary turn | `Mobile push requested.` | nothing |
| 19:25, the same again after 5 s | an ordinary turn | `Mobile push requested.` | nothing |

Remote Control was live in the Claude phone app, the app's OS notification permission was
already known to work, and nothing appeared in the Remote Control session view either. The
first of the three is the only `pushSent: true` in the whole firing log: every earlier attempt
was refused at a gate and never reached the wire, which is why this took until now to see.

## Fact: the tool is one local event

`PushNotificationTool` in 2.1.293, the whole body after the gates:

```js
n?.({type:"os_notification", message:t, notificationType:"push_notification"});
let p = !e;                                  // localSent = !isNonInteractiveSession
if (!c) return {pushSent:false, localSent:p, disabledReason:"no_transport"};
return {pushSent:true, localSent:p};
```

`n` is the tool call's `onProgress`. There is no second send — no device token, no APNs or FCM
call, no request to any server. `pushSent` is assigned from `c`, the transport flag, and
`localSent` from whether the session is interactive. Both are labels computed from local state
at the moment of the call, and neither is a receipt.

The tool's own user-facing string for that branch is `"Mobile push requested."` — not "sent".

## Fact: the event's documented channels are local

The schema's doc comment for `os_notification`:

> Emitted when a tool (PushNotificationTool, the Computer Use wrapper) or turn-end cleanup
> requests a native OS notification. The surface dispatches to its platform notification
> channel (iTerm2/Kitty/Ghostty/bell in the terminal; native IPC for desktop/IDE). From
> internal QueryEvent 'os_notification'.

Terminal escape sequences, and native IPC for desktop or IDE. No mobile channel is named.

## Fact: the event is dropped from the serialized stream

In the event-conversion switch, `os_notification` sits in a group of cases whose body is a bare
`return`, so nothing is yielded downstream:

```js
case "api_metrics": case "os_notification": case "open_message_selector":
case "apply_flag_settings": /* … */ return;
```

The only consumer found anywhere is `n.onOSNotification?.(e)`, in the local terminal UI
dispatcher.

## Fact: the transport flag says nothing about the far end

```js
r = env.CLAUDE_CODE_REMOTE || $n()            // isRemote
c = r || Gc() || Wne()                        // transport
```

`Gc()` is `surfaceCapabilities.replBridgeActive()`, a plain in-memory boolean written by
`replaceReplBridgeActive(e)`. It records that a bridge was *declared* — not that it is still
alive, and not that whatever is on the other end can render a notification. `Wne()`, the third
transport source, was not resolved; the 2.1.291 reading in the README listed only two.

## Inference

On 2.1.293, `PushNotification` has no path to a phone. `pushSent: true` means a transport flag
was true and one local event was emitted. All three live attempts are consistent with that, and
so is the earlier silence.

What this does **not** formally exclude: a consumer of `onOSNotification` elsewhere in the
binary that forwards to the Remote Control bridge. Not every consumer was traced. Three live
failures with the bridge up is the practical evidence, not a proof.

## What the mod does about it

- `phoneReport()` reports `phone: requested`, never `phone: sent`. The second would be a
  stronger claim than the tool itself makes — the same class of bug 0.2.0 already fixed once.
- The idle probe and the `awayMinutes` gate stay in the code. They are correct, and if a mobile
  channel ever appears the leg starts working by flipping one setting.
- **`phone` ships off** as of 0.3.0. Advertising a channel that cannot deliver is the same fault
  as reporting `sent` for a push that was only requested, one setting further out. Turning it on
  is how you would watch for a channel appearing: the firing log records whatever the tool
  answers, which is how this was found in the first place. Off, the probe does not run either,
  so a default install logs `idle=unknown`.
