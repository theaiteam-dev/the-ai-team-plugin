# Security Patterns

Examples of common security vulnerabilities and their fixes.

---

## Injection & Input Handling

### Bad
```typescript
// SQL injection
const query = `SELECT * FROM users WHERE email = '${email}'`;

// User input directly in HTML
element.innerHTML = `<h1>Welcome, ${userName}</h1>`;

// Mass assignment
app.put('/user/:id', (req, res) => {
  await db.users.update(req.params.id, req.body); // user could set isAdmin: true
});
```

### Good
```typescript
// Parameterized queries
const query = sql`SELECT * FROM users WHERE email = ${email}`;

// Escaped or safe rendering
element.textContent = `Welcome, ${userName}`;
// or in React: <h1>Welcome, {userName}</h1>  (auto-escaped)

// Explicit allowlist of updatable fields
const allowedFields = pick(req.body, ['name', 'email', 'avatarUrl']);
await db.users.update(req.params.id, allowedFields);
```

**What to flag:** Always parameterize queries. Use `textContent` over `innerHTML`. Use allowlists for mass updates — never pass raw request bodies to database operations.

---

## Secrets & Sensitive Data

### Bad
```typescript
// Secrets in code
const API_KEY = 'sk-live-abc123def456';

// Logging sensitive data
logger.info('User login', { email, password, ssn: user.ssn });
```

### Good
```typescript
// Secrets from environment
const API_KEY = process.env.PAYMENT_API_KEY;

// Structured logging with sensitive field exclusion
logger.info('User login', { userId: user.id, email: maskEmail(user.email) });
```

**What to flag:** Secrets belong in environment variables or a vault, never committed to source. Never log passwords, tokens, or PII. Check diffs for accidentally committed `.env` files, API keys, private keys, or connection strings with credentials.

---

## API Error Responses

### Bad
```typescript
app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack,           // exposes internals
    query: err.sql,             // exposes DB schema
  });
});
```

### Good
```typescript
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err, requestId: req.id });
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    requestId: req.id,
  });
});
```

**What to flag:** Never expose stack traces, SQL, or internal state in production error responses. Include a request ID for traceability without leaking implementation details.

---

## OWASP Quick Reference

When reviewing, keep these top risks in mind:

- **Injection** (SQL, NoSQL, OS command, LDAP) — parameterize everything
- **Broken authentication** — weak session management, missing rate limiting on login
- **Sensitive data exposure** — unencrypted storage, verbose error messages, logs with PII
- **Broken access control** — missing authorization checks, IDOR (direct object reference without ownership validation)
- **Security misconfiguration** — default credentials, unnecessary services exposed, permissive CORS
- **XSS** — unsanitized user content rendered as HTML
- **Insecure deserialization** — accepting untrusted serialized objects
- **Using components with known vulnerabilities** — outdated dependencies with CVEs
- **Insufficient logging** — no audit trail for security-relevant actions
