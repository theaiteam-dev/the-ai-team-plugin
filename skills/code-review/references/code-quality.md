# Code Quality Patterns

Examples of good and bad practices for naming, function design, and immutability.

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

**What to flag:** Variable and function names should communicate intent. Avoid single-letter names outside of trivial loop counters. Extract magic numbers into named constants.

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
function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.create(input);
  await eventBus.publish(new UserCreatedEvent(user));
  return user;
}

function deleteUser(userId: string, deletedBy: AdminUser): Promise<void> {
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
