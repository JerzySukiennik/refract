# REFRACT — Multiplayer

Everything in this document describes `js/net.js`. That module is the **only** file that
talks to Firebase. Nothing else in the game imports the Firebase SDK.

The governing principle: **multiplayer can never break the solo game.** `joinRoom()` never
throws and never rejects. Every failure path — CDN blocked, offline, config missing, auth
refused, rules denied, room full — resolves to an inert handle with the same shape and
`ok === false`, logs one line, and the game carries on as a single-player puzzle.

---

## 1. Firebase project

Refract shares the `gzowos-games` Realtime Database with the other games on this account,
because the Google Cloud project quota is exhausted. All Refract data lives under the single
top-level branch **`refract/`** and touches nothing else.

The web config lives in `js/net.js` as `FIREBASE_CONFIG`. The `apiKey` there is a **public
client identifier**, not a secret — it ships inside every page that uses Firebase, and it is
the documented convention for this project. Security comes from the rules in §5.

| Field | Value |
|---|---|
| projectId | `gzowos-games` |
| databaseURL | `https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app` |
| Auth | Anonymous only |
| SDK | modular v10.12.5, ES modules from `https://www.gstatic.com/firebasejs/…` |

---

## 2. Data model

Room path: **`refract/rooms/<CODE>`**.

```
refract/rooms/<CODE>/
  meta/
    createdAt   number   server timestamp, written once via transaction
    level       number   level index the room is currently on
  seats/
    <0..7>      string   uid holding that colour slot (mutual exclusion via transaction)
  players/
    <uid>/
      n         string   display name, <= 16 chars, uppercase
      ci        number   colour index 0..7, indexes PLAYER_COLORS
      x         number   cursor x in BOARD UNITS (0..1000), integer
      y         number   cursor y in BOARD UNITS (0..1000), integer
      t         number   lastSeen, ms since epoch on a server-corrected clock
  optics/
    <opticId>/
      k         'm'|'p'  mirror or prism
      x         number   board units, 1 decimal
      y         number   board units, 1 decimal
      a         number   angle in radians, 4 decimals
      b         string   uid of the last writer (attribution for last-write-wins)
      ts        number   client timestamp of that write, server-corrected
      d         true     tombstone: this optic was removed
      c         string   soft-lock holder uid, or absent/null when free
      ct        number   timestamp the soft lock was last refreshed
```

Field names are one or two characters because cursor writes go out at 20 Hz per player and
the key names dominate the payload.

### Why board units

Cursor positions are stored in the logical 1000 × 1000 board space of `ARCHITECTURE.md` §3,
never in pixels. Two players on a 4K desktop and an iPhone XR therefore see each other's
cursors over the same board feature regardless of window size. Callers convert with
`pixelToBoard()` from `render/gl.js` before calling `setCursor`.

### Presence and ghosts

Three layers, because each one alone leaks:

1. **`onDisconnect`** removes `players/<uid>` and the player's seat. Covers a closed tab, a
   crashed tab and a dropped connection. Re-armed on every reconnect, since the server
   consumes a registration once it fires.
2. **Heartbeat** rewrites `t` every 15 s so an idle player is not mistaken for a ghost.
3. **Ghost sweep** — every 20 s each live client removes any player whose `t` is more than
   90 s old, and frees its seat. This catches the one case `onDisconnect` cannot: a tab
   killed while it was *already* offline, so the server never had a live socket to notice.
   The rules in §5 permit this deletion and nothing else.

### Colours

`PLAYER_COLORS` is a fixed eight-entry palette, assigned **by join order**. A joiner reads
the live player list, computes the lowest unused index, and claims `seats/<index>` with an
RTDB **transaction** — that transaction, not the read, is what makes the assignment
race-free. If the seat is contested it walks to the next candidate. A ninth player shares a
colour rather than being refused; the game has no player cap and a duplicate cursor colour is
a far better failure than a locked door.

Index 0 is the reference cursor blue `#2E5BFF`. The rest are chosen to stay distinct in hue
under a red/green deficiency and to survive the board's additive bloom.

---

## 3. Room codes

Alphabet: **`ACDEFGHJKMNPQRTUVWXY0123456789`** — 30 characters, default length 4, so 810 000
codes. Every letter that collides with a digit is dropped, which means each dropped letter
folds into exactly one digit when someone reads a code off a screen and mistypes it:

| Typed | Read as |
|---|---|
| `B` | `8` |
| `I`, `L` | `1` |
| `O` | `0` |
| `S` | `5` |
| `Z` | `2` |

`normalizeRoomCode()` applies that folding, uppercases, and drops everything else, so
`"bo-ss1"` and `"80551"` are the same room and pasting a code with spaces or punctuation
just works.

Codes are shareable as a URL. `roomFromLocation()` accepts all of these:

```
https://refract.gzowo.fun/#AQ7K
https://refract.gzowo.fun/#room=AQ7K
https://refract.gzowo.fun/?room=AQ7K
https://refract.gzowo.fun/?r=AQ7K
```

`roomUrl(code)` produces the canonical hash form for the share button.

---

## 4. The op protocol

```js
import { joinRoom } from './net.js';

const net = await joinRoom(codeOrNull, 'JUREK');   // never throws
if (net.ok) {
  net.on('player-join',  p  => cursors.add(p));
  net.on('player-move',  p  => cursors.move(p.uid, p.x, p.y));
  net.on('player-leave', p  => cursors.remove(p.uid));
  net.on('optic',        o  => state.applyRemoteOptic(o));
  net.on('optic-remove', o  => state.removeOptic(o.id));
  net.on('level',        l  => state.setLevel(l.index));
}
```

### Handle

| Member | Notes |
|---|---|
| `leave()` | idempotent; detaches every listener, clears timers, removes presence, frees the seat |
| `setCursor(x, y)` | board units; safe to call on every `pointermove` |
| `broadcast(op)` | see below |
| `on(evt, fn)` / `off(evt, fn)` | `on` also returns an unsubscribe function |
| `mintId()` | a new optic id that cannot collide with another client's — use it for every placement |
| `claim(id)` / `release(id)` | sugar for the `claim` / `release` ops |
| `claimOf(id)` | `{ uid, color }` if another player holds the soft lock right now, else `null` |
| `setLevel(index)` | writes `meta/level` and clears `optics/` |
| `clearOptics()` | reset for everyone |
| `setName(name)` | returns the sanitized name actually stored |
| `ok`, `mode`, `online`, `roomId`, `uid`, `color`, `colorIndex`, `url`, `players`, `optics`, `now()` | `players` and `optics` are live `Map`s |

### Events

| Event | Payload |
|---|---|
| `player-join` | `{ uid, name, color, colorIndex, x, y, t, self }` |
| `player-move` | same shape, fired on any cursor change |
| `player-update` | same shape, fired on a name or colour change |
| `player-leave` | the last known player record |
| `players` | the live `Map`, after any membership change |
| `optic` | `{ id, type, x, y, angle, by, ts, claim, claimTs, claimColor, removed }` |
| `optic-remove` | `{ id, by, ts }` |
| `optics` | the live `Map` |
| `level` | `{ index, initial }` — `initial` is true for the first value seen after joining |
| `status` | `{ state: 'connecting'\|'online'\|'offline'\|'left', roomId }` |

**Local writes do not echo.** An op whose resulting state involves only the local player is
swallowed, because the caller already applied it optimistically. Anything a remote player
touched — including a remote *claim* on an optic we last moved — is always emitted.

### Ops

`broadcast(op)` takes `{ kind, id, ... }`. Invalid kinds and ids containing RTDB-illegal
characters are dropped silently.

| kind | Extra fields | Behaviour |
|---|---|---|
| `place` | `type`, `x`, `y`, `angle` | `set()`, replacing any tombstone |
| `move` | `x`, `y` | throttled, see below |
| `rotate` | `angle` | throttled |
| `remove` | — | writes a **tombstone** `{ d: true, b, ts }`, not a delete |
| `claim` | — | takes the soft lock and starts refreshing it every 2 s |
| `release` | — | flushes any pending drag write, then frees the lock |

### Throttling

Both cursors and drags use the same rate limiter: a **leading-edge write, then at most one
write per 50 ms (20 Hz), with a guaranteed trailing write** so the final position of a drag
always lands even if the pointer stops between slots. Drag writes are coalesced **per optic
id**, so two players dragging two different optics never queue behind each other.

There is never one write per `pointermove`.

### Last-write-wins

Every optic write carries `ts`, a client clock corrected by `.info/serverTimeOffset`, so
timestamps from different machines are comparable to within network jitter. On receipt, a
write whose `ts` is older than the state already held for that optic is **discarded**.

Consequences, which are the whole point:

- Two players dragging **different** optics can never conflict — different keys, no shared
  parent write.
- Two players dragging the **same** optic degrade gracefully: the optic tracks whichever
  write is later, and converges the moment one of them stops. It never oscillates between
  two stale values and it never desyncs permanently.
- `remove` uses a tombstone rather than a delete because a stale in-flight `move` would
  otherwise resurrect a deleted optic. Tombstones are cleared wholesale by `setLevel()` and
  `clearOptics()`.

### The soft lock

While a player drags an optic they hold `c = <uid>` on it, refreshed every 2 s. Other clients
see `claimOf(id)` return `{ uid, color }` and should tint that optic in the owner's colour —
a claimed optic reads as *someone else is holding this*, not as a hard rejection. The lock is
advisory: a second player who drags anyway still wins by timestamp, they just do it against a
visible warning.

The lock **expires after 5 s** and the TTL is evaluated on every `claimOf()` call, so a lock
left behind by a crashed browser fades on its own without any cleanup write. Renderers should
poll `claimOf(id)` per frame rather than caching the `claim` field off an event.

---

## 5. Security rules

> **Read this before deploying.** The `gzowos-games` database has **one** rule set shared by
> every game on the account, and a deploy replaces it **entirely** — there is no per-branch
> deploy. Shipping a file that names only `refract` silently deletes the `ducks`, `satisfarm`,
> `wyspy`, `sentinelCity` and `rooms` rules and breaks all of those games. This exact mistake
> was made on 21 August 2026. **Merge the block below into the canonical shared
> `database.rules.json`, copy that merged file to every sibling project, and only then
> deploy.**

Insert this as a sibling of the existing `ducks` / `satisfarm` branches, above the root
`"$other"` deny:

```json
"refract": {
  "rooms": {
    "$roomId": {
      ".read": "auth != null",
      "meta": {
        ".write": "auth != null",
        "createdAt": { ".validate": "newData.isNumber()" },
        "level": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() < 256" },
        "$other": { ".validate": false }
      },
      "seats": {
        "$seat": {
          ".write": "auth != null && (!data.exists() || data.val() === auth.uid || !root.child('refract/rooms/' + $roomId + '/players/' + data.val()).exists())",
          ".validate": "newData.isString() && newData.val() === auth.uid"
        }
      },
      "players": {
        "$uid": {
          ".write": "auth != null && (auth.uid === $uid || (!newData.exists() && data.child('t').val() < now - 90000))",
          ".validate": "newData.hasChildren(['n','ci','x','y','t'])",
          "n": { ".validate": "newData.isString() && newData.val().length <= 16" },
          "ci": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 7" },
          "x": { ".validate": "newData.isNumber() && newData.val() >= -200 && newData.val() <= 1200" },
          "y": { ".validate": "newData.isNumber() && newData.val() >= -200 && newData.val() <= 1200" },
          "t": { ".validate": "newData.isNumber() && newData.val() <= now + 120000 && newData.val() >= now - 120000" },
          "$other": { ".validate": false }
        }
      },
      "optics": {
        ".write": "auth != null && !newData.exists()",
        "$opticId": {
          ".write": "auth != null",
          ".validate": "newData.hasChild('ts')",
          "k": { ".validate": "newData.isString() && newData.val().matches(/^[mp]$/)" },
          "x": { ".validate": "newData.isNumber() && newData.val() >= -200 && newData.val() <= 1200" },
          "y": { ".validate": "newData.isNumber() && newData.val() >= -200 && newData.val() <= 1200" },
          "a": { ".validate": "newData.isNumber() && newData.val() >= -100 && newData.val() <= 100" },
          "b": { ".validate": "newData.isString() && newData.val().length <= 128" },
          "ts": { ".validate": "newData.isNumber() && newData.val() <= now + 120000 && newData.val() >= now - 120000" },
          "d": { ".validate": "newData.isBoolean()" },
          "c": { ".validate": "!newData.exists() || newData.val() === auth.uid || newData.val() === data.val()" },
          "ct": { ".validate": "newData.isNumber()" },
          "$other": { ".validate": false }
        }
      },
      "$other": { ".validate": false }
    }
  }
}
```

What each rule buys:

- **Read is authenticated but open within a room.** Room codes are the capability. Anyone who
  knows the code is in; nobody can enumerate rooms, because there is no read at the `rooms`
  level.
- **A player can only write their own presence node**, so nobody can move somebody else's
  cursor or steal their name. The single exception is deleting a node whose `t` is more than
  90 s old, which is exactly what the ghost sweep needs and nothing more.
- **Seats are first-come.** A seat can be taken when free, rewritten by its holder, or stolen
  from a uid that has no player node — which is how a seat orphaned by a crash gets reused.
  The `.validate` forbids writing anyone's uid but your own.
- **Optics are shared.** Any authenticated player in the room can write any optic — this is a
  co-op puzzle, and the conflict story is timestamps, not permissions. What the rules enforce
  is *shape*: coordinates in board range, an angle that is a real number, a timestamp within
  two minutes of the server clock, no unknown keys, and a soft lock that can only ever be set
  to your own uid. The clock bound is what stops a malicious client from writing
  `ts = Infinity` and pinning an optic forever.
- **The whole `optics` branch can be deleted** but not overwritten wholesale, which is what
  `setLevel()` and `clearOptics()` need.

Deploy:

```bash
firebase deploy --only database --project gzowos-games
```

---

## 6. Testing two clients locally

```bash
cd /Users/jurek/Downloads/Claude/Projects/refract
python3 -m http.server 8000
```

Then open **two windows, in two different browser profiles**:

```
http://localhost:8000/#TEST
```

> **The one gotcha that wastes an afternoon.** Two tabs in the *same* browser profile share
> the same anonymous Firebase uid. They will land on the same `players/<uid>` node and the
> same seat, so you will see exactly one cursor and conclude multiplayer is broken when it is
> not. Use one normal window and one **private/incognito** window, or two different browsers.
> Anonymous auth is per-profile, not per-tab.

Checklist:

1. Both windows show two named cursors in different palette colours.
2. Drag an optic in window A — window B follows it smoothly at 20 Hz, and shows it tinted in
   A's colour for as long as the drag lasts.
3. Drag the *same* optic in both windows at once. It should track one of them and settle
   immediately when one lets go. It must never oscillate or split.
4. Drag two *different* optics at once. Both should be perfectly smooth; neither should
   stutter because of the other.
5. Change level in A — B follows and both boards clear.
6. Close window B outright. Its cursor disappears from A within about a second
   (`onDisconnect`), not after a minute.
7. Kill B's network (DevTools → Network → Offline) and then close it. Its cursor disappears
   from A within 90–110 s (ghost sweep). This is the slow path and it is meant to be slow.

Failure paths, all of which must leave the solo game fully playable with exactly one
`[net]` line in the console:

8. Block `gstatic.com` in DevTools → the game boots solo.
9. Go offline before loading → the game boots solo.
10. Point `databaseURL` at a nonexistent database → the game boots solo.
11. Deploy rules without the `refract` branch → the game boots, joins, and simply sees no
    other players. It does not crash and it does not spam errors.

To watch the wire, open the RTDB console at
`https://console.firebase.google.com/project/gzowos-games/database/gzowos-games-default-rtdb/data/refract`
and expand `rooms/TEST` while dragging.

---

## 7. Integration notes

- `joinRoom` is `async` and resolves fast, but **never block first paint on it.** Boot the
  solo game, then join in the background and light up the multiplayer chrome when
  `status: 'online'` arrives.
- Call `net.leave()` on `pagehide`, not `beforeunload` — iOS Safari does not reliably fire
  `beforeunload`. `net.js` already flushes the final cursor write on `pagehide` itself.
- `setCursor` is cheap enough to call unconditionally on every `pointermove`; the throttle is
  inside `net.js` and callers must not add a second one.
- **Optic ids must be unique across clients.** `state.js` generating `o1`, `o2`… is fine in
  solo, but in a room two clients both mint `o7` and two simultaneous placements collapse
  into one optic. Use **`net.mintId()`** for every new optic — it returns `o1`, `o2`… on a
  solo handle and a uid-prefixed key such as `k3f81a-5` on a multiplayer one, so the same
  call site is correct in both modes.
- `claimOf(id)` is designed to be polled per frame from the renderer. Do not cache it.
