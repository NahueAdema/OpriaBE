# AGENTS.md

## Stack

- NestJS 12 sobre Fastify 5 (`@nestjs/platform-fastify`).
- TypeScript ESM (`module: nodenext`, `"type": "module"`).
- Zod 4 para variables de entorno y validación de requests.
- PostgreSQL 17 + Drizzle ORM (`postgres.js`).
- Vitest para unitarios y e2e (`app.inject()`).
- oxlint con `typescript/no-floating-promises: error`.

## Auth

- Las rutas son privadas por defecto: `JwtAuthGuard` y `RolesGuard` están
  registrados como `APP_GUARD` en `AppModule`.
- Marcá con `@Public()` (`src/auth/decorators/`) solo lo que deba ser anónimo
  (health, register, login, refresh, logout).
- Restringí por rol de tenant con `@Roles('owner', 'admin')`. Los platform
  admins (`padmin`) bypassean el chequeo.
- El usuario autenticado se inyecta con `@CurrentUser()`; no leas el token a mano.
- Los refresh tokens son opacos, se guardan hasheados y rotan por `family_id`.
  No los devuelvas en logs ni los persistas en claro.

## Configuración del negocio

- `business`, `services` y `staff` son los módulos de la Fase 1. El tenant sale
  siempre de `@CurrentUser().tenantId`; nunca aceptes un `tenantId` del cliente.
- Filtrá **todas** las queries por `tenantId`. Si un recurso no pertenece al
  tenant activo, respondé `404` (no `403`) para no filtrar su existencia.
- El dinero se guarda en centavos (`priceCents`, `depositValue`). No uses floats.
- La seña se valida con `depositValidationMessage` (`src/services/deposit.ts`):
  `none` exige 0, `fixed` no puede superar el precio y `percentage` va de 0 a 100.
- Servicios y staff usan soft delete (`active=false`); no borres filas que puedan
  estar referenciadas por turnos.
- Los horarios usan `weekday` ISO 8601 (1 = lunes, 7 = domingo) y horas `HH:MM`
  en la timezone del tenant. `PUT .../working-hours` reemplaza el horario
  completo en una transacción y valida solapamientos con
  `workingHoursOverlapIssues`.
- Los bloqueos son rangos ISO 8601 con offset; dos bloqueos del mismo staff no
  pueden solaparse (`409`).
- El panel de clientes vive en `/v1/customers`: listado derivado de turnos con
  `LEFT JOIN` al perfil por teléfono, ficha con historial, notas y
  consentimiento por tenant (`customer_profiles`) y CSV con BOM UTF-8,
  separador `;` y celdas saneadas contra inyección de fórmulas.
  `app.customers` es solo el realm global de auth; no mezcles ambos conceptos.

## Disponibilidad

- El cálculo vive en `src/availability/availability.ts` como función pura
  (`computeAvailability`). No consultes la base desde ahí; el service carga
  horarios, bloqueos y staff y después llama al motor.
- `date` es una fecha de calendario (`YYYY-MM-DD`) en la timezone del tenant.
  Los slots se devuelven en UTC (`startsAt`/`endsAt` ISO 8601).
- Los candidatos se generan en wall-clock local cada 15 minutos (configurable)
  y se convierten a UTC uno por uno. Las horas inexistentes por spring-forward
  DST se descartan; en fall-back se usa la primera ocurrencia.
- `services.bufferMinutes` (0-240) se reserva antes y después del turno. Un
  turno existente también reserva su buffer de forma simétrica.
- Los `time_blocks` son indisponibilidad dura: cualquier solapamiento descarta
  el slot.
- Respetá `bookingMinAdvanceMinutes` y `bookingMaxAdvanceDays` del tenant. Si no
  hay staff elegible, devolvé `slots: []` (no `404`).
- Sin `staffId`, agrupá por hora de inicio y devolvé todos los `staffIds`
  activos asignados al servicio que pueden atender ese horario.
- Los turnos en estado `pending` o `confirmed` ocupan su buffer y bloquean el
  slot; `rejected`, `cancelled`, `completed` y `no_show` no bloquean.
  `availability.service.ts` carga los turnos del día y los pasa como `busy`.

## Turnos y reservas públicas

- Un turno es un rango `starts_at`/`ends_at` del staff con un estado:
  `pending`, `confirmed`, `rejected`, `cancelled`, `completed` o `no_show`.
- Máquina de estados (`src/appointments/appointments.transitions.ts`):
  `pending → confirmed | rejected | cancelled`,
  `confirmed → completed | no_show | cancelled`. Rechazar solo desde `pending`;
  rechazar un turno ya confirmado es `409`.
- `pending` y `confirmed` bloquean el horario. Rechazar o cancelar lo libera.
- **Anti-doble-reserva:** constraint de exclusión Postgres
  `appointments_no_overlap` sobre `tstzrange(starts_at, ends_at)` por
  `staff_id`, parcial para `pending`/`confirmed` (migración `0005`, requiere
  `btree_gist`). El service además toma
  `pg_advisory_xact_lock(hashtext(staffId))` y re-chequea buffer y solapamiento
  antes de insertar. No reemplaces ese lock por un chequeo en memoria.
- La API del negocio vive en `/v1/appointments` (`@Roles('owner', 'admin',
  'staff')`) y siempre filtra por `tenantId`. El tenant sale del token, nunca
  del body. Incluye listado (`GET`), alta manual (`POST`, con
  `Idempotency-Key`), cambio de estado (`PATCH /:id/status`) y reprogramación
  (`PATCH /:id/reschedule`). El alta valida disponibilidad, asigna staff si
  falta y usa el mismo advisory lock que la reserva pública; la reprogramación
  conserva el `id`, respeta `cancellationHours` y reagenda recordatorios.
- La API pública vive en `/v1/public/businesses` y usa `@Public()`:
  `GET /` (buscador por `?q=`), `GET /:slug` (perfil + servicios),
  `GET /:slug/availability`, `GET /:slug/calendar` y
  `POST /:slug/appointments`.
- La reserva pública es de invitado (nombre y teléfono obligatorios, email y
  notas opcionales) y **no elige profesional**: se auto-asigna el primer staff
  activo y habilitado para el servicio y el horario.
- Los GET públicos tienen rate limit de 30/min y el POST de 5/min. No expongas
  datos de otros tenants ni ids internos innecesarios en las respuestas
  públicas.

## Convenciones

- Todo import relativo necesita la extensión `.js` (ESM).
- No leas `process.env` fuera de `src/config/env.ts`; inyectá `ConfigService`.
- Validá los inputs en el borde con `@ZodBody`, `@ZodQuery` o `@ZodParam`
  (`src/common/zod/`). No agregues class-validator ni `nestjs-zod`.
- Los errores se responden como RFC 9457 Problem Details
  (`application/problem+json`) desde `ProblemDetailsFilter`.
- Los logs van por Pino (`nestjs-pino`); no uses `console.log` en runtime.
- No agregues módulos de negocio sin confirmar el alcance con el usuario.
- En Windows/PowerShell usá `npm.cmd`; los shims `.ps1` pueden estar bloqueados.

## Base de datos

- Las tablas de negocio viven en el schema `app` (`src/database/schema/schema.ts`).
- Toda tabla de negocio nueva debe incluir `tenant_id`, `created_at` y
  `updated_at`.
- Accedé a la base con `DatabaseService.db`; no crees pools nuevos.
- Para cambiar el schema: editá `src/database/schema/`, corré
  `npm run db:generate`, revisá el SQL en `drizzle/` y después
  `npm run db:migrate`. Commiteá schema y migración juntos.
- No edites migraciones ya aplicadas; generá una nueva.
- `DATABASE_URL_DIRECT` es la conexión sin pooler para migraciones.

## Comandos

```bash
npm run build
npm run typecheck
npm run lint
npm run test
npm run test:e2e
RUN_DB_TESTS=1 npm run test:e2e   # incluye auth + config del negocio + turnos (base migrada)

npm run db:up
npm run db:migrate
npm run db:seed
```
