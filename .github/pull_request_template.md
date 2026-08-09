## What this changes

<!-- One or two sentences. If it changes what the drawing looks like, a screenshot helps. -->

## Why

<!-- Especially useful if the change is not obviously an improvement, or if you tried
     something else first and it didn't work — that's the kind of thing worth recording
     in a comment as well. -->

## Checks

- [ ] `bun run healthcheck` passes locally
- [ ] If this touches `src/lib/treb/`: the physics tests still assert the **published**
      figures and the emergent rules (100 : 1 weight ratio, 45° vacuum optimum). If a
      test needed its expected value changed to pass, say why here — that is usually a
      regression rather than a stale test.
