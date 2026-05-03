# Test Generation Guidelines

You are tasked with writing high-quality automated tests. Follow these principles to ensure tests are maintainable, reliable, and valuable.

## Core Principles

### Speed and Efficiency
- Tests must execute quickly to provide fast feedback
- Mock slow dependencies (databases, external APIs, file I/O) in unit tests
- Separate integration/E2E tests from fast unit tests
- Target: unit tests should complete in milliseconds, not seconds

### Test Independence
- **One test, one concern**: Each test validates a single behavior or scenario
- **No dependencies**: Tests must run in any order without relying on others
- **Self-contained**: Each test handles its own setup and teardown
- Never share mutable state between tests

### Purpose and Coverage
- Every test must validate meaningful behavior, not just increase coverage metrics
- Focus on business logic, edge cases, and error conditions
- Avoid testing framework code, libraries, or trivial getters/setters

### Reliability
- Tests must be deterministic: same input = same result, always
- Eliminate flakiness sources:
  - Use fixed timestamps instead of `Date.now()` or `new Date()`
  - Avoid `setTimeout` or race conditions
  - Don't depend on external service availability
  - Mock randomness with seeded generators

### Strong Assertions
- Assert all relevant outputs and side effects, not just one field
- Verify error messages, status codes, and state changes
- Use specific matchers (`toEqual`, `toContain`) over generic ones
- Example: if a function returns `{ data, metadata }`, assert both

### Mutation Testing Mindset
- Tests should fail when behavior changes
- Mentally verify: "If I broke this code, would this test catch it?"
- Avoid tautological tests that merely repeat the implementation

### Clear Failure Messages
- Test names should describe what's being tested: `calculatesTaxForInternationalOrders()`
- Failure output should immediately reveal what broke
- Use descriptive variable names in test data
- Avoid magic numbers: `const STANDARD_TAX_RATE = 0.21` over `0.21`

## Code Quality Standards

### Readability
Use the AAA pattern (Arrange-Act-Assert):
```
// Arrange: set up test data and dependencies
const order = createOrder({ total: 100, country: 'US' });

// Act: execute the behavior under test
const result = calculateShipping(order);

// Assert: verify expected outcomes
expect(result.cost).toBe(15);
expect(result.carrier).toBe('USPS');
```

### Test Data Builders
For complex objects, when available, use builder patterns:
```
const user = new UserBuilder()
  .withEmail('test@example.com')
  .withRole('admin')
  .build();
```
This beats inline object literals for clarity and reusability.
If a builder is not available, and you'd really want to use one, 
tell me before you go off to implement it.

### Naming Conventions
- Test names: `methodName_scenario_expectedBehavior` or natural language descriptions
- Good: `validateEmail_invalidFormat_throwsValidationError()`
- Good: `returns 404 when resource not found`
- Avoid: `test1()`, `testUser()`, `shouldWork()`

### Maintainability
- Extract common setup into helper functions or `beforeEach` hooks
- Keep test files focused: one class/module per test file
- Refactor duplication, but preserve test independence
- Use constants for repeated test values

## Anti-Patterns to Avoid

### Excessive Duplication
Don't copy-paste setup code across tests. Extract shared logic:
```
// Bad: repeated in every test
const user = { id: 1, name: 'Alice', email: 'alice@test.com' };

// Good: shared helper
function createTestUser(overrides = {}) {
  return { id: 1, name: 'Alice', email: 'alice@test.com', ...overrides };
}
```

### Unclear Assertions
```
// Bad: what is 'v'? What does 42 represent?
expect(v).toBe(42);

// Good: explicit meaning
const expectedDiscountAmount = 42;
expect(invoice.discount).toBe(expectedDiscountAmount);
```

### Mystery Guests
All dependencies should be visible in the test:
```
// Bad: where does 'testData.json' come from?
const data = loadTestData();

// Good: explicit file reference
const data = JSON.parse(fs.readFileSync('./fixtures/valid-order.json'));
```

### General Fixtures
Avoid one giant fixture object used by many tests:
```
// Bad: COMMON_USER used everywhere, unclear which properties matter
test('sends welcome email', () => {
  sendEmail(COMMON_USER); // what about COMMON_USER is relevant here?
});

// Good: explicit, minimal test data
test('sends welcome email', () => {
  const newUser = { email: 'new@example.com', name: 'Alice' };
  sendEmail(newUser);
});
```

### Brittle Assertions
Don't couple tests to implementation details:
```
// Bad: breaks if we change formatting
expect(message).toBe('Hello, Alice! Your balance is $100.00.');

// Good: verify intent, not format
expect(message).toContain('Alice');
expect(message).toContain('100');
```

## Test Organization

### Structure
- Group related tests using `describe` blocks
- Use `beforeEach` for common setup (but keep tests self-contained)
- Use `afterEach` for cleanup if needed
- Separate unit, integration, and E2E tests into different directories

### Coverage Priorities
1. Critical business logic and calculations
2. Error handling and edge cases
3. Boundary conditions (empty arrays, null values, max limits)
4. Integration points between modules
5. User-facing workflows (E2E)

### Mocking Strategy
- **Unit tests**: Mock all external dependencies
- **Integration tests**: Mock only external services, use real database/framework
- **E2E tests**: Minimize mocking; test against real or realistic environments
- Always mock: time, randomness, external APIs, slow operations

## Output Format

When generating tests, provide:
1. Imports and setup
2. Describe block with clear test suite name
3. Individual test cases following AAA pattern
4. Necessary mocks, stubs, or test helpers
5. Brief comments for non-obvious test logic only

Write production-quality code. Tests are first-class citizens that deserve the same care as application code.