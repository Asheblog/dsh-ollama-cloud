# ADR 0006 — The allowance comes from `/api/balance`, not from `/api/usage`

Status: accepted (2026-10-12)

Supersedes the endpoint assumption in [ADR 0003](0003-usage-ui-in-host-slots-over-the-connection-channel.md);
its decisions about *where* the panel renders and *how* it reaches credentialed
data are unaffected.

## Context

`0.2.0` built the usage panel (ADR 0003) on `GET <native base>/usage`, whose
answer carried a `limits` object: per window, a consumed fraction (`usage`),
per-model request counts (`models`), and a reset instant. That is what the
endpoint answered at the time, and it was the shape the panel was written
against.

By 2026-10-12 the endpoint no longer answers it. Probed live against the
account:

- `GET https://ollama.com/api/usage` answers the request/token/cost time series
  Ollama now documents ([cloud usage](https://docs.ollama.com/api/cloud-usage)):
  `range` (`24h` | `7d` | `30d`), `scope`, `granularity`, `from`, `until`,
  `totals`, and `buckets`, each bucket carrying `request_count` — plus
  `usage_usd` and token counts on plans that report cost. There is no `limits`,
  no per-window allowance, and no per-model breakdown anywhere in it; upstream
  lists breakdowns by model and API key as "coming soon".
- The allowance moved to `GET https://ollama.com/api/balance`:

  ```json
  {
    "included": {
      "session": { "remaining_percent": 95.55, "resets_at": "2026-10-12T03:00:00Z" },
      "weekly": { "remaining_percent": 99.21, "resets_at": "2026-10-19T00:00:00Z" }
    },
    "purchased": { "balance_usd": 1.59332 }
  }
  ```

So the panel had been reading a contract that had stopped existing. The decoder
rejected the body it actually received — `malformed usage response (body keys:
range, scope, granularity, from, until, totals, buckets)` — which the card
rendered as *reading usage failed* and the sidebar as *quota unavailable*. The
panel was not failing to reach anything; it was failing to understand an answer
it had already received.

Nothing caught it, and the reason is structural rather than accidental: every
test in the suite pinned a mock, and the mock was written from the same
assumption as the code it fed. A decoder can be entirely green and entirely
wrong about the endpoint it reads.

## Decision

1. **The allowance is read from `/balance`.** `usage.ts` requests
   `GET <native base>/balance` and decodes
   `included.<window>.remaining_percent` (0–100, what is *left*) into the
   consumed fraction the meter draws, plus `resets_at` normalized to ISO. The
   display ids stay `monthly` / `session` / `weekly`. What the endpoint reports
   is what shows: a window the plan does not have is simply absent, and an id
   the panel has no seat for is ignored rather than drawn under a neighbouring
   window's label. The three seats are the plugin's; within them, membership is
   the endpoint's answer — a plan reporting none of the three is a diagnosable
   failure, not a blank panel, and the Consequences below say what a fourth id
   would take.
2. **`/api/usage` is deliberately not read.** It reports volume; the panel
   meters an allowance, and `/api/usage` cannot answer that question at all.
   Rejected: **reading both**, and showing request counts beside the meters —
   that is a second feature with its own design question (what does a request
   count mean to a user who never reaches a cap, at which range, next to which
   window?), not a repair of this one. Rejected: **`/api/usage` as a fallback
   for the allowance** — a fallback that cannot carry the value is a way to
   render a wrong number confidently.
3. **A reading outside 0–100 is clamped, and a missing window is not an
   error.** An overshoot (`100.4`) is an artefact of a percentage, not a
   missing window; blanking a panel over it would hide a reading that is fine.
   A window whose `remaining_percent` is not a finite number is dropped, and a
   body that yields no window at all is a failure that names the keys it saw —
   "the endpoint changed its shape" has to be diagnosable from one log line,
   which is exactly what this incident needed.
4. **The per-model breakdown is deleted, not left empty.** The retired shape
   carried `models` per window; the current contract has none. The wire window
   is now `{ usage, resetsAt? }`, and the card's usage-sources section, its two
   copy keys, its CSS, and the decoder's reader for the field are gone. Keeping
   an optional field the endpoint no longer sends would re-create precisely the
   phantom-contract class this ADR removes — the field can never be non-empty,
   so nothing user-visible changes by deleting it. When Ollama ships model
   breakdowns they come back as a designed feature, from a real answer.

   That deletion covers the reset-instant spellings the retired shape used to
   answer as well — `reset_at`, `reset`, `resetsAt`, epoch seconds and
   milliseconds, `reset_after_seconds`. The current contract answers `resets_at`
   as an ISO instant, and a window that carries no instant at all keeps its
   entry and falls back to the documented cadence, so tolerance for spellings no
   endpoint sends carried risk (a wrongly read instant is a wrong reset line)
   without carrying value.
5. **`purchased.balance_usd` is not surfaced.** It is a real fact this endpoint
   reports and this panel does not show. That is a scope decision, recorded
   here so it reads as one: a dollar balance is not a percentage of an
   allowance, and it needs its own presentation decision (formatting, currency,
   where it sits beside two percentages) rather than being smuggled into a
   repair.
6. **The live contract is checked by a script, not only by mocks.**
   `scripts/check-live-allowance.mjs` (`pnpm run check:live`) drives the real
   endpoint through the host decode, the wire projection, and the browser
   half's own decoder, and prints each window's remaining share. It needs the
   account's key and the network, so it stays out of `pnpm check`; it exists to
   be run by hand when the endpoint is suspected of moving, and it is the check
   that would have caught this. It reports the three ways it can find drift
   apart — a read that failed, an endpoint that answers no allowance at all
   (404), and a share outside 0–100 — because "the decode broke" and "the
   endpoint stopped being a cloud one" are different findings.

## Consequences

- Both surfaces meter a real remaining share again, with the endpoint's own
  reset instants next to them.
- The supported answers are unchanged where they were already right: a `404`
  still means "this endpoint does not report cloud usage" (a local or
  self-hosted server), `401`/`403` still means the credential was refused, and
  a transport failure still says so. Only the decoding of a successful read
  moved.
- The panel shows what the plan has. The account this was fixed against is on a
  legacy plan and reports the session and weekly windows with no monthly one,
  so it draws two meters; a plan that reports a monthly window gets a third
  with no code change, because the ids are the same and membership is the
  endpoint's answer.
- The panel reads three ids (`session`, `weekly`, `monthly`) because it has
  three seats, and a seat is a label plus a reset cadence plus a place in the
  display order — not just a key. A fourth kind of window would therefore need
  a client change, and until it has one a plan reporting only ids outside the
  three fails loudly with the ids it sent (`included keys: …`) rather than
  drawing an unlabeled meter. That is a known limit rather than an accident:
  rendering an unknown id under a neighbouring window's label would put a wrong
  number on screen, which is worse than a failure that names itself.
- The internal snapshot no longer carries per-model counts, and the wire window
  no longer carries `models`. A third-party reader of this plugin's channel
  that *required* that field would break loudly rather than render nothing —
  and it has been unable to render anything since the endpoint stopped sending
  it, so nothing observable is lost.
- A window the endpoint reports without a reset instant keeps the documented
  cadence as its label (session 5h, weekly 7d, monthly 30d) rather than a
  blank line.
- The mocked unit tests still pin the decoding rules; the live script pins the
  assumption the rules are written against. Two different questions, and the
  incident was the second one.
