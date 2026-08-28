# Shared Arrays

A shared array is a shared data channel between modules: the publisher maps an array object to a name, and other modules pull the same object reference by name or pattern.

## Three-Segment Naming

Full name = public:module-name:array-name:

- First segment public: shared array marker, fixed
- Second segment: owner module name, assembled automatically by the core
- Third segment: the name the module gives the array when exposing

When exposing and unexposing, modules only provide the third segment.

## Exposing

\`\`\`js
ctx.exposeArray('marks', ['ready']);
// Full name = public:greeter:marks
\`\`\`

Rules:

- Stores the reference, not a copy; modifications are immediately visible to all holders
- The full name is globally unique; duplicate exposure reports an error
- Content must be an array

## Pulling

\`\`\`js
// Exact: full name, returns the array reference
const marks = ctx.array('public:greeter:marks');

// Exact: own array by third-segment short name (first two segments completed automatically)
const own = ctx.array('marks');

// Wildcard: returns a mapping of full array name to reference
const all = ctx.array('public:greeter:*');
\`\`\`

Pulling a nonexistent array (exact mode) throws.

## Unexposing

\`\`\`js
ctx.unexposeArray('marks');
\`\`\`

Only the owner can execute it.

## Lifecycle

- Module stop or core shutdown: all exposed arrays of the module are unregistered automatically
- Code holding an old reference can still operate on the original array object, but the array is no longer visible by name
- Arrays have no capacity limit and no persistence; content management is the module's responsibility
- Array operations are not logged
