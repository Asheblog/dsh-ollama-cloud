# ADR 0007 — A transient read failure earns one retry, and a failed panel retries sooner

Status: accepted (2026-10-14)

Extends [ADR 0006](0006-allowance-from-balance.md), which settled *which*
endpoint the panel reads; this one settles what the panel does when the answer
does not arrive.

## Context

The panel's read travels through whatever sits between the host and
`ollama.com`. In this deployment that is a local proxy, and it intermittently
answers a single `502 Bad Gateway` — observed live as the same request answering
`502` and then `200` on a reconnected tunnel — or resets a connection outright
(`fetch failed`). Both were reproduced from the host's own process and from a
shell minutes apart.

What the plugin did with that was the problem:

- One transient failure became `OLLAMA_USAGE_FAILED`, which the card renders as
  「读取用量失败。」 and the sidebar as 「额度不可用」, and the row kept that answer
  until its next poll (15 minutes) or a manual refresh.
- Two incidents (2026-10-12 11:25 and 2026-10-14 15:50) had the panel failing at
  boot while a read issued a minute later answered with real numbers. Boot is
  also when the plugin's catalog refresh fires roughly nineteen requests at the
  same endpoint through the same proxy — the moment a proxy is most likely to
  answer 502.
- The read itself was verified healthy at each of those moments: six consecutive
  reads through the host's own channel, five minutes after the second incident,
  all answered `ok` with the account's real windows.

The alternative — "treat every failure as final, the user can click refresh" —
leaves a wrong number on screen for a quarter of an hour and makes a healthy
endpoint look broken. For a panel whose entire content is one number, that is
the failure mode worth engineering against.

## Decision

1. **One retry, only for transient failures.** `readUsage` makes a second
   attempt when the first failed *transiently*: a transport failure before any
   response, a `429`, or any `5xx` from the endpoint or from anything in front
   of it. `UsageError.retryable` carries that judgement, so the policy is
   visible on the error itself and testable; the single attempt never retries
   on its own.

   Rejected: **retrying the attempt timeout.** It already spent the whole
   budget, so a retry doubles the time the user watches a spinner with no
   evidence the answer would differ — the next poll is the cheaper place to try
   again. Rejected: **retrying everything.** A refused credential and a body
   this build cannot decode fail identically on a second attempt; retrying them
   only delays the diagnostic the user needs.
2. **A failed row polls sooner than its cadence.** The sidebar's interval is
   `RETRY_MS` (60 s) while the last read failed and goes back to `POLL_MS`
   (15 min) as soon as a read lands. The retry above covers a single blip; this
   covers a blip that outlives the retry's delay. 60 s is also the rate the
   endpoint's own documentation recommends, so a failed row cannot turn the
   panel into a rate-limit problem for itself.
3. **A failure carries its own diagnosis.** The failure line and the empty panel
   carry a `title` of `code: host message` — for example
   `OLLAMA_USAGE_FAILED: https://ollama.com/api/balance answered 502`. The
   visible copy stays localized and actionable (ADR 0003's rule); the title
   exists because a screenshot of a failure is how most of them arrive, and
   "reading usage failed" alone does not say whether the endpoint answered 502,
   the credential was refused, or the reply could not be decoded. It carries no
   secret: the host's messages name a URL and a status.

## Consequences

- A panel that meets one bad moment shows numbers instead of "unavailable", and
  a panel whose upstream is unwell for longer heals within a minute of it
  recovering rather than within a quarter of an hour.
- The retry costs a second request only for reads that already failed; the happy
  path is still exactly one request per read, and the failed-row cadence stays at
  the endpoint's documented recommendation.
- A failure that persists still reports itself, and now names the layer that
  failed on hover, which is the difference between "the panel is broken" and
  "the thing in front of the endpoint answered 502".
- The timeout path is deliberately unchanged: still one attempt, still reported
  as a timeout.
