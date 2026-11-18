import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { HealthService } from './health.service.js';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

@Public()
@SkipThrottle()
@Controller()
export class LandingController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async render(): Promise<string> {
    const liveness = this.health.liveness();

    let databaseUp = false;
    let checkedAt = liveness.timestamp;

    try {
      const readiness = await this.health.readiness();
      databaseUp = true;
      checkedAt = readiness.timestamp;
    } catch {
      // La página debe seguir respondiendo aunque la base no esté disponible.
    }

    const dbState = databaseUp ? 'ok' : 'bad';
    const dbLabel = databaseUp ? 'Conectada' : 'Sin conexión';
    const dbHint = databaseUp
      ? 'Las consultas pueden ejecutarse.'
      : 'Revisá /v1/health/ready para el detalle.';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Opria API: servicio de turnos y disponibilidad para negocios y clientes.">
  <title>Opria API</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --card: #151c33;
      --line: #283254;
      --text: #e8edff;
      --muted: #9ba8cf;
      --accent: #8b7bff;
      --ok: #46d6a0;
      --bad: #ff7a8a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(60rem 40rem at 15% -10%, #302a6b55, transparent),
        radial-gradient(45rem 35rem at 95% 0%, #17515c44, transparent),
        var(--bg);
      line-height: 1.55;
    }
    .wrap { width: min(62rem, calc(100% - 2rem)); margin: 0 auto; padding: 3.5rem 0 2rem; }
    .badge {
      display: inline-flex; align-items: center; gap: .5rem;
      padding: .35rem .7rem; border: 1px solid var(--line); border-radius: 999px;
      background: #ffffff08; color: var(--muted); font-size: .8rem; letter-spacing: .04em;
      text-transform: uppercase;
    }
    .badge::before { content: ''; width: .5rem; height: .5rem; border-radius: 50%; background: var(--accent); }
    h1 { font-size: clamp(2.1rem, 5vw, 3.4rem); line-height: 1.08; margin: 1.25rem 0 .75rem; letter-spacing: -.03em; }
    h1 span { color: var(--accent); }
    .lead { max-width: 42rem; color: var(--muted); font-size: 1.05rem; margin: 0 0 1.25rem; }
    .chips { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 2rem; }
    .chips span { font-size: .78rem; color: var(--muted); border: 1px solid var(--line); border-radius: .5rem; padding: .25rem .6rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1rem; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1.4rem; }
    h2 { font-size: 1rem; margin: 0 0 1rem; letter-spacing: .01em; }
    .row { display: flex; align-items: center; gap: .75rem; padding: .7rem 0; border-top: 1px solid var(--line); }
    .row:first-of-type { border-top: 0; }
    .dot { width: .6rem; height: .6rem; border-radius: 50%; flex: none; }
    .dot.ok { background: var(--ok); box-shadow: 0 0 0 4px #46d6a022; }
    .dot.bad { background: var(--bad); box-shadow: 0 0 0 4px #ff7a8a22; }
    .row strong { display: block; font-size: .9rem; }
    .row small { color: var(--muted); font-size: .78rem; }
    .pill { margin-left: auto; font-size: .72rem; padding: .2rem .5rem; border-radius: .4rem; white-space: nowrap; }
    .pill.ok { color: var(--ok); background: #46d6a018; }
    .pill.bad { color: var(--bad); background: #ff7a8a18; }
    .meta { display: flex; gap: 2rem; margin: 1rem 0 0; padding-top: 1rem; border-top: 1px solid var(--line); }
    .meta div { min-width: 0; }
    .meta dt { color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; }
    .meta dd { margin: .2rem 0 0; font-size: .85rem; font-variant-numeric: tabular-nums; }
    .links { list-style: none; margin: 0; padding: 0; }
    .links a {
      display: flex; justify-content: space-between; align-items: center; gap: 1rem;
      padding: .7rem 0; border-top: 1px solid var(--line); color: var(--text);
      text-decoration: none; font-size: .9rem;
    }
    .links li:first-child a { border-top: 0; }
    .links a:hover { color: var(--accent); }
    .links span { color: var(--muted); font-size: .75rem; font-family: ui-monospace, monospace; }
    .about { margin-top: 1rem; }
    .about p { color: var(--muted); margin: 0 0 1rem; }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
    .features li { border-left: 2px solid var(--accent); padding-left: .8rem; }
    .features strong { display: block; font-size: .85rem; }
    .features small { color: var(--muted); font-size: .78rem; }
    footer { margin-top: 2rem; color: var(--muted); font-size: .78rem; text-align: center; }
    code { font-family: ui-monospace, monospace; color: #c9c2ff; }
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <div class="badge">Opria · API</div>
      <h1>Turnos claros,<br><span>reservas simples.</span></h1>
      <p class="lead">
        Este es el backend de Opria: administra negocios, servicios, staff,
        disponibilidad y turnos, y permite a los clientes buscar y reservar
        sin fricción.
      </p>
      <div class="chips">
        <span>NestJS 12</span><span>Fastify 5</span><span>PostgreSQL 17</span><span>OpenAPI</span>
      </div>
    </header>

    <section class="grid">
      <article class="card">
        <h2>Estado del servicio</h2>
        <div class="row">
          <span class="dot ok"></span>
          <div><strong>API</strong><small>Esta página está siendo servida</small></div>
          <span class="pill ok">Operativa</span>
        </div>
        <div class="row">
          <span class="dot ${dbState}"></span>
          <div><strong>Base de datos</strong><small>${escapeHtml(dbHint)}</small></div>
          <span class="pill ${dbState}">${escapeHtml(dbLabel)}</span>
        </div>
        <dl class="meta">
          <div><dt>Uptime</dt><dd>${escapeHtml(formatUptime(liveness.uptime))}</dd></div>
          <div><dt>Última verificación</dt><dd>${escapeHtml(checkedAt)}</dd></div>
        </dl>
      </article>

      <article class="card">
        <h2>Dónde mirar</h2>
        <ul class="links">
          <li><a href="/docs">Documentación interactiva <span>/docs</span></a></li>
          <li><a href="/docs/openapi.json">Especificación OpenAPI <span>/docs/openapi.json</span></a></li>
          <li><a href="/v1/health">Liveness de la API <span>/v1/health</span></a></li>
          <li><a href="/v1/health/ready">Readiness y dependencias <span>/v1/health/ready</span></a></li>
          <li><a href="/v1/public/businesses">Buscador público <span>/v1/public/businesses</span></a></li>
        </ul>
      </article>
    </section>

    <section class="card about">
      <h2>Qué podés hacer desde acá</h2>
      <p>
        El prefijo de la API es <code>/v1</code>. Las rutas públicas están en
        <code>/v1/public</code> y no necesitan token; el resto requiere un token
        de negocio o de cliente. Con <code>/docs</code> podés explorar y probar
        todos los endpoints sin escribir nada.
      </p>
      <ul class="features">
        <li><strong>Para negocios</strong><small>Alta de servicios, staff, horarios y agenda.</small></li>
        <li><strong>Para clientes</strong><small>Búsqueda por ciudad y servicio, reserva y cancelación.</small></li>
        <li><strong>Disponibilidad</strong><small>Slots calculados con buffers, bloqueos y anti-doble-reserva.</small></li>
      </ul>
    </section>

    <footer>
      El estado se calcula en cada request. Sin scripts, sin llamadas extra desde el navegador.
    </footer>
  </main>
</body>
</html>`;
  }
}
