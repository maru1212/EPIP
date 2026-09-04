# identity module

Users, roles, permissions, RBAC policy checks, agent/agency profiles.

Implemented so far: authentication (registration, login, session
handling — Task 3, hardened in Task 3.1) and RBAC policy checks (`can()`
in `policies.ts` — Task 4). Agent/agency profiles are not implemented yet.

- `services/` — framework-agnostic domain logic (authService,
  passwordService, sessionSecurityService).
- `repositories/` — Prisma-based data access (userRepository,
  permissionRepository).
- `policies.ts` — the RBAC policy layer (`can(userId, permission)`).
- `permissions.ts` — the canonical permission-key list, shared with
  `prisma/seed.ts`.
