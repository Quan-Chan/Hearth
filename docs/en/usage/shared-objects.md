# Shared Objects

A shared object is a shared data channel between modules: the publisher maps an object to a name, and other modules pull the same object reference by name or pattern.

## Three-Segment Naming

Full name = public:module-name:object-name:

- First segment public: shared object marker, fixed
- Second segment: owner module name, assembled automatically by the core
- Third segment: the name the module gives the object when exposing

When exposing and unexposing, modules only provide the third segment. The object name (third segment) must not contain ":" (colon is the name separator).

## Exposing

```js
ctx.exposeObject('marks', { items: ['ready'] });
// Full name = public:greeter:marks
```

Rules:

- Stores the reference, not a copy; modifications are immediately visible to all holders
- The full name is globally unique; duplicate exposure reports an error
- The value must be a non-null object; an array, a nested object, or a counter inside the object all work

## Pulling

```js
// Exact: full name, returns the object reference
const marks = ctx.object('public:greeter:marks');

// Exact: own object by third-segment short name (first two segments completed automatically)
const own = ctx.object('marks');

// Wildcard: returns a mapping of full object name to reference (keys in natural sort order, same rule as module load order)
const all = ctx.object('public:greeter:*');
```

Pulling a nonexistent object (exact mode) throws.

## Unexposing

```js
ctx.unexposeObject('marks');
```

Only the owner can execute it.

## Lifecycle

- Module stop or core shutdown: all exposed objects of the module are unregistered automatically
- Code holding an old reference can still operate on the original object, but it is no longer visible by name
- Objects have no capacity limit and no persistence; content management is the module's responsibility
- Object operations are not logged
- New exposures are rejected during core shutdown: exposeObject throws Hearth is stopping, cannot expose shared object
- Exposing from stop() throws during core shutdown and the cleanup statements after it do not run: a module that keeps a final snapshot exposes it in start() or while running
