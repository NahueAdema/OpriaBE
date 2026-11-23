# OPR-301 — Spike: cola de notificaciones

- Estado: Resuelto (2026-11-23).
- Alcance: decidir cómo enviar confirmaciones, cancelaciones y recordatorios sin acoplar el dominio a un proveedor ni agregar Redis hoy.

## Contexto

Render duerme el servicio cuando no hay tráfico, así que un cron interno no es confiable. No hay Redis en el stack actual (OPR-009 es opcional) y la base es Neon compartida con pooler. Los recordatorios deben respetar la timezone del tenant y enviarse una sola vez, con reintento ante fallo.

## Opciones evaluadas

| Opción | Pros | Contras |
| ------ | ---- | ------- |
| BullMQ + Upstash Redis | Cola madura, delay/retry nativo, at-least-once | Nueva dependencia de infra, costo, secretos extra, Redis aún no existe |
| Tabla de jobs + cron externo | Sin infra nueva; transaccional con el turno; auditable; funciona con Neon | Hay que implementar lease, backoff y deduplicación a mano |
| Webhooks directos en la request | Simple | Se pierde si Render duerme o el proveedor falla; no sirve para recordatorios 24 h/2 h |

## Decisión

**Tabla `app.notification_jobs` + worker disparado por GitHub Actions.**

- Cada evento es una fila con `tenant_id`, `type`, `payload` (JSONB), `recipient`, `scheduled_at`, `attempts`, `status` (`pending`/`done`/`failed`), `dedupe_key` único y `locked_at`.
- El negocio solo llama a `NotificationsService.enqueue(...)` dentro de la misma transacción que crea o cambia el turno. El `dedupe_key` (`${appointmentId}:${type}:${scheduledAt}`) evita duplicados aunque se reenvíe un webhook.
- El worker corre como workflow programado (cada 5–10 min) contra un endpoint protegido `POST /v1/notifications/process`. Ese endpoint despierta Render, toma un lote con `FOR UPDATE SKIP LOCKED`, marca `locked_at` y reintenta con espera creciente.
- `EmailProvider` es una interfaz (`send(msg): Promise<void>`). La implementación inicial es un proveedor de consola/Pino para desarrollo; producción puede cambiar a Resend, SES o similar sin tocar los servicios de dominio.
- Los recordatorios se calculan en la timezone del tenant; `scheduled_at` se guarda en UTC.

## Consecuencias

- ✅ Sin Redis ni secretos nuevos para arrancar F3.
- ✅ Los jobs son auditables y se pueden reprocesar desde SQL.
- ⚠️ Hay que instrumentar el worker y alertar si hay jobs `failed` o `locked_at` viejo (lease zombie).
- ⚠️ El cron externo es el único que despierta Render; si GitHub Actions falla, los recordatorios se retrasan (se puede sumar un keep-alive en OPR-307).

## Tarjetas derivadas

OPR-302 (modelo), OPR-303 (proveedor y plantillas), OPR-304 (eventos), OPR-305 (recordatorios), OPR-306 (enlaces firmados), OPR-307 (cron), OPR-308 (reintentos), OPR-309 (e2e).
