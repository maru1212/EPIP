/**
 * Small helper for building a parameterized WHERE clause incrementally,
 * used by repositories with dynamic filter sets (property search, listing
 * search). Extracted from `propertyRepository.ts` during Task 6 once a
 * second repository needed the identical pattern — behavior-preserving,
 * not a redesign; `propertyRepository.ts` was updated to import this
 * instead of defining its own copy, and its existing tests confirm
 * nothing changed.
 *
 * Every value passed to `add`/`pushParams` becomes a real parameterized
 * argument ($1, $2, ...) — never string-interpolated. This class only
 * concatenates SQL *condition text* (column names, operators), which
 * callers are responsible for keeping free of caller-supplied values —
 * see each repository's own column whitelisting for how that's enforced.
 */
export class WhereBuilder {
  conditions: string[] = [];
  params: unknown[] = [];

  /** `sqlTemplate` must contain exactly one `?`, replaced with `$N`. */
  add(sqlTemplate: string, value: unknown) {
    this.params.push(value);
    this.conditions.push(sqlTemplate.replace("?", `$${this.params.length}`));
  }

  /** For conditions needing more than one placeholder (e.g. ST_DWithin). */
  nextParamIndexes(count: number): number[] {
    const start = this.params.length + 1;
    return Array.from({ length: count }, (_, i) => start + i);
  }

  pushParams(...values: unknown[]) {
    this.params.push(...values);
  }

  toSql(): string {
    return this.conditions.length > 0 ? `WHERE ${this.conditions.join(" AND ")}` : "";
  }
}
