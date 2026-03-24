# PRD Template

Use this structure when creating new PRDs. Scale the depth to the size of the feature using the tier guide below.

## Tier Guide

| Tier | When | Required Sections |
|------|------|-------------------|
| **Quick** | Bug fix, small enhancement, 1-2 day effort | Problem Statement, Scope, Requirements |
| **Standard** | Feature, multi-day effort | Sections 1-6 + 10 |
| **Deep** | New product area, multi-week, cross-team | All 11 sections |

A bug fix PRD with 11 sections is wasted effort. A new product area with only 3 sections is under-specified. Match the template to the work.

---

```markdown
---
missionId: ~
---

# Feature Name

**Author:** [name]  **Date:** [date]  **Status:** Draft

## 1. Context & Background

Why does this matter *now*? What's the history, and what changed that makes this the right time?

Connect to business goals:

- Revenue impact (new revenue, reduced churn, upsell)
- Cost reduction (support tickets, manual processes)
- Competitive pressure (market expectation, competitor feature)
- Strategic alignment (company OKRs, roadmap themes)

Include any relevant data: "We lose ~15% of trial users at the onboarding step" or "Support handles 50 tickets/week about this."

## 2. Problem Statement

What problem are we solving? Who has this problem? How do we know it's a real problem (data, user feedback, support tickets, business need)?

Keep this to 2-4 sentences. If you can't explain the problem concisely, you don't understand it well enough yet.

## 3. Target Users & Use Cases

Who are the users and what do they need? Describe them as personas, segments, or roles — then list their key use cases.

**Primary users:**
- [Persona/role] — [brief description of who they are and what they care about]

**Key use cases:**
- [User] needs to [action] so that [outcome].
- [User] needs to [action] so that [outcome].

User stories ("As a... I want... so that...") work here too. Pick whichever format captures the users and their needs most clearly.

## 4. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Reduce onboarding drop-off | Completion rate | 60% → 80% |
| Decrease support load | Tickets tagged "onboarding" | 50/week → 20/week |

Every goal must have a measurable outcome. If you can't measure it, reframe the goal until you can.

## 5. Scope

### In Scope
- Bullet list of what this PRD covers
- Be specific: "Email notifications for subscription expiry (7-day and 1-day warnings)"

### Out of Scope
- What we're explicitly *not* doing (and briefly why)
- "Native mobile push notifications (separate PRD, depends on mobile app timeline)"

Out of scope is just as important as in scope. It prevents scope creep and sets expectations.

## 6. Requirements

### Functional Requirements

Numbered requirements that describe *what* the system should do:

1. The system shall send an email notification 7 days before subscription expiry.
2. The notification shall include the user's plan name, expiry date, and a renewal link.
3. Users who have already renewed shall not receive the notification.

Use "shall" for requirements (not "should" or "could" — those are ambiguous).

### Non-Functional Requirements

Performance, security, accessibility, scalability:

1. Notification emails shall be sent within 5 minutes of the scheduled time.
2. Email content shall not include sensitive account data (payment details, passwords).
3. The notification system shall handle up to 100k emails/day without degradation.

### Edge Cases & Error States

What happens when things go wrong or inputs are unexpected?

- What if the user's email bounces?
- What if the subscription is cancelled before the notification fires?
- What if the user is on a free plan with no expiry?
- What if the user has email notifications disabled?

Enumerate these explicitly. They're where most bugs live.

## 7. Design Principles (Optional)

Guiding principles that shape the solution's design — UX, API design, developer experience, accessibility, or whatever dimension matters most for this feature.

Examples:
- "Mobile-first: design for the smallest screen, then scale up"
- "Progressive disclosure: show essentials first, details on demand"
- "Convention over configuration: sensible defaults, minimal required setup"

These are *philosophies*, not specifications. They help the team make consistent decisions when the PRD doesn't cover a specific case.

## 8. Solution Approach (Optional)

High-level strategy for how this feature will work, at a level a product manager would understand. This is about *approach*, not implementation.

Describe:
- The overall approach or pattern being used
- Key workflows or flows from the user's perspective
- How this integrates with existing capabilities

**Keep this implementation-free.** No code, no schemas, no class names, no API endpoints. If you're describing *how to build it*, move that to a technical design doc.

## 9. Technical Considerations (Optional)

Constraints, dependencies, and technical factors that affect product decisions. This is not an architecture doc — it captures the things product and engineering need to agree on.

**Constraints:**
- Platform, browser, or device support requirements
- Performance budgets or SLA requirements
- Regulatory or compliance requirements

**Dependencies:**
- Internal: other teams, services, or features that must exist first
- External: third-party APIs, vendor contracts, infrastructure
- Data: analytics events, database migrations, backfills

**Integration points:**
- Systems this feature touches or must coordinate with

## 10. Risks & Open Questions

What could go wrong? What don't we know yet?

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Email provider rate limits | Medium | Notifications delayed | Batch sends, use queue |
| Users mark emails as spam | Low | Domain reputation hit | Include easy unsubscribe |

### Open Questions
- [ ] Do we send notifications for annual plans only, or monthly too?
- [ ] What timezone do we use for "7 days before"?

Open questions from the discovery workshop that weren't fully resolved belong here.

## 11. Rollout & Measurement (Optional)

How will this be released, and how will we validate success post-launch?

**Phasing:**
- **Phase 1:** 7-day expiry email (core flow)
- **Phase 2:** 1-day expiry email + admin dashboard
- **Phase 3:** In-app notification banner

**Measurement plan:**
- What metrics will be checked and when (e.g., "Review share rate 2 weeks post-launch")
- Any A/B testing or feature flag strategy
- Rollback criteria: what signals would cause us to pull the feature

Don't commit to dates in the PRD — that happens in sprint planning. Phasing is about *order*, not calendar.
```
