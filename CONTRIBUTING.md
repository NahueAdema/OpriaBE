# Contribuir al backend

## Setup

```bash
npm install
cp .env.example .env   # solo si aún no tenés .env; completá las URLs de Neon
npm run start:dev      # http://127.0.0.1:3001
```

El `.env` de desarrollo apunta a la misma Neon que producción: no hace falta Docker. `DATABASE_URL` usa el pooler; `DATABASE_URL_DIRECT` (sin `-pooler`) se usa solo para migraciones. En Windows/PowerShell usá `npm.cmd`.

## Antes de abrir un PR

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Los e2e con base (`RUN_DB_TESTS=1 npm run test:e2e`) usan sufijos únicos y limpian sus datos. No corras `npm run db:seed` contra la Neon compartida salvo que quieras recargar el tenant demo. `npm run db:reset -- --yes` trunca todas las tablas de `app` con `DATABASE_URL_DIRECT`: está pensado para una base local aislada, no para la Neon compartida.

## Commits y hooks

Husky corre `lint-staged` (Prettier sobre `.ts`) y valida el mensaje con commitlint. Mensajes convencionales en español:

```
feat: agregar endpoint de recuperación de contraseña
fix: propagar code CUSTOMER_ACCOUNT en Problem Details
docs: documentar CORS de desarrollo
chore: actualizar drizzle
```

## Convenciones

- ESM con extensión `.js` en todo import relativo.
- `process.env` solo en `src/config/env.ts`; inyectá `ConfigService`.
- Validación con Zod en el borde (`@ZodBody`, `@ZodQuery`, `@ZodParam`) y errores RFC 9457.
- El tenant sale siempre de `@CurrentUser().tenantId`; filtrá todas las queries y respondé `404` para recursos ajenos.
- Dinero en centavos, soft delete para servicios/staff, y no editar migraciones ya aplicadas.

## Plantillas

Usá las plantillas de `.github/ISSUE_TEMPLATE/` y la de PR. El estado general del proyecto vive en `Tareas.md` en la raíz del workspace.
