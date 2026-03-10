# Testing Good Patterns: What to Aim For

This document catalogs patterns from high-quality test suites. These are the counterparts to the banned anti-patterns — concrete examples of tests that actually catch bugs.

---

## Pattern 1: Assert on Observable Output, Not on Calls

Test what the code returns or renders, not how it got there. The result is the contract.

```ts
// GOOD — asserts what the consumer actually receives
const result = await fetcher("/api/products")
expect(result).toEqual({ id: 1, name: "Widget", price: 9.99 })

// GOOD — asserts the rendered content the user sees
render(<ProductCard product={saleProduct} />)
expect(screen.getByText("Sale")).toBeInTheDocument()
expect(screen.getByText("$8.99")).toBeInTheDocument()
```

Reserve `toHaveBeenCalledTimes` for side-effect verification (e.g., "should NOT call the API on cache hit"). Drop `toHaveBeenCalledWith` when the mock is pre-configured to return a value regardless of arguments.

---

## Pattern 2: Assert Existence Before Use

Unconditional `expect` before interacting with a DOM element. A missing element fails clearly rather than silently routing through a fallback.

```ts
// GOOD — fails loudly when the element is absent
const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept=".csv"]')
expect(fileInput).not.toBeNull()
await user.upload(fileInput!, csvFile)

// GOOD — getBy* throws on missing element, no manual assertion needed
const submitButton = screen.getByRole("button", { name: /submit/i })
await user.click(submitButton)
```

Use `getBy*` over `queryBy*` when the element must be present. Reserve `queryBy*` for "should NOT be in the document" assertions.

---

## Pattern 3: Specific Error and State Assertions

Match the exact message or value your code produces. Broad matchers hide regressions.

```ts
// GOOD — matches the specific validation message
await user.upload(fileInput!, badFile)
expect(screen.getByText(/invalid csv format: missing required columns/i)).toBeInTheDocument()

// GOOD — asserts the specific action, not "one of these"
const rec = result.recommendations.find((r) => r.asin === "B001")
expect(rec?.action).toBe("increase_bid")
expect(rec?.suggestedBid).toBeCloseTo(1.25, 2)

// GOOD — API error contract: both status AND body
await expect(handler(badRequest)).rejects.toMatchObject({
  status: 400,
  body: { error: "INVALID_INPUT", message: "asin is required" },
})
```

---

## Pattern 4: Fixture Helpers That Reduce Noise Without Hiding Intent

Small factory functions for complex objects. Named fields make the test readable; defaults handle the irrelevant parts.

```ts
// GOOD — factory with meaningful defaults
function makeSnapshot(overrides: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot {
  return {
    asin: "B001",
    impressions: 1000,
    clicks: 50,
    spend: 25.00,
    sales: 100.00,
    date: "2024-01-15",
    ...overrides,
  }
}

// Tests read what matters; noise is hidden in the factory
it("should flag ACoS above threshold", () => {
  const snapshot = makeSnapshot({ spend: 60, sales: 100 }) // 60% ACoS
  expect(classify(snapshot).status).toBe("high_acos")
})

it("should not flag ACoS at exactly the threshold", () => {
  const snapshot = makeSnapshot({ spend: 50, sales: 100 }) // 50% ACoS — boundary
  expect(classify(snapshot).status).toBe("ok")
})
```

Keep factories in the same test file or a shared `__fixtures__` file. Don't over-engineer — a plain object literal is fine for one-off use.

---

## Pattern 5: Boundary and Edge Case Coverage

Test the values just inside and just outside limits. This is where real data bugs hide.

```ts
// GOOD — boundary values at exactly the threshold
it("should classify ACoS at exactly 50% as ok", () => {
  expect(classify(makeSnapshot({ spend: 50, sales: 100 })).status).toBe("ok")
})
it("should classify ACoS just above 50% as high", () => {
  expect(classify(makeSnapshot({ spend: 50.01, sales: 100 })).status).toBe("high_acos")
})

// GOOD — zero-value edge cases
it("should return zero conversion rate when clicks are zero", () => {
  expect(conversionRate({ clicks: 0, orders: 0 })).toBe(0)
})

// GOOD — missing/null fields in real data
it("should skip rows where required columns are absent", () => {
  const csv = "Date,Impressions\n2024-01-01,1000"  // missing Clicks, Spend, Sales
  const result = parseSearchTermReport(csv)
  expect(result.rows).toHaveLength(0)
  expect(result.skippedRows).toBe(1)
})

it("should treat non-numeric spend as invalid and skip the row", () => {
  const csv = validHeaders + "\n2024-01-01,1000,50,N/A,100.00"
  const result = parseSearchTermReport(csv)
  expect(result.rows).toHaveLength(0)
})
```

---

## Pattern 6: Negative Paths with Realistic Failure Conditions

Error tests should use failures that could actually happen in production, not `throw new Error("mock error")`.

```ts
// GOOD — realistic HTTP failure
global.fetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ error: "NOT_FOUND", message: "Product not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  })
)
await expect(fetchProduct("B999")).rejects.toMatchObject({ status: 404 })

// GOOD — realistic network failure
global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
await expect(fetchProduct("B001")).rejects.toThrow("Failed to fetch")

// GOOD — empty state is a first-class case, not an afterthought
it("should return empty array when no products match the filter", () => {
  const result = filterProducts([], { minPrice: 10 })
  expect(result).toEqual([])
})
```

---

## Pattern 7: One Behavior Per Test Block

Each `it` block asserts one thing. When a test fails, the name tells you exactly what broke.

```ts
// GOOD — separate tests, each fails independently with a clear name
it("should show upload button when no file is selected", () => {
  render(<FileUpload />)
  expect(screen.getByRole("button", { name: /choose file/i })).toBeInTheDocument()
})

it("should show filename after file is selected", async () => {
  render(<FileUpload />)
  const input = screen.getByTestId("file-input")
  await user.upload(input, new File(["content"], "report.csv", { type: "text/csv" }))
  expect(screen.getByText("report.csv")).toBeInTheDocument()
})

it("should show progress bar during upload", async () => {
  render(<FileUpload onUpload={slowUpload} />)
  await user.click(screen.getByRole("button", { name: /upload/i }))
  expect(screen.getByRole("progressbar")).toBeInTheDocument()
})
```

---

## Pattern 8: Test the Full API Contract

When testing functions that return structured responses, assert the complete contract — not just the happy-path field.

```ts
// GOOD — full response shape verified
it("should return paginated results with cursor", async () => {
  const result = await listProducts({ limit: 10 })
  expect(result.items).toHaveLength(10)
  expect(result.nextCursor).toBeDefined()
  expect(result.total).toBe(42)
})

// GOOD — error shape matches documented contract
it("should throw with status and structured body on 422", async () => {
  await expect(createOrder(invalidPayload)).rejects.toMatchObject({
    status: 422,
    body: {
      error: "VALIDATION_FAILED",
      fields: expect.arrayContaining([
        expect.objectContaining({ field: "email", message: expect.any(String) }),
      ]),
    },
  })
})
```

---

## Pattern 9: Multiple Snapshots / Repeated Operations

When a function accumulates state or processes a sequence, test across multiple iterations.

```ts
// GOOD — tests behavior across multiple snapshots, not just one
it("should track the highest spend day across multiple snapshots", () => {
  const snapshots = [
    makeSnapshot({ date: "2024-01-01", spend: 20 }),
    makeSnapshot({ date: "2024-01-02", spend: 45 }),
    makeSnapshot({ date: "2024-01-03", spend: 30 }),
  ]
  const summary = summarize(snapshots)
  expect(summary.peakSpendDate).toBe("2024-01-02")
  expect(summary.peakSpend).toBe(45)
})

// GOOD — idempotency: running twice produces same result
it("should be idempotent when synced twice", async () => {
  await syncOrder(order)
  const result = await syncOrder(order)
  expect(result.alreadySynced).toBe(true)
  expect(result.duplicateCreated).toBe(false)
})
```

---

## Self-Check: Is This a Good Test?

Before submitting, confirm each test can answer YES to all three:

1. **Does it call real application code?**
2. **Would it fail if the code had a subtle bug?** (Wrong value, wrong shape, wrong error message)
3. **Does it assert a single specific expected outcome?**

The best tests are boring: arrange, act, assert — one thing per block, specific values, no conditionals.
