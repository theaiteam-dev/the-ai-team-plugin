# Fix: work item `outputs` fields are lost on write

## Executive Summary

Setting a work item's `outputs.test` to an empty string does not stick, and updating
any single `outputs.*` field silently destroys the sibling `outputs.*` fields that were
already stored. Both symptoms were reproduced against a scratch dev server, through the
`ateam` CLI and again through a raw HTTP request with the CLI out of the loop, which
places the defect in the API's item-write handlers rather than in the Go CLI.

The empty-string half of this blocks the `NO_TEST_NEEDED` fast-track convention
documented in `agents/hannibal.md`: that rule asks Hannibal to skip the testing stage
when an item's description contains `NO_TEST_NEEDED` and its `outputs.test` is `""`, but
no item can reach that stored state, so doc-only work items are routed to Murdock for a
test that does not apply. The sibling-wipe half is a broader data-loss problem that has
nothing to do with empty strings: it destroys real file paths on any partial outputs
update, and it was reproduced with ordinary non-empty values.

## Definition of Done

- [ ] Running `ateam items updateItem <id> --outputs.test ""` against an item whose outputs are `{"impl": "README.md"}` reads back `{"impl": "README.md", "test": ""}`: the empty `test` is stored and returned, and the pre-existing `impl` survives.
- [ ] Running `ateam items updateItem <id> --outputs.test "<some/path.test.ts>"` against an item that already has `outputs.impl` and `outputs.types` leaves both of those fields intact, so a partial outputs update merges into the stored object instead of replacing it.
- [ ] Creating an item with `ateam items createItem ... --outputs.impl "README.md" --outputs.test ""` reads back with `test: ""` present in `outputs`.
- [ ] A work item created through the CLI with `NO_TEST_NEEDED` in its description and `--outputs.test ""` satisfies both halves of the fast-track condition documented in `agents/hannibal.md`, so the documented rule is satisfiable end to end.
- [ ] A regression test covers the repro steps: the empty-string round trip and the partial-update sibling survival.

## Scope

**Evidence source:** GitHub issue #68, "ateam items updateItem: --outputs.test \"\" is
stripped (and wipes sibling outputs fields), breaking NO_TEST_NEEDED fast-track
detection". Reported from a `/ai-team:plan` run on mission M-20260911-001, where Face
could not apply Sosa's refinement instruction to flag three doc-only items.

**Surface driven:** the `ateam` CLI, and raw `curl`, both pointed at the scratch dev
server resolved from `devServer.url` in `ateam.config.json` (`http://localhost:5567`,
`managed: true`). The server was started from `devServer.start` and stopped afterward.
The standing container on port 5566 was not touched.

**Endpoint hit:** `ATEAM_API_URL=http://localhost:5567`,
`ATEAM_PROJECT_ID=pike-repro-issue-68` (a scratch project id, not the real project).

**In scope:** the API's item create and update handlers and the item response transform,
specifically how they persist and return the three `outputs` fields.

**Out of scope:** the Go CLI's flag-to-JSON marshaling. It was a candidate at dispatch and
was cleared: a raw `curl` PATCH carrying the same JSON body reproduces both symptoms with
the CLI entirely out of the request path.
