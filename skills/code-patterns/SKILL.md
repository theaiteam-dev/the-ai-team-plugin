---
name: code-patterns
description: Code quality, type safety, async, and API/database patterns for AI coding agents. Consolidated reference covering naming, function design, immutability, TypeScript type safety, async best practices, error handling, N+1 queries, pagination, and consistent API shapes — with TypeScript examples.
---

# Code Patterns Skill

Consistent application of these patterns across a codebase prevents the most common categories of bugs: unclear intent, type confusion, async misuse, and database performance problems.

---

## Naming & Readability

### Bad
```typescript
const d = new Date();
const x = users.filter(u => u.a > 5 && u.s === 'active');

function proc(d: any[]) {
  return d.map((i: any) => ({ ...i, v: i.v * 1.08 }));
}
```

### Good
```typescript
const currentDate = new Date();
const activeHighValueUsers = users.filter(
  (user) => user.accountAge > 5 && user.status === 'active'
);

function applyTaxToLineItems(lineItems: LineItem[]): LineItem[] {
  const TAX_RATE = 1.08;
  return lineItems.map((item) => ({ ...item, value: item.value * TAX_RATE }));
}
```

**What to flag:** Variable and function names should communicate intent. Avoid single-letter names outside trivial loop counters. Extract magic numbers into named constants.

---

## Function Design

### Bad
```typescript
function handleUser(user: User, action: string, sendEmail: boolean, isAdmin: boolean, retryCount: number) {
  if (action === 'create') {
    // 40 lines of creation logic
  } else if (action === 'update') {
    // 35 lines of update logic
  } else if (action === 'delete') {
    // 20 lines of deletion logic
  }
  if (sendEmail) {
    // 15 lines of email logic
  }
  // ... continues for 200+ lines
}
```

### Good
```typescript
async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.create(input);
  await eventBus.publish(new UserCreatedEvent(user));
  return user;
}

async function deleteUser(userId: string, deletedBy: AdminUser): Promise<void> {
  const user = await userRepository.findByIdOrThrow(userId);
  await userRepository.softDelete(user.id);
  await eventBus.publish(new UserDeletedEvent(user, deletedBy));
}
```

**What to flag:** Functions should do one thing. Avoid boolean flag parameters — they signal multiple behaviors. Long parameter lists suggest a missing abstraction (use an options object or split the function). If a function needs a comment explaining *what* it does, it should be renamed or refactored.

---

## Immutability & Side Effects

### Bad
```typescript
function formatUsers(users: User[]) {
  for (let i = 0; i < users.length; i++) {
    users[i].name = users[i].name.trim().toLowerCase();
    users[i].isProcessed = true;
  }
  return users; // mutated the original array
}

// Global mutable state
let currentConfig = loadConfig();
function updateSetting(key: string, value: string) {
  currentConfig[key] = value; // side effect — who else reads this?
}
```

### Good
```typescript
function formatUsers(users: ReadonlyArray<User>): FormattedUser[] {
  return users.map((user) => ({
    ...user,
    name: user.name.trim().toLowerCase(),
    isProcessed: true,
  }));
}

// Explicit state management
class ConfigStore {
  private config: Readonly<Config>;

  constructor(initial: Config) {
    this.config = Object.freeze(initial);
  }

  updateSetting(key: keyof Config, value: string): ConfigStore {
    return new ConfigStore({ ...this.config, [key]: value });
  }
}
```

**What to flag:** Avoid mutating function arguments. Return new values instead. Mark inputs as `Readonly` where possible. Global mutable state is a major source of bugs — prefer explicit state containers or dependency injection.

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

---

## N+1 Queries

### Bad
```typescript
// N+1 query problem
const orders = await db.orders.findAll();
for (const order of orders) {
  order.customer = await db.customers.findById(order.customerId); // query per row
}
```

### Good
```typescript
// Eager loading / join
const orders = await db.orders.findAll({
  include: [{ model: Customer, as: 'customer' }],
});
```

**What to flag:** Any loop that issues a query per iteration. This is the most common database performance issue. Use joins, eager loading, or batch fetches instead.

---

## Pagination & Bounded Queries

### Bad
```typescript
// Fetching everything when you need a count
const allUsers = await db.users.findAll();
const count = allUsers.length;

// No pagination
app.get('/products', async (req, res) => {
  const products = await db.products.findAll(); // 500k rows
  res.json(products);
});
```

### Good
```typescript
// Use COUNT at the database level
const count = await db.users.count({ where: { status: 'active' } });

// Cursor-based pagination
app.get('/products', async (req, res) => {
  const { cursor, limit = 50 } = req.query;
  const products = await db.products.findAll({
    where: cursor ? { id: { [Op.gt]: cursor } } : {},
    limit: Math.min(Number(limit), 100),
    order: [['id', 'ASC']],
  });
  res.json({
    data: products,
    nextCursor: products.at(-1)?.id ?? null,
  });
});
```

**What to flag:** Use `COUNT`, `EXISTS`, etc. at the DB level instead of fetching full result sets. Always paginate list endpoints. Set a max page size to prevent abuse. Unbounded queries are a ticking time bomb.

---

## Consistent API Response Shapes

### Bad
```typescript
// Inconsistent response shapes
app.get('/users/:id', (req, res) => {
  if (!user) return res.status(404).json('Not found');         // string
  return res.json(user);                                        // object
});
app.get('/users', (req, res) => {
  return res.json({ success: true, data: users, count: 10 });  // wrapped
});
```

### Good
```typescript
// Consistent envelope
interface ApiResponse<T> {
  data: T;
  meta?: { cursor?: string; total?: number };
}

interface ApiError {
  code: string;        // machine-readable: 'USER_NOT_FOUND'
  message: string;     // human-readable
  requestId: string;   // for support/debugging
}

app.get('/users/:id', (req, res) => {
  if (!user) {
    return res.status(404).json({
      code: 'USER_NOT_FOUND',
      message: `No user found with id ${req.params.id}`,
      requestId: req.id,
    });
  }
  return res.json({ data: user });
});
```

**What to flag:** API responses should have a consistent shape across all endpoints. Use machine-readable error codes alongside human-readable messages. Include a request ID for traceability. Error and success responses should both be objects, never bare strings.
