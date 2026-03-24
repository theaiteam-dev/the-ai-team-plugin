# API & Database Patterns

Examples of good and bad practices for API design and database queries.

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
