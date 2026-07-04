# Type Safety & Async Patterns

Examples of good and bad practices for TypeScript type safety and asynchronous code.

---

## Type Safety

### Bad
```typescript
function processOrder(order: any) {
  const total = order.items.reduce((sum: any, item: any) => sum + item.price * item.qty, 0);
  return { ...order, total, status: 'processed' };
}

// Stringly-typed state machines
let status = 'pending';
if (status === 'pnding') { /* typo — no compiler help */ }

// Type assertions to paper over problems
const user = apiResponse as User;
```

### Good
```typescript
interface OrderItem {
  productId: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
}

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

function calculateOrderTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// Parse, don't validate
const user = UserSchema.parse(apiResponse); // throws if invalid
```

**What to flag:** `any` disables the type system — flag it in reviews. Use union types and enums for finite states. Prefer parsing/validation (e.g., Zod) over type assertions. Type assertions (`as`) should be rare and justified with a comment.

---

## Async Patterns

### Bad
```typescript
// Sequential when it could be parallel
async function loadDashboard(userId: string) {
  const user = await getUser(userId);
  const orders = await getOrders(userId);
  const notifications = await getNotifications(userId);
  return { user, orders, notifications };
}

// Unhandled promise
function cleanup() {
  deleteTemporaryFiles(); // returns a promise — never awaited
}

// async/await inside .forEach (doesn't work as expected)
userIds.forEach(async (id) => {
  await processUser(id);
});
```

### Good
```typescript
// Parallel independent requests
async function loadDashboard(userId: string) {
  const [user, orders, notifications] = await Promise.all([
    getUser(userId),
    getOrders(userId),
    getNotifications(userId),
  ]);
  return { user, orders, notifications };
}

// Explicit fire-and-forget with error handling
function cleanup() {
  deleteTemporaryFiles().catch((err) =>
    logger.error('Temp file cleanup failed', { error: err })
  );
}

// Sequential async iteration
for (const id of userIds) {
  await processUser(id);
}
// Or controlled concurrency
await pMap(userIds, processUser, { concurrency: 5 });
```

**What to flag:** Look for sequential `await` calls that could be parallelized with `Promise.all`. Flag unhandled promises. `forEach` with `async` callbacks is almost always a bug. Consider concurrency limits for large batch operations.

---

## Error Handling

### Bad
```typescript
async function getUser(id: string) {
  try {
    const res = await fetch(`/api/users/${id}`);
    return res.json();
  } catch (e) {
    console.log(e);
    return null;
  }
}

// Swallowing errors silently
try {
  await processPayment(order);
} catch (e) {
  // TODO: handle later
}
```

### Good
```typescript
async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);

  if (!res.ok) {
    throw new UserFetchError(
      `Failed to fetch user ${id}: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  return UserSchema.parse(data); // validate shape at boundary
}

// Errors are handled with context and intent
try {
  await processPayment(order);
} catch (error) {
  logger.error('Payment processing failed', { orderId: order.id, error });
  await notifyPaymentFailure(order);
  throw new PaymentError('Payment could not be processed', { cause: error });
}
```

**What to flag:** Never swallow errors silently. Log with context (IDs, state). Validate data at trust boundaries. Re-throw or wrap errors to preserve the chain. Distinguish between recoverable and fatal errors.
