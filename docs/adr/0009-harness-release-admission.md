# ADR 0009 — A harness release is admitted by proving contract identity

Status: accepted (2026-11-03).

## Context

The desktop app follows a channel, so the harness moves without this plugin
doing anything: `0.2.1-rc.4` and `0.2.1-rc.5` arrived four and ten days after
`0.5.0` shipped against `rc.3`. This package answers the move in two places —
`dsh.compatibility.dshReleases`, which records a per-release verdict, and
`engines.dsh`, which states the floor — and both are claims about a release this
build was never run on.

Two ways of answering have already failed here:

- **Admit by range.** `0.4.0`–`0.4.2` had an unbounded `engines.dsh` and admitted
  every `0.2.1` release, including the one that renamed the composition's
  startup service. A required row waited forever and the whole boot failed
  ([ADR 0008](0008-composition-patch-follows-the-startup-service.md)).
- **Admit nothing until a user reports it.** The plugin goes stale silently, and
  the first signal is somebody's broken install.

Between "the token moved" and "the contract moved" there is a third answer, and
it is the common case: on most trains nothing but `version` changes. The question
this plugin actually has to answer per release is narrow — *did anything this
build compiles against change?* — and it is decidable from the published
tarballs.

## Decision

A candidate release is admitted when `pnpm run check:contract <admitted>
<candidate>` reports **contract identity** for every `@deepseek-ai/dsh-*`
package this package declares. Contract identity means, per package:

1. the set of shipped files is identical,
2. every file other than `package.json` is byte-identical,
3. `package.json` is deep-equal once the `0.2.1-rc.N` token is normalized, and
4. the token actually differs — a package pinned at the same version on both
   sides is a finding, not a pass, because it compares nothing.

Admission then is four edits, none of them source code: move
`devDependencies` to the candidate (so `typecheck` and `test` run against the
contract the build will be installed into), add the candidate to
`dsh.compatibility.dshReleases`, retarget the release-age exemptions in
`pnpm-workspace.yaml` — they name exact versions, so they age with the pin — and
record the release in the changelog. `engines.dsh` moves only when the floor
itself moves.

When the comparator reports drift, the release is **not** a version-support
bump: the drifted files are the agenda, and the code, the bundle patch, or the
pi-ai generation may have to follow before anything is declared.

Normalizing only the train token is deliberate. Any other manifest difference
survives the comparison — a `@deepseek-ai/cordis` minor, a renamed transitive
package, a new `exports` entry — which is exactly the class of change a
surface-only diff of the modules this plugin imports cannot see.

## Consequences

- One command per release, with network and `tar`. It stays out of `pnpm check`,
  which must remain runnable offline and deterministic.
- The offline guards are unchanged and complementary: `tests/composition.test.ts`
  compares the bundle patch with the installed composition and the release matrix
  with the installed release, and `check:pi-ai` compares the two pi-ai ranges.
  Those cover what this build is pinned to; the comparator covers what it is about
  to be pinned to.
- The criterion is executable, so the next bump cannot re-derive it differently.
- Verified on both sides of the line this release was made on: `rc.3 → rc.5` and
  `rc.3 → rc.4` pass, while `0.2.0-rc.2 → 0.2.1-rc.5` fails on
  `dsh-web-app`'s `cordis.patch.yml`, its new `locale/` payload, and its peer
  table — the very move that broke `0.4.0`.

Alternatives, and why each was rejected:

1. **Admit by range alone.** What `0.4.0`–`0.4.2` did; the failure is in ADR 0008.
2. **Admit nothing until a user reports.** The channel moves without the plugin;
   silence is indistinguishable from working until a boot fails.
3. **Bump `devDependencies` and trust `pnpm test`.** The composition test guards
   one row and the matrix's internal consistency; it cannot see a narrowed type
   or a transitive move in a package this plugin has not imported yet.
4. **Keep the comparison as a one-off script under `.tmp`.** A criterion that
   lives in someone's scratch directory gets re-derived — and re-derived
   differently, which is how `rc.1` shipped as "compatible" on a patch that still
   named `webRuntime`.
5. **Run the comparator inside `pnpm check`.** It needs the registry, so the gate
   would fail offline and on a flaky mirror, and a release check is not something
   every commit should pay for.
