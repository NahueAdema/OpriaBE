# OPR-401 — Spike: credenciales de Mercado Pago

- Estado: Resuelto (2026-11-23).
- Alcance: decidir cómo cobrar la seña en F4 sin bloquear el MVP vendible.

## Contexto

Cada tenant tiene su propia seña en centavos. Mercado Pago permite dos modelos: credenciales de plataforma (una sola app que cobra a todos, con `external_reference` para diferenciar tenants) u OAuth por tenant (cada negocio conecta su propia cuenta).

## Decisión

**Arrancar con credenciales de plataforma; dejar OAuth por tenant como mejora posterior.**

- Una sola app de MP con `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` como secretos del backend.
- La preferencia de Checkout Pro incluye `external_reference = <appointmentId>` y `metadata.tenant_id`. El backend nunca confía en esos valores del cliente: los toma del turno autenticado.
- La seña viaja en centavos; el monto se copia del snapshot del turno, no del request.
- El webhook valida la firma `x-signature`, es idempotente por `(payment_id, event_type)` y actualiza el turno a `confirmed` una sola vez.
- Si el pago no llega en 15 minutos, se reutiliza el worker de OPR-302/307 para cancelar el turno y liberar el slot con el mismo flujo que F3.
- OAuth por tenant (OPR-401 extendida) queda para cuando haya negocios piloto que quieran su propia cuenta; la tabla `payments` ya debe guardar `credential_owner` para no migrar después.

## Consecuencias

- ✅ MVP de pagos sin flujo OAuth ni permisos por tenant.
- ✅ Conciliación simple por `external_reference`.
- ⚠️ La plataforma concentra el riesgo y los fondos; hay que documentar el flujo de liquidación al negocio desde el primer día.
- ⚠️ Cambiar a OAuth después exige migrar credenciales por tenant y reprocesar preferencias abiertas.

## Tarjetas derivadas

OPR-402 (tabla `payments`), OPR-403 (Checkout Pro), OPR-404 (webhook), OPR-405 (expiración), OPR-406 (UI), OPR-407 (e2e sandbox).
