# PRD Best Practices

Good and bad patterns to follow when writing Product Requirements Documents.

---

## 1. Problem Statement

### Bad
```
We need to add social sharing buttons to product pages.
```
No "why." No user. No evidence. This is a solution disguised as a problem.

### Good
```
Users who discover our products through social media have a 3x higher conversion rate,
but we currently have no way for existing customers to share products. Customer interviews
(n=12) show that 8 out of 12 would share products if it were easy. Our competitors
(X, Y, Z) all have one-click sharing on product pages.
```
Grounded in data. Names the user. Explains why it matters.

### What to watch for
- "We need to build X" is not a problem statement — it's a solution. Rewrite as "Users can't do Y, which causes Z."
- If the problem statement doesn't mention a user or a business impact, push back.
- Anecdotal evidence ("I think users want...") should be backed by data or at least flagged as an assumption.

---

## 2. Context & Background

### Bad
```
This feature was requested by the CEO.
```
HiPPO (highest-paid person's opinion) is not business context. It might be the *reason* it's prioritized, but the PRD needs to justify it independently.

### Good
```
Social sharing directly supports Q1 OKR: "Increase organic acquisition by 20%."
Current organic traffic is 30% of total — we need it at 36% to hit the target.
Paid acquisition costs have risen 40% YoY, making organic channels critical.

Why now: Our main competitor launched social sharing last quarter and is gaining
ground in organic search. Our SEO team reports a 12% drop in organic share of
voice since their launch.
```
Tied to measurable business goals. Explains the "why now" — what changed that makes this urgent.

### What to watch for
- No business context at all — the most common PRD failure
- Circular reasoning: "We need this because we decided to build it"
- Missing "why now": if it's been a problem for years, what changed?
- Missing opportunity cost: what are we *not* building to do this?

---

## 3. Success Metrics

### Bad
```
Goals:
- Improve social sharing
- Make users happy
- Increase engagement
```
None of these are measurable. You can't tell if you succeeded.

### Good
```
| Goal                    | Metric                          | Current | Target  |
|-------------------------|---------------------------------|---------|---------|
| Drive organic traffic   | Social referral sessions/month  | 200     | 2,000   |
| Enable sharing          | Share button click rate          | N/A     | 5%      |
| Convert social traffic  | Conversion rate from social     | 3.2%    | 3.2%+   |

Note: We want to maintain conversion rate while increasing volume.
The target is NOT to improve conversion — it's to not degrade it.
```
Specific, measurable, time-bound. Acknowledges what should *not* change.

### What to watch for
- Vanity metrics: "increase page views" (views of what? by whom? so what?)
- Missing baseline: you can't set a target without knowing where you are
- No negative metrics: what should NOT get worse? (e.g., page load time, conversion rate)

---

## 4. Scope

### Bad
```
Scope: Social sharing feature for the website.
```
Too vague. No boundaries. Invites scope creep.

### Good
```
In Scope:
- Share buttons on product detail pages (Facebook, X, copy link)
- Open Graph meta tags for rich previews
- Analytics tracking for share events

Out of Scope:
- Share buttons on collection/category pages (Phase 2 if metrics justify)
- Pinterest integration (requires image optimization work, separate effort)
- Native mobile share sheet (depends on mobile app timeline)
- Social login / "sign in with Facebook" (different feature area entirely)
- User-generated content or reviews sharing
```
Explicit. Each out-of-scope item explains *why* it's excluded.

### What to watch for
- No "out of scope" section — this is a red flag
- Out of scope that's actually in scope ("we won't do X... unless we have time")
- Scope that grows between drafts without re-evaluation of timeline/effort

---

## 5. Requirements

### Bad
```
Requirements:
- Add sharing functionality
- Make it look good
- It should be fast
- Support all social networks
```
Vague, subjective, unbounded. "Make it look good" is not a requirement.

### Good
```
Functional Requirements:
1. Product pages shall display share buttons for Facebook, X (Twitter), and copy-to-clipboard.
2. Clicking a share button shall open the platform's native share dialog pre-populated with
   the product name, image, and URL.
3. The copy-to-clipboard button shall show a "Copied!" confirmation for 2 seconds.
4. Share events shall fire an analytics event with: product_id, platform, page_url.

Non-Functional Requirements:
1. Share buttons shall load asynchronously and not block page render (no CLS impact).
2. Share buttons shall be accessible (WCAG 2.1 AA): keyboard navigable, screen reader labels.
3. Open Graph tags shall be present and valid (testable via Facebook Sharing Debugger).
```
Specific, testable, uses "shall." Each requirement has a clear pass/fail.

### What to watch for
- "Should" or "could" instead of "shall" — ambiguity about whether it's required
- Requirements that describe implementation ("use React portal for modal") instead of behavior
- Missing non-functional requirements (performance, accessibility, security are often forgotten)
- Requirements that can't be tested: if you can't write an acceptance test for it, rewrite it

---

## 6. Edge Cases

### Bad
```
Edge cases: N/A
```
There are always edge cases. "N/A" means the author didn't think about them.

### Good
```
Edge Cases:
- Product with no image: Share preview uses a default brand image + product name.
- Product that's out of stock: Share button still works (drives demand signal),
  landing page shows "out of stock" with notify-me option.
- URL with special characters: Product URLs are already URL-encoded; share URLs
  must preserve encoding.
- User on browser that blocks popups: Copy-to-clipboard still works as fallback.
  Facebook/X buttons open in same tab if popup is blocked.
- Product in draft/unpublished state: Share buttons hidden (no sharing of non-public pages).
```

### What to watch for
- Empty or absent edge cases section
- Only happy-path thinking
- No error states: what happens when the share API fails? When the user is offline?

---

## 7. Design Principles

### Bad
```
Design Principles:
- Use a modal dialog for the share interface
- Put the buttons in the top-right corner
- Use blue for the Facebook button and black for the X button
```
These are implementation decisions, not principles. They prescribe specific UI elements rather than guiding philosophy.

### Good
```
Design Principles:
- Progressive disclosure: Show the share button prominently; reveal platform options on interaction.
- Zero-friction sharing: The shortest path from "I want to share" to "shared" should be 2 taps max.
- Platform-native behavior: Use each platform's native share mechanism rather than custom implementations.
- Graceful degradation: If a sharing method isn't available (e.g., popups blocked), fall back silently to the next best option.
```
These are *philosophies* that guide many design decisions. They help the team make consistent choices without the PRD covering every scenario.

### What to watch for
- Principles that are actually implementation decisions (colors, positions, specific UI elements)
- Principles so vague they're useless ("make it user-friendly")
- Too many principles — 3-5 is usually right

---

## 8. Solution Approach

### Bad
```
Solution Approach:
We'll create a ShareButton React component that renders inside a Portal.
It will use the navigator.share() Web API with a fallback to custom share
dialogs. Share counts will be cached in Redis with a 5-minute TTL.
The component will be lazy-loaded using React.lazy() to avoid impacting
bundle size.
```
This is implementation detail — specific technologies, APIs, caching strategies, and code patterns. It belongs in a technical design doc, not a PRD.

### Good
```
Solution Approach:
Share buttons will be added to product detail pages, positioned near the
product title for high visibility. When a user clicks share, they'll be
presented with platform-specific sharing options (Facebook, X, copy link).

The sharing flow will leverage each platform's native sharing mechanism
to pre-populate the product name, image, and link — minimizing effort for
the user.

Share activity will be tracked to measure adoption and inform future
social features (e.g., "trending products" based on share volume).
```
Strategy-level: describes *what happens* and *why*, not *how it's built*. A product manager can read this and understand the approach without knowing React or Redis.

### What to watch for
- Technology names, library references, or code patterns — move these to a tech design doc
- Database schemas, API contracts, or caching strategies — too detailed for a PRD
- Confusing *approach* with *architecture* — the PRD should describe the user-facing strategy

---

## 9. Technical Considerations

### Bad
```
Technical Considerations:
We'll use a microservice architecture with an event-driven share
notification pipeline. The ShareService will expose a gRPC endpoint
for internal consumers and a REST API for the frontend. We'll need
a new PostgreSQL table: shares(id, product_id, platform, created_at).
```
This is architecture, not considerations. It makes engineering decisions that should be made during implementation.

### Good
```
Technical Considerations:

Constraints:
- Must work on all supported browsers (Chrome, Firefox, Safari, Edge — last 2 versions)
- Page load impact budget: < 50ms additional load time, zero CLS
- Must comply with GDPR — no tracking without cookie consent

Dependencies:
- Open Graph meta tags require server-side rendering changes (coordinate with Platform team)
- Analytics tracking depends on the event pipeline shipping in Q1 (currently on track)

Integration points:
- Product catalog service (for product metadata in share previews)
- Analytics pipeline (for share event tracking)
```
Captures constraints and dependencies that affect product decisions without prescribing architecture.

### What to watch for
- Architecture decisions disguised as "considerations" — if it names a specific technology choice, it's probably too detailed
- Missing constraints that will surprise the team later (browser support, performance budgets, compliance)
- Dependencies listed without owners or status — who's responsible, and is it on track?

---

## 10. Common PRD Anti-Patterns

**Solution-first PRDs:** Start with "Build X" instead of "Users have problem Y." Flip it. The solution should emerge from the requirements, not precede them.

**Implementation details in requirements:** "Use Redis for caching the share counts" is an engineering decision, not a product requirement. Write "Share counts shall update within 5 minutes of the share event" and let engineering decide how.

**PRD as spec:** A PRD is not a technical specification. It defines *what* and *why*, not *how*. If you're describing database schemas or API endpoints, you've gone too far.

**Kitchen-sink PRDs:** Trying to solve everything in one document. If the PRD has 50+ requirements, it should probably be split into phases or separate PRDs.

**Over-templating:** A bug fix PRD with 11 sections is wasted effort. Match the template depth to the feature's complexity. A Quick-tier PRD (Problem, Scope, Requirements) is perfectly valid for small changes. Don't let process overhead kill velocity.

**Write-once PRDs:** A PRD is a living document. It should be updated as assumptions are validated or invalidated. Mark sections as "Updated [date]: [reason]" so readers know what changed.

**No stakeholder input:** PRDs written in isolation miss critical context. Talk to support (what do users complain about?), sales (what do prospects ask for?), and engineering (what's feasible?) before writing.

---

## 11. Quality Checklist

Before finalizing a PRD, verify:

- [ ] Problem statement names a user and a measurable impact
- [ ] Context & Background ties to a business goal and explains "why now"
- [ ] Every success metric has a current baseline and a target
- [ ] Target users and use cases are clearly identified
- [ ] Scope has both "in" and "out" sections
- [ ] Every functional requirement is testable (you could write a test for it)
- [ ] Non-functional requirements are specified (performance, security, accessibility)
- [ ] Edge cases and error states are enumerated under Requirements
- [ ] Design principles (if included) are philosophies, not implementation decisions
- [ ] Solution approach (if included) stays at strategy level — no code or architecture
- [ ] Technical constraints and dependencies are captured with owners/status
- [ ] Risks are assessed with likelihood, impact, and mitigation
- [ ] Open questions are captured (not swept under the rug)
- [ ] No implementation details leaked into requirements
- [ ] Template depth matches the feature's complexity (not over- or under-templated)
- [ ] The document is understandable by someone who wasn't in the room when it was discussed
