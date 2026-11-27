# Opria API

Backend de Opria: SaaS multi-tenant de turnos con reservas asistidas por IA.

Construido con **NestJS 12** sobre **Fastify 5**, **Zod 4** como única librería de
validación, **PostgreSQL 17** y **Drizzle ORM**.

## Stack

| Pieza         | Elección                                              |
| ------------- | ----------------------------------------------------- |
| Framework     | NestJS 12 (`@nestjs/platform-fastify`)                |
| Runtime       | Node.js 22+ (ESM, `module: nodenext`)                 |
| Validación    | Zod 4 (env + request/response)                        |
| Base de datos | PostgreSQL 17 + Drizzle ORM                           |
| Logs          | Pino (`nestjs-pino`)                                  |
| Documentación | OpenAPI 3.0 + Swagger UI en `/docs`                   |
| Errores       | RFC 9457 Problem Details (`application/problem+json`) |
| Rate limiting | `@nestjs/throttler`                                   |
| Auth          | JWT de acceso + refresh tokens opacos rotativos       |
| Hash          | Argon2id (`argon2`)                                   |
| Tests         | Vitest + `app.inject()`                               |

## Requisitos

- Node.js 22 o superior
- npm 10 o superior
- Docker Desktop (opcional: solo si querés una base local separada; el dev usa la misma Neon que prod)

> En Windows/PowerShell los shims `.ps1` de npm pueden estar bloqueados. Usá
> `npm.cmd` en lugar de `npm`.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # solo si aún no tenés .env; completá las URLs de Neon

npm run start:dev
```

El `.env` de desarrollo ya apunta a la **misma base Neon** que producción, así
que no hace falta levantar Docker ni correr migraciones para arrancar. Si
querés una base local aislada, recién ahí usá `npm run db:up` con el
`DATABASE_URL` de `127.0.0.1:5433`. Tampoco corras `npm run db:seed` contra la
Neon compartida salvo que quieras cargar el tenant demo otra vez (el seed es
idempotente).

La API queda en `http://localhost:3001`, la documentación en
`http://localhost:3001/docs` y el readiness en
`http://localhost:3001/v1/health/ready`.

El seed crea:

| Campo             | Valor                |
| ----------------- | -------------------- |
| Tenant            | `demo`               |
| Email             | `owner@opria.app`    |
| Password          | `opria-demo-2026`    |
| Cliente           | `cliente@opria.app`  |
| Password cliente  | `opria-cliente-2026` |

Se puede personalizar con `SEED_TENANT_SLUG`, `SEED_OWNER_EMAIL`,
`SEED_OWNER_PASSWORD`, `SEED_CUSTOMER_EMAIL` y `SEED_CUSTOMER_PASSWORD`. Es
idempotente: correrlo de nuevo no duplica datos.

Antes de arrancar, generá un secreto real para `JWT_ACCESS_SECRET` (el ejemplo
trae un placeholder):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Variables de entorno

Todas las variables de runtime se validan al arrancar en `src/config/env.ts`. Si
falta una o tiene un formato inválido, el proceso falla indicando cuál es el
problema. No leas `process.env` fuera de ese archivo: inyectá `ConfigService`.

| Variable                 | Default        | Descripción                                       |
| ------------------------ | -------------- | ------------------------------------------------- |
| `NODE_ENV`               | `development`  | `development`, `test` o `production`              |
| `PORT`                   | `3001`         | Puerto HTTP                                       |
| `HOST`                   | `0.0.0.0`      | Interfaz de escucha                               |
| `API_PREFIX`             | `v1`           | Prefijo global de las rutas                       |
| `CORS_ORIGINS`           | vacío          | Orígenes permitidos, separados por coma; en dev incluir `http://localhost:3000` y `http://127.0.0.1:3000` |
| `LOG_LEVEL`              | `info`         | Nivel de Pino                                     |
| `SWAGGER_ENABLED`        | según entorno  | `true` fuera de producción, `false` en producción |
| `RATE_LIMIT_TTL_MS`      | `60000`        | Ventana del rate limit                            |
| `RATE_LIMIT_MAX`         | `100`          | Requests por ventana y por IP                     |
| `DATABASE_URL`           | —              | Connection string de Postgres (requerida)         |
| `DATABASE_URL_DIRECT`    | `DATABASE_URL` | Conexión sin pooler, usada por migraciones        |
| `DATABASE_POOL_MAX`      | `10`           | Tamaño máximo del pool de postgres.js             |
| `JWT_ACCESS_SECRET`      | —              | Secreto HS256, mínimo 32 caracteres (requerido)   |
| `JWT_ACCESS_TTL_SECONDS` | `900`          | Vida del access token (15 minutos)                |
| `JWT_REFRESH_TTL_DAYS`   | `30`           | Vida del refresh token                            |
| `JWT_ISSUER`             | `opria`        | Claim `iss` esperado                              |
| `JWT_AUDIENCE`           | `opria-api`    | Claim `aud` esperado                              |
| `NOTIFICATION_SIGNING_SECRET` | derivado de `JWT_ACCESS_SECRET` | HMAC de enlaces de email (mín. 32) |
| `NOTIFICATION_WORKER_SECRET` | `JWT_ACCESS_SECRET` | Secreto compartido del worker (mín. 32) |
| `ACTION_LINK_TTL_HOURS`  | `168`          | Horas de validez de los enlaces firmados          |
| `PUBLIC_API_URL`         | según entorno  | Base absoluta de los enlaces (incluye `/v1`)      |

### Neon

En dev y producción usá la connection string **pooled** (`...-pooler...`) en
`DATABASE_URL`: `DatabaseService` detecta el sufijo y desactiva los prepared
statements, que PgBouncer en modo transacción no soporta.

Para migraciones, `DATABASE_URL_DIRECT` debe apuntar a la conexión **directa**
(sin `-pooler`). Si no se define, se usa `DATABASE_URL`.

### Notificaciones (F3)

Los eventos de turnos escriben en `app.notification_jobs` dentro de la misma
transacción que el turno. El workflow `.github/workflows/notifications.yml`
despierta Render y llama cada 5 minutos a
`POST /v1/notifications/process` con el header
`x-notification-secret`. El worker toma un lote con `FOR UPDATE SKIP LOCKED`,
aplica backoff exponencial y deja cada intento en `app.notification_log`.

Configuración en GitHub:

- Secret `NOTIFICATION_WORKER_SECRET` (si no existe, usa `JWT_ACCESS_SECRET`).
- Variable `OPRIA_API_URL`, por defecto `https://opriabe.onrender.com`.

En Render conviene definir `PUBLIC_API_URL` (por ejemplo
`https://opriabe.onrender.com/v1`) para que los enlaces de los emails apunten a
la API pública. `NOTIFICATION_SIGNING_SECRET` y `NOTIFICATION_WORKER_SECRET`
son opcionales: por defecto se derivan del secreto JWT con separación de
dominio.

## Scripts

```bash
npm run start:dev    # desarrollo con watch
npm run start:prod   # producción (requiere npm run build)
npm run build        # compila a dist/
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run test         # tests unitarios
npm run test:e2e     # tests end-to-end (auth requiere base)
npm run format       # prettier

npm run db:up        # opcional: docker compose up -d (base local aislada)
npm run db:down      # docker compose down
npm run db:generate  # genera una migración desde el schema
npm run db:migrate   # aplica migraciones pendientes
npm run db:push      # sincroniza el schema sin migración (solo dev)
npm run db:studio    # Drizzle Studio
npm run db:seed      # datos demo
npm run db:reset -- --yes # TRUNCATE de todas las tablas del schema "app"
```

`db:reset` es destructivo: exige `--yes`, usa `DATABASE_URL_DIRECT` (nunca el
pooler), rechaza `NODE_ENV=production` y solo toca el schema `app`. Como dev y
prod comparten la Neon, usalo solo contra una base local aislada.

## Endpoints

| Método | Ruta                                       | Auth              | Descripción                                              |
| ------ | ------------------------------------------ | ----------------- | -------------------------------------------------------- |
| GET    | `/`                                        | público           | Página de bienvenida con estado y guía de enlaces        |
| GET    | `/v1/health`                               | público           | Liveness probe                                           |
| GET    | `/v1/health/ready`                         | público           | Readiness probe (incluye Postgres)                       |
| POST   | `/v1/auth/register`                        | público           | Crea tenant + usuario Dueño                              |
| POST   | `/v1/auth/login`                           | público           | Email + contraseña → tokens (sin slug; elige el tenant activo por rol) |
| POST   | `/v1/auth/refresh`                         | público           | Rota el refresh token                                    |
| POST   | `/v1/auth/logout`                          | público           | Revoca la sesión (o todos los dispositivos)              |
| POST   | `/v1/auth/change-password`                 | Bearer            | Cambia la contraseña y revoca las otras sesiones         |
| GET    | `/v1/auth/me`                              | Bearer            | Usuario actual y sus memberships                         |
| GET    | `/v1/business`                             | Bearer            | Configuración del tenant activo                          |
| PATCH  | `/v1/business`                             | owner/admin       | Actualiza perfil, timezone y políticas                   |
| GET    | `/v1/services`                             | Bearer            | Lista servicios (`?active=true                           | false`) |
| POST   | `/v1/services`                             | owner/admin       | Crea un servicio + seña                                  |
| GET    | `/v1/services/:id`                         | Bearer            | Detalle de un servicio                                   |
| PATCH  | `/v1/services/:id`                         | owner/admin       | Actualiza un servicio                                    |
| DELETE | `/v1/services/:id`                         | owner/admin       | Desactiva un servicio (soft delete)                      |
| GET    | `/v1/staff`                                | Bearer            | Lista staff (`?active=true                               | false`) |
| POST   | `/v1/staff`                                | owner/admin       | Crea un miembro del staff                                |
| GET    | `/v1/staff/:id`                            | Bearer            | Detalle del staff con sus servicios                      |
| PATCH  | `/v1/staff/:id`                            | owner/admin       | Actualiza un miembro del staff                           |
| DELETE | `/v1/staff/:id`                            | owner/admin       | Desactiva staff (soft delete)                            |
| GET    | `/v1/staff/:id/services`                   | Bearer            | Servicios que realiza el staff                           |
| PUT    | `/v1/staff/:id/services`                   | owner/admin       | Reemplaza la asignación de servicios                     |
| GET    | `/v1/staff/:id/working-hours`              | Bearer            | Horario semanal del staff                                |
| PUT    | `/v1/staff/:id/working-hours`              | owner/admin       | Reemplaza el horario semanal                             |
| GET    | `/v1/staff/:id/time-blocks`                | Bearer            | Bloqueos (`?from=&to=` ISO 8601)                         |
| POST   | `/v1/staff/:id/time-blocks`                | owner/admin       | Crea un bloqueo                                          |
| DELETE | `/v1/staff/:id/time-blocks/:blockId`       | owner/admin       | Elimina un bloqueo                                       |
| GET    | `/v1/availability`                         | Bearer            | Franjas libres (`?serviceId=&date=&staffId?=`)           |
| GET    | `/v1/appointments`                         | Bearer            | Turnos (`?from=&to=&status=&staffId=&serviceId=&limit=`) |
| POST   | `/v1/appointments`                         | owner/admin/staff | Alta manual (header `Idempotency-Key`)                   |
| PATCH  | `/v1/appointments/:id/status`              | owner/admin/staff | Cambia el estado del turno                               |
| PATCH  | `/v1/appointments/:id/reschedule`          | owner/admin/staff | Reprograma conservando el `id`                           |
| GET    | `/v1/customers`                            | Bearer            | Clientes del tenant (`?q=&limit=`)                       |
| GET    | `/v1/customers/:phone`                     | Bearer            | Ficha del cliente con historial                          |
| PATCH  | `/v1/customers/:phone`                     | owner/admin/staff | Notas y consentimiento del cliente                       |
| GET    | `/v1/customers/export`                     | owner/admin/staff | Export CSV (BOM UTF-8, separador `;`)                    |
| GET    | `/v1/public/businesses`                    | público           | Buscador (`?q=&city=&service=`)                          |
| GET    | `/v1/public/businesses/filters`            | público           | Ciudades y servicios disponibles                         |
| GET    | `/v1/public/businesses/:slug`              | público           | Perfil público + servicios                               |
| GET    | `/v1/public/businesses/:slug/availability` | público           | Slots reservables                                        |
| GET    | `/v1/public/businesses/:slug/calendar`     | público           | Días con disponibilidad                                  |
| POST   | `/v1/public/businesses/:slug/appointments` | público           | Reserva como invitado                                    |
| POST   | `/v1/customer-auth/register`               | público           | Crea una cuenta de cliente                               |
| POST   | `/v1/customer-auth/login`                  | público           | Login de cliente → tokens                                |
| POST   | `/v1/customer-auth/refresh`                | público           | Rota el refresh token de cliente                         |
| POST   | `/v1/customer-auth/logout`                 | público           | Revoca la sesión de cliente                              |
| GET    | `/v1/customer-auth/me`                     | Bearer (cliente)  | Cuenta del cliente                                       |
| GET    | `/v1/customer/appointments`                | Bearer (cliente)  | Turnos del cliente                                       |
| POST   | `/v1/customer/appointments`                | Bearer (cliente)  | Reserva con los datos de la cuenta                       |
| POST   | `/v1/customer/appointments/:id/cancel`     | Bearer (cliente)  | Cancela respetando `cancellationHours`                   |
| GET    | `/docs`                                    | —                 | Swagger UI                                               |
| GET    | `/docs/openapi.json`                       | —                 | Documento OpenAPI                                        |

Los tests e2e de auth, configuración, turnos, panel de clientes y notificaciones
necesitan una base migrada y se activan con `RUN_DB_TESTS=1`:

```bash
RUN_DB_TESTS=1 DATABASE_URL=postgres://opria:opria@127.0.0.1:5433/opria npm run test:e2e
```

## Estructura

```
src/
  bootstrap.ts              # app Fastify + plugins + Swagger
  main.ts                   # entrypoint
  app.module.ts             # módulos, logger, throttler, filtro global
  config/env.ts             # esquema Zod de variables de entorno
  common/
    http/problem-details.filter.ts
    zod/zod-validation.pipe.ts
    zod/zod.decorators.ts   # @ZodBody, @ZodQuery, @ZodParam
    zod/zod-openapi.ts      # Zod -> OpenAPI 3.0
  auth/
    auth.controller.ts      # /auth/*
    auth.service.ts         # registro, login, refresh, logout, cambio de contraseña, me
    auth.schemas.ts         # esquemas Zod + tipos
    auth.module.ts          # JwtModule global
    decorators/             # @Public, @Roles, @CurrentUser, @CurrentCustomer
    guards/                 # JwtAuthGuard, RolesGuard (globales), CustomerAuthGuard
  customer-auth/
    customer-auth.controller.ts # /customer-auth/*
    customer-auth.service.ts    # registro, login, refresh, logout, me
    customer-auth.schemas.ts    # esquemas Zod + tipos
  customer-appointments/
    customer-appointments.controller.ts # /customer/appointments
    customer-appointments.service.ts    # listado, reserva y cancelación
    customer-appointments.schemas.ts    # request/response del cliente
  business/
    business.controller.ts  # /business
    business.service.ts     # perfil y políticas del tenant
    business.schemas.ts     # slug, timezone, contacto, políticas
  services/
    services.controller.ts  # /services
    services.service.ts     # CRUD con soft delete
    services.schemas.ts     # servicio + seña
    deposit.ts              # reglas de seña (fixed/percentage)
  staff/
    staff.controller.ts     # /staff, horarios y bloqueos
    staff.service.ts        # CRUD, asignaciones, horarios, bloqueos
    staff.schemas.ts        # staff, working hours, time blocks
    working-hours.ts        # detección de solapamientos
  availability/
    availability.controller.ts # /availability
    availability.service.ts    # carga horarios/bloqueos/turnos y agrupa staff
    availability.schemas.ts    # query y respuesta
    availability.ts            # motor puro + conversión timezone/DST
  appointments/
    appointments.controller.ts # /appointments, :id/status y :id/reschedule
    appointments.service.ts    # alta manual, listado, cambio de estado, reprogramación e idempotencia
    appointments.transitions.ts # transiciones y estados que bloquean
    appointments.schemas.ts    # query, body y respuesta de turnos
  customers/
    customers.controller.ts # /customers, /:phone y /export
    customers.service.ts    # listado, ficha, notas, consentimiento y CSV
    customers.schemas.ts    # query, params y body
    csv.ts                  # BOM UTF-8, separador ; y saneado de fórmulas
  public-booking/
    public-booking.controller.ts # /public/businesses
    public-booking.service.ts    # búsqueda, perfil, slots, calendario y reserva
    public-booking.schemas.ts    # request/response pública
  database/
    database.module.ts
    database.service.ts     # pool lazy + ping()
    seed.ts
    schema/                 # tenants, users, memberships, refresh_tokens,
                            # services, staff, staff_services, working_hours,
                            # time_blocks, appointments, idempotency_keys,
                            # customer_profiles, notification_jobs, notification_log
  health/
drizzle/                    # migraciones generadas (versionadas)
```

## Base de datos

Las tablas de negocio viven en el schema `app`, no en `public`, para no chocar
con extensiones ni con objetos administrados por Neon. `drizzle.config.ts`
limita `schemaFilter` a `app`.

Modelo inicial:

```
tenants 1 ──── * memberships * ──── 1 users
    │                                   │
    ├────────── * refresh_tokens * ─────┘
    ├────────── * services
    ├────────── * appointments
    └────────── * staff 1 ── * staff_services * ── 1 services
                     ├── * working_hours
                     ├── * time_blocks
                     └── * appointments

customers 1 ── * customer_refresh_tokens
    └───────── * appointments (customer_id nullable)
```

- `tenants`: negocio, slug único, timezone, plan, estado, contacto, logo y
  políticas de reserva/cancelación.
- `users`: email (siempre en minúsculas, único), hash de contraseña y flag de
  administrador de plataforma.
- `memberships`: une usuarios y tenants con un rol (`owner`, `admin`, `staff`,
  `customer`). Un usuario puede pertenecer a varios tenants.
- `refresh_tokens`: tokens opacos guardados solo como hash SHA-256, agrupados
  por `family_id` para detectar reuso.
- `services`: servicio reservable con duración, buffer, precio y seña.
- `staff`: persona que atiende; el vínculo con `users` es opcional hasta que
  acepte una invitación (Fase 2).
- `staff_services`: qué servicios realiza cada miembro del staff.
- `working_hours`: disponibilidad semanal recurrente por staff.
- `time_blocks`: indisponibilidades puntuales (vacaciones, descansos, turnos
  externos).
- `appointments`: turno reservado, con cliente invitado (nombre, teléfono,
  email y notas), servicio, staff, rango UTC, precio/seña snapshot y estado.
  Tiene un `status_reason` opcional para rechazos y cancelaciones. Si la reserva
  se hizo con sesión de cliente, `customer_id` apunta a la cuenta.
- `customers`: cuenta de cliente (email único, nombre, teléfono, hash Argon2).
  Es independiente de `users`: no tiene memberships ni acceso al panel.
- `customer_refresh_tokens`: refresh tokens opacos de cliente, con el mismo
  esquema de familias y rotación que `refresh_tokens`.
- `idempotency_keys`: ledger por tenant + clave, con el fingerprint del request.
  Un replay devuelve el turno original vigente; reutilizar la clave con otro
  payload responde `409`.
- `customer_profiles`: notas internas y consentimiento por tenant, identificados
  por teléfono. El listado de clientes se deriva de los turnos con `LEFT JOIN`
  al perfil, así que también aparecen los invitados.
- `notification_jobs` y `notification_log`: cola de F3 con próximo intento,
  `appointment_id`, dedupe y registro de cada envío.

Todas las tablas tienen `created_at` y `updated_at`. Las tablas de negocio que
se agreguen deben incluir `tenant_id` para el aislamiento multi-tenant.

### Flujo de migraciones

1. Editá el schema en `src/database/schema/`.
2. `npm run db:generate` y revisá el SQL generado en `drizzle/`.
3. `npm run db:migrate`.
4. Commiteá el schema y la migración juntos.

## Autenticación y roles

Las rutas son **privadas por defecto**. `JwtAuthGuard` se registra como guard
global y exige `Authorization: Bearer <accessToken>`; solo las rutas marcadas
con `@Public()` quedan abiertas. `RolesGuard` corre después y aplica `@Roles(...)`.

El access token es un JWT HS256 de vida corta con este payload:

```json
{ "sub": "<userId>", "tid": "<tenantId>", "role": "owner", "padmin": false }
```

- `tid` es el tenant activo de la sesión.
- `padmin` marca administradores de plataforma, que bypassean `@Roles`.

Los refresh tokens son opacos (no JWT), se guardan hasheados con SHA-256 y
rotan en cada uso. Todos los tokens de una sesión comparten `family_id`: si se
presenta un token ya rotado, se revoca la familia completa (detección de reuso).

```ts
import { Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('settings')
export class SettingsController {
  @Public()
  @Get('public')
  publicInfo() {}

  @Roles('owner', 'admin')
  @Get()
  settings(@CurrentUser() user: AuthenticatedUser) {
    // user = { id, tenantId, role, isPlatformAdmin }
  }
}
```

Al hacer login, `tenantSlug` es obligatorio solo si el usuario pertenece a más
de un tenant; si pertenece a uno solo se resuelve automáticamente.

`POST /auth/change-password` pide la contraseña actual y una nueva de al menos
10 caracteres. Revoca todos los refresh tokens del usuario salvo la familia del
token enviado en el body (`refreshToken`), así la sesión que hizo el cambio
sigue activa y los demás dispositivos deben volver a ingresar.

## Cuentas de cliente

Los clientes finales tienen su propia cuenta, separada del staff: viven en
`customers`, no tienen `memberships` y no pueden entrar al panel del negocio.

- **Realm separado.** El access token de cliente usa el mismo secreto pero
  incluye `{ "sub": "<customerId>", "typ": "customer" }`. `JwtAuthGuard` rechaza
  ese `typ` y `CustomerAuthGuard` rechaza tokens de staff, así que un token no
  sirve para el otro lado.
- **Rutas.** `/v1/customer-auth/register|login|refresh|logout|me` y
  `/v1/customer/appointments`. Los refresh tokens son opacos, hasheados y rotan
  por familia igual que los del staff.
- **Reserva con sesión.** `POST /v1/customer/appointments` recibe
  `businessSlug`, `serviceId` y `startsAt`; el nombre, teléfono y email salen de
  la cuenta y el turno se crea `pending` con `customer_id`.
- **Aislamiento.** El listado y la cancelación siempre filtran por el
  `customer_id` del token; un turno ajeno responde `404`.
- **Cancelación.** Solo desde `pending`/`confirmed` y solo si el turno está
  fuera de `cancellationHours`; dentro de la ventana responde `409` con el
  mensaje de la política del negocio.
- **Invitados.** La reserva pública sigue funcionando sin cuenta. Los turnos
  viejos de invitado no se vinculan por email: sin verificación de email,
  cualquiera podría reclamar el turno de otra persona.

## Clientes del panel

`GET /v1/customers` lista clientes del tenant activo, incluidos invitados
identificados por teléfono. `GET /v1/customers/:phone` devuelve la ficha con su
historial de turnos y `PATCH /v1/customers/:phone` guarda notas internas y
consentimiento en `customer_profiles` (la crea al primer guardado).

`GET /v1/customers/export` usa el mismo filtro `?q=` que el listado y devuelve
un CSV con BOM UTF-8, separador `;` y celdas saneadas cuando empiezan con `=`,
`+`, `-` o `@` para evitar inyección de fórmulas.

`app.customers` sigue siendo el realm global de autenticación de clientes; las
notas y el consentimiento son datos privados de cada negocio y nunca se comparten
entre tenants.

## Configuración del negocio

Cada request usa el tenant activo del access token (`tid`). No hay `tenantId` en
la URL: el aislamiento es implícito y un recurso de otro tenant responde `404`
para no filtrar su existencia. Las escrituras requieren `owner` o `admin`.

- **Dinero en centavos.** `priceCents` y `depositValue` son enteros; nunca se
  usan floats para importes.
- **Seña.** `depositType` puede ser `none` (valor 0), `fixed` (centavos, no
  puede superar `priceCents`) o `percentage` (0-100). Las combinaciones
  inválidas se rechazan con `400`.
- **Soft delete.** `DELETE /services/:id` y `DELETE /staff/:id` ponen
  `active=false`; los registros siguen siendo legibles y se filtran con
  `?active=true|false`.
- **Horarios.** `weekday` usa ISO 8601 (1 = lunes, 7 = domingo) y las horas son
  `HH:MM` en la timezone del tenant. `PUT /staff/:id/working-hours` reemplaza el
  horario completo en una transacción y rechaza solapamientos con `400`.
- **Bloqueos.** `startsAt`/`endsAt` son ISO 8601 con `Z` u offset. Un bloqueo
  que se solapa con otro del mismo staff responde `409`.
- **Slugs reservados.** `docs`, `api`, `v1`, `auth`, `app`, `admin`, etc. no se
  pueden usar como slug de tenant.

## Disponibilidad

`GET /v1/availability?serviceId=&date=YYYY-MM-DD&staffId?=` devuelve las horas
de inicio reservables para un servicio en una fecha. El cálculo vive en
`src/availability/availability.ts` como función pura (`computeAvailability`) y
no toca la base.

- **Fecha local, slots UTC.** `date` es una fecha de calendario en la timezone
  del tenant; cada slot devuelve `startsAt`/`endsAt` en ISO 8601 UTC.
- **Buffer.** `services.bufferMinutes` (0-240) reserva tiempo libre antes y
  después del turno. El turno más el buffer deben entrar en la franja.
- **Múltiples franjas.** Se evalúan todas las franjas del día y se deduplican
  por hora de inicio.
- **Bloqueos duros.** Un turno que se solapa con un `time_block` se descarta.
- **Turnos existentes.** `pending` y `confirmed` se pasan como `busy` junto con
  su buffer; el resto de los estados no bloquea. `availability.service.ts`
  carga los turnos del rango y los entrega al motor.
- **DST.** Los candidatos se generan en wall-clock local y se convierten uno a
  uno a UTC. Las horas inexistentes (spring forward) se descartan; en el fall
  back se usa la primera ocurrencia.
- **Anticipación.** Se respetan `bookingMinAdvanceMinutes` y
  `bookingMaxAdvanceDays` del tenant. Sin staff elegible, `slots` es `[]`.
- **Multi-staff.** Sin `staffId`, cada slot trae `staffIds` con todos los
  profesionales activos asignados al servicio que pueden atenderlo.
- **Granularidad.** Los candidatos avanzan cada 15 minutos por defecto.

## Turnos y reservas públicas

El flujo de reserva tiene dos caras: la agenda del negocio (autenticada), la
reserva pública de invitados (anónima) y la reserva con cuenta de cliente.

### Estados

| Estado      | Bloquea el horario | Transiciones permitidas              |
| ----------- | ------------------ | ------------------------------------ |
| `pending`   | sí                 | `confirmed`, `rejected`, `cancelled` |
| `confirmed` | sí                 | `completed`, `no_show`, `cancelled`  |
| `rejected`  | no                 | —                                    |
| `cancelled` | no                 | —                                    |
| `completed` | no                 | —                                    |
| `no_show`   | no                 | —                                    |

`PATCH /v1/appointments/:id/status` valida la transición: una inválida responde
`409`. Rechazar solo se permite desde `pending` y acepta un `reason` opcional
que se guarda en `status_reason`.

### Anti-doble-reserva

La migración `0005_appointments_no_overlap.sql` habilita `btree_gist` y crea un
constraint de exclusión sobre `tstzrange(starts_at, ends_at)` por `staff_id`,
parcial para `pending`/`confirmed`:

```sql
ALTER TABLE app.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('pending', 'confirmed'));
```

Como el constraint no considera buffers, la creación toma
`pg_advisory_xact_lock(hashtext(staff_id))` y, dentro de la transacción,
revalida solapamiento con buffer antes de insertar. Un segundo request
simultáneo recibe `409`.

### Alta manual y reprogramación desde el panel

`POST /v1/appointments` crea turnos desde el panel con `owner`, `admin` o
`staff`. Requiere `serviceId`, `startsAt`, `customerName` y `customerPhone`;
`customerEmail`, `notes`, `staffId` y `status` (`pending` por defecto) son
opcionales. Si falta `staffId`, se autoasigna el primero libre. El header
`Idempotency-Key` se guarda por tenant junto al fingerprint del body:

- Un replay con la misma clave y el mismo payload devuelve el turno original,
  con su estado actual (no una copia del momento de la creación).
- La misma clave con otro payload responde `409`.

La creación usa el mismo `computeAvailability`, advisory lock y constraint de
exclusión que la reserva pública. Con `status: 'confirmed'` no se genera el
evento de «solicitud recibida»: se envían la confirmación y los recordatorios.

`PATCH /v1/appointments/:id/reschedule` recibe `startsAt` y un `reason`
opcional. Conserva el `id`, valida el nuevo slot, respeta `cancellationHours`,
mantiene el profesional asignado, reprograma los recordatorios pendientes y
emite `appointment_rescheduled*` para cliente y negocio. Los turnos ajenos al
tenant responden `404`.

### Buscador público

`GET /v1/public/businesses` lista negocios activos con tres filtros
combinables, todos opcionales:

- `q`: nombre o slug (mínimo 2 caracteres).
- `city`: ciudad del negocio, sin distinguir mayúsculas.
- `service`: nombre de un servicio activo ofrecido.

`GET /v1/public/businesses/filters` devuelve las ciudades y los nombres de
servicio disponibles para poblar los selects. Cada resultado incluye `city` y
`serviceCount`.

### Reserva pública

`POST /v1/public/businesses/:slug/appointments` crea un turno `pending`:

- `serviceId`, `startsAt`, `customerName` y `customerPhone` son obligatorios;
  `customerEmail` y `notes` son opcionales. No hay cuenta de cliente.
- El profesional se auto-asigna: el primer staff activo asignado al servicio que
  esté libre en ese horario.
- El slot se valida contra el motor de disponibilidad; si ya no está libre,
  responde `409`.
- El precio y la seña se copian del servicio al turno (snapshot); no hay pago
  online de la seña.
- Límites: 30 req/min para los GET públicos y 5 req/min para el POST.

### Calendario público

`GET /v1/public/businesses/:slug/calendar?serviceId=&from=&to=` devuelve qué
días del rango tienen al menos un slot libre, para pintar el calendario del
flujo de reserva. `GET /:slug/availability` devuelve los slots de un día.

## Validación con Zod

Los decoradores `@ZodBody`, `@ZodQuery` y `@ZodParam` validan, transforman y
documentan en un solo paso:

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody, ZodQuery } from '../common/zod/zod.decorators.js';

const createAppointmentSchema = z.object({
  startsAt: z.iso.datetime(),
  serviceId: z.uuid(),
});

const listAppointmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
});

@Controller('appointments')
export class AppointmentsController {
  @Post()
  create(
    @ZodBody(createAppointmentSchema)
    body: z.infer<typeof createAppointmentSchema>,
  ) {
    return body;
  }

  @Get()
  list(
    @ZodQuery(listAppointmentsSchema)
    query: z.infer<typeof listAppointmentsSchema>,
  ) {
    return query;
  }
}
```

La validación falla con `400` y el formato Problem Details, incluyendo el path
de cada campo inválido.

## Errores

Todas las respuestas de error usan RFC 9457:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "instance": "/v1/appointments",
  "errors": [
    {
      "path": "startsAt",
      "code": "invalid_format",
      "message": "Invalid ISO datetime"
    }
  ]
}
```

## Convenciones

- El proyecto es ESM: **todo import relativo lleva extensión `.js`**.
- Validá en el borde: los controllers no reciben datos sin pasar por Zod.
- No accedas a `process.env` fuera de `src/config/env.ts`.
- Los módulos de negocio se agregan cuando se confirme el alcance del producto.

## CI / CD

Los workflows viven en `.github/workflows/`:

- `ci.yml`: corre en push a `main`, en pull requests y por disparo manual.
  Ejecuta `typecheck`, `lint`, tests unitarios y `build` en un job, y los e2e
  en otro con un servicio `postgres:17` efímero (migra la base antes de correr).
- `deploy.yml`: escucha la finalización de `CI` en `main` (o un disparo manual)
  y solo actúa si `RENDER_DEPLOY_ENABLED=true`. Aplica las migraciones desde
  GitHub Actions contra la base de Neon y dispara el Deploy Hook de Render.
  Render corre sus propios Build/Start commands definidos en el servicio.

### Secrets

| Nombre                   | Uso                                                  |
| ------------------------ | ---------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | URL del Deploy Hook del Web Service en Render         |
| `DATABASE_URL_DIRECT`    | Connection string de Neon para `drizzle-kit migrate`  |
| `NOTIFICATION_WORKER_SECRET` | Secreto del header del cron de notificaciones     |

### Variables

| Nombre                  | Default | Uso                                             |
| ----------------------- | ------- | ----------------------------------------------- |
| `RENDER_DEPLOY_ENABLED` | `false` | Poner `true` para habilitar el deploy automático |
| `OPRIA_API_URL`         | `https://opriabe.onrender.com` | Base del worker de notificaciones |

### Configuración en Render

El Web Service (`https://opriabe.onrender.com/`) usa:

- Build Command: `npm ci && npm run build`
- Start Command: `npm run start:prod`
- Health Check Path: `/v1/health`
- `NODE_VERSION=22`, `NODE_ENV=production`
- `DATABASE_URL` (la connection string pooled de Neon), `JWT_ACCESS_SECRET`,
  `CORS_ORIGINS`, `PUBLIC_API_URL`

`CORS_ORIGINS` debe incluir el origin del frontend, por ejemplo
`https://opriadev.netlify.app`. Las migraciones no las corre Render solas: las
aplica el workflow antes del hook, o `npm run db:migrate` manualmente.
