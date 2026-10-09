# Shared Objects

## Registry

ObjectRegistry is a Map from full name to public item:

```ts
interface PublicObject {
  name: string;    // 完整名 public:模块名:对象名
  owner: string;   // 拥有者模块名
  value: object;   // 被映射的对象（存引用不拷贝）
}
```

## Three-segment assembly

Full name = public:module-name:object-name. Callers provide the third segment and the owner when calling expose and unexpose; the registry assembles the full name. The same third segment from different owners does not conflict.

## Matching pull

get(pattern) has two forms:

- Pattern without wildcards: returns the object reference by full name exactly, throws if absent
- Pattern with wildcards: iterates full names to match (reuses the event matching rules), returns a { full-name: reference } mapping

The module context's object(pattern) additionally supports short names: a pattern without wildcards and not starting with public: is auto-completed with the first two segments using the module's own name (pull one's own object).

## Lifecycle

- When a module stops or the core shuts down, removeOwner batch-unregisters all mappings of that owner and returns the list of removed names
- After unregistration it is invisible by name; code holding the old reference can still operate on the original object
- Objects have no capacity limit and no persistence
- Object operations are not logged
