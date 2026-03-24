# User Feedback: Dominic (First External User) — 2026-03-21

Dominic cloned the repo locally and ran his first mission (implementing Google Analytics 4 tracking for a mobile app). He used Claude Code via the VS Code chat interface. Notes and suggested improvements from the conversation follow.

---

## 1. Easier Kanban Board Setup

**What he said:** Couldn't figure out how to get the kanban board running. Had to ask a separate agent to spin it up.

**Context:** He cloned the repo locally with no documentation guiding him to start the Docker containers. The kanban viewer is a Next.js app with SQLite and requires the API to be running for agent work to persist.

**Relevant work:**
- You were already planning to build a prod Docker image, push it to GHCR, and provide a docker-compose users can pull down.
- See: `packages/kanban-viewer/`
- Related PR: `feat: publish kanban-viewer to GHCR on release` (7511b27)

**Action items:**
- [ ] Publish docker-compose to repo so users can `docker compose up` with one command
- [ ] Add setup instructions to README / PLUGIN-DEV.md

---

## 2. Make WI-XXX Commit References Linkable in Kanban

**What he said:** "It likes to push WI-002 type wording into commits, might as well make them linkable" — referring to the kanban viewer.

**Context:** Tawnia and agents embed work item IDs (e.g., `WI-002`) in commit messages. These could link directly to the kanban card for that item, giving traceability from git history → kanban.

**Action items:**
- [ ] In the kanban viewer, detect WI-XXX patterns in commit messages (e.g., in activity feed or a commits view) and hyperlink them to the item detail page
- [ ] Consider whether the item detail page should show related commits (requires git integration or hook event correlation)

---

## 3. Dependency Indicator Clarity in Kanban

**What he said:** "What are all these briefings that seem to be just sitting there" — confused why items weren't moving.

**Context:** Items in `briefings` with unmet dependencies show a link icon, but Dominic didn't know what it meant. Once explained (deps must reach `done` first), he understood immediately.

**Action items:**
- [ ] Add a tooltip or legend explaining the dependency link icon
- [ ] Consider showing the blocking item ID(s) on hover or in the card detail
- [ ] Maybe show a "Waiting on: WI-001, WI-002" label on the card

---

## 4. Better Final Mission Summary (Accumulate Warnings/Notes)

**What he said:** "Do I get a summary to even know that happened?" — when Lynch noted a minor issue (missing idempotency guard) but approved the item anyway.

**Context:** Minor issues flagged during review but not causing rejection currently get lost. The final summary from Lynch-Final says "all good" but doesn't surface accumulated minor concerns.

**Action items:**
- [ ] Lynch and Amy should log warnings/minor findings to the activity feed with a distinct level (e.g., `warn`)
- [ ] Lynch-Final or Tawnia should pull all `warn`-level activity entries and include them in the final mission report
- [ ] Output could be a `docs/mission-notes.md` or appended to CHANGELOG — "Minor issues noted but approved: ..."

---

## 5. Prod Readiness / Deploy Steps Summary

**What he said:** A separate agent session gave him: "These 3 things need to be done and to make it prod ready you need to get these variables set." He wanted that baked into the mission output.

**Context:** After a mission completes, there's no structured output telling the user what env vars to configure, what manual steps remain, or what's not production-ready yet.

**Action items:**
- [ ] Add a prod-readiness section to the final mission output (Tawnia or Lynch-Final)
- [ ] Should include: required env vars, missing config, manual steps, known gaps
- [ ] Could be a `docs/deploy-checklist.md` generated at mission end

---

## 6. Auto-Create Git Branch at Mission Start

**What he said:** (Implicit — came up in conversation.) You noted: "I usually have it start a branch for code first. Maybe I should bake that in for the mission."

**Context:** Currently the mission doesn't enforce branch creation. Agents commit directly to whatever branch is active. This risks polluting main with in-progress work and makes PR creation ambiguous.

**Action items:**
- [ ] Hannibal (or mission init) should create a branch named after the mission ID at the start of `/ai-team:run` (e.g., `mission/M-20260321-001`)
- [ ] Tawnia should create the PR from that branch at the end
- [ ] This also makes it easier to diff the mission's full output for Lynch-Final's review

---

## 7. PRD Management (Draft / Completed Folders)

**What he said:** Not stated explicitly, but came up — you mentioned needing "a draft and completed folder for them" and that the writer numbers PRDs but sometimes you jump around.

**Context:** PRDs currently live flat in a folder. No distinction between in-progress, planned, or completed. Makes it hard to know what's been run vs what's pending.

**Action items:**
- [ ] Establish a convention: `prds/drafts/`, `prds/ready/`, `prds/done/`
- [ ] Or use a status field in the PRD frontmatter that Face/Hannibal can read
- [ ] `/ai-team:plan` could move the PRD to `ready/` after planning
- [ ] `/ai-team:run` could move to `done/` after mission archives

---

## 8. More Workflow Control / Management

**What he said:** "I generally like this so far just would want a bit more workflow control/mgmt."

**Context:** Vague but likely covers: ability to pause/resume a mission, skip or re-run a specific item, manually approve/reject from the kanban UI rather than via Claude, and visibility into what's happening.

**Action items:**
- [ ] Kanban UI: manual stage move (drag-and-drop or buttons) for human override
- [ ] Kanban UI: "pause mission" / "resume mission" controls
- [ ] Consider a `/ai-team:retry <WI-XXX>` command to re-run a single item
- [ ] Consider a `/ai-team:status` command to print current board state to terminal

---

## 9. Pipeline Speed / Cycling on Bugs

**What he said:** "It actually just takes too long and might be kill cause its trying to finish up but seems to circling finding and fixing bugs. I don't seem to have this much cycling when I just have opus 4.6 build off of a well formed PRD."

**Context:** The Amy → rejection → rework loop can cause items to cycle multiple times. The tradeoff is quality vs speed. He questioned whether the pipeline adds enough value over a single well-prompted opus run.

**Notes:**
- This is a legitimate concern. The pipeline's value proposition is test coverage + structured review, not raw speed.
- The `rejection_count` max of 2 before `blocked` is a safeguard, but cycling is still expensive.
- A well-formed PRD reduces cycling significantly (Face/Sosa's planning phase is supposed to front-load this).

**Action items:**
- [ ] Instrument mission token cost and wall-clock time in the final summary so users can see the tradeoff
- [ ] Consider a "fast mode" flag that skips Amy's probing for lower-stakes missions
- [ ] Improve Sosa's review criteria to catch ambiguous items earlier (reducing downstream rework)

---

## 10. Cloud-Hosted Kanban as a Service

**What he said:** "Yeah I mean if this could run in a 3rd party cloud I would definitely see people paying for this."

**Context:** Currently users self-host the kanban viewer + API. A hosted version would remove setup friction entirely — just set `ATEAM_API_URL` and go.

**Notes:** You want the base plugin to remain OSS. A hosted backend could be a separate paid offering.

**Action items (future):**
- [ ] Evaluate hosting the API + kanban viewer on a managed platform (Railway, Fly, etc.)
- [ ] Add auth layer (projects are already isolated by `ATEAM_PROJECT_ID`)
- [ ] Update `ateam` CLI to support `ATEAM_API_URL` pointing to hosted service (already supported?)

---

## 11. PRD Creation Workflow Baked In

**What he said:** "Also PRD creation workflow so I have built my own PRD creation app which is what I fed in here." His system: web kanban → Claude API → PRDs stored in GitHub repo → downloaded locally for agents.

**Context:** You have a `write-prd` skill already. He has a multi-stage PRD creation workflow with human review gates. Combining them would make planning-to-code fully integrated.

**Action items:**
- [ ] Explore integrating a PRD drafting agent into the plugin (before `/ai-team:plan`)
- [ ] Could be `/ai-team:draft` — takes a feature idea, produces a structured PRD
- [ ] Review Dominic's agent files (he sent Archive.zip with his agent MDs) for inspiration

---

## Meta Notes

- **Dominic's setup:** VS Code Claude Code chat interface (not terminal). Worth testing plugin behavior in this context — some UX may differ.
- **Dominic's PRD source:** He built a separate web app using the Claude API with a multi-stage PRD creation workflow (idea → drafting → tech_plan_qa → tech_plan_impl → review → ready → done).
- **His conclusion:** Liked the overall system, thought it needed a cleaner final wrap-up step and better observability into what decisions were made during the mission.
