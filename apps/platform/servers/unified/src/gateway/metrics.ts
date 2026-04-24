import type { RequestHandler } from 'express';

interface RouteStats {
  count: number;
  errors: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

const stats = new Map<string, RouteStats>();
let startedAt = Date.now();

function keyOf(method: string, path: string): string {
  return `${method} ${path}`;
}

/** Per-request middleware that tallies counters keyed by route. Mount
 *  once at the top of the pipeline (after `requestContext`, before
 *  handlers). Collects: total requests, 5xx errors, avg/max duration. */
export const metricsCollector: RequestHandler = (req, res, next) => {
  res.on('finish', () => {
    const path = req.route?.path ?? req.originalUrl.split('?')[0];
    const key = keyOf(req.method, path);
    const entry = stats.get(key) ?? { count: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0 };
    entry.count += 1;
    if (res.statusCode >= 500) entry.errors += 1;
    const dur = Date.now() - (req.startedAt ?? Date.now());
    entry.totalDurationMs += dur;
    if (dur > entry.maxDurationMs) entry.maxDurationMs = dur;
    stats.set(key, entry);
  });
  next();
};

/** Prometheus text-format metrics endpoint. Intentionally dep-free —
 *  `prom-client` adds ~700 LoC for features we don't need at this
 *  scale. Scrape-compatible with any Prometheus-speaking collector. */
export const metricsEndpoint: RequestHandler = (_req, res) => {
  const uptimeS = Math.round((Date.now() - startedAt) / 1000);
  const lines: string[] = [];

  lines.push('# HELP gateway_uptime_seconds Seconds since the gateway started');
  lines.push('# TYPE gateway_uptime_seconds counter');
  lines.push(`gateway_uptime_seconds ${uptimeS}`);

  lines.push('# HELP gateway_request_count Total requests per route');
  lines.push('# TYPE gateway_request_count counter');
  for (const [key, s] of stats) {
    const label = escapeLabel(key);
    lines.push(`gateway_request_count{route="${label}"} ${s.count}`);
  }

  lines.push('# HELP gateway_request_errors 5xx responses per route');
  lines.push('# TYPE gateway_request_errors counter');
  for (const [key, s] of stats) {
    const label = escapeLabel(key);
    lines.push(`gateway_request_errors{route="${label}"} ${s.errors}`);
  }

  lines.push('# HELP gateway_request_duration_avg_ms Average duration per route');
  lines.push('# TYPE gateway_request_duration_avg_ms gauge');
  for (const [key, s] of stats) {
    const label = escapeLabel(key);
    const avg = s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0;
    lines.push(`gateway_request_duration_avg_ms{route="${label}"} ${avg}`);
  }

  lines.push('# HELP gateway_request_duration_max_ms Max duration per route');
  lines.push('# TYPE gateway_request_duration_max_ms gauge');
  for (const [key, s] of stats) {
    const label = escapeLabel(key);
    lines.push(`gateway_request_duration_max_ms{route="${label}"} ${s.maxDurationMs}`);
  }

  res.type('text/plain').send(lines.join('\n') + '\n');
};

function escapeLabel(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function __resetMetricsForTests(): void {
  stats.clear();
  startedAt = Date.now();
}

export function __getMetricsSnapshotForTests(): ReadonlyMap<string, Readonly<RouteStats>> {
  return stats;
}
