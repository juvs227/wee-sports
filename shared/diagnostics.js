/** Opt-in, bounded local-clock measurements. Never infer one-way latency by
 * subtracting clocks on different devices, or equate an acknowledgement to a
 * displayed frame. No sensor vectors, player names or session tokens are kept. */
export const DIAGNOSTICS_PROBE = 'diagnostics:probe';
const validName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(value);
const validDuration = value => Number.isFinite(value) && value >= 0 && value <= 60000;

export function createDiagnostics({enabled = false, scope = 'local', now = () => performance.now(), capacity = 240} = {}) {
  const limit = Math.max(8, Math.min(480, Number.isInteger(capacity) ? capacity : 240));
  const timings = new Map(), counters = new Map(), traces = new Map(), remote = new Map();
  const percentile = (ordered, fraction) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
  const api = {
    enabled: enabled === true,
    count(name, amount = 1) {
      if (!api.enabled || !validName(name) || !Number.isSafeInteger(amount) || amount < 0 || (!counters.has(name) && counters.size >= 64)) return;
      counters.set(name, Math.min(Number.MAX_SAFE_INTEGER, (counters.get(name) || 0) + amount));
    },
    observe(name, milliseconds) {
      if (!api.enabled || !validName(name) || !validDuration(milliseconds) || (!timings.has(name) && timings.size >= 64)) return;
      if (!timings.has(name)) timings.set(name, []);
      const values = timings.get(name); values.push(milliseconds);
      if (values.length > limit) values.shift();
    },
    mark(id, stage, localTime) {
      if (!api.enabled || !validName(id) || !validName(stage)) return;
      const time = localTime ?? now(); if (!Number.isFinite(time) || time < 0) return;
      if (!traces.has(id)) {
        traces.set(id, new Map());
        if (traces.size > 128) traces.delete(traces.keys().next().value);
      }
      const trace = traces.get(id);
      if (trace.has(stage) || trace.size < 16) trace.set(stage, time);
    },
    measure(id, from, to, name) {
      if (!api.enabled) return;
      const trace = traces.get(id), start = trace?.get(from), end = trace?.get(to);
      if (start !== undefined && end !== undefined) api.observe(name, end - start);
    },
    // Remote summaries remain in their own clock scope, never merged into local
    // measurements. Only numeric aggregate fields survive this boundary.
    remote(name, report) {
      if (!api.enabled || !validName(name) || !report || (!remote.has(name) && remote.size >= 8)) return;
      const clean = {clock: 'remote-local', timings: {}, counters: {}, traces: []};
      for (const [metric, values] of Object.entries(report.timings || {}).slice(0, 64)) {
        if (validName(metric) && Number.isSafeInteger(values?.count) && values.count > 0 && values.count <= 480 &&
            ['p50', 'p95', 'p99', 'max'].every(key => validDuration(values[key]))) {
          clean.timings[metric] = Object.fromEntries(['count', 'p50', 'p95', 'p99', 'max'].map(key => [key, values[key]]));
        }
      }
      for (const [metric, value] of Object.entries(report.counters || {}).slice(0, 64)) {
        if (validName(metric) && Number.isSafeInteger(value) && value >= 0) clean.counters[metric] = value;
      }
      for (const trace of (Array.isArray(report.traces) ? report.traces : []).slice(-128)) {
        if (!validName(trace?.id)) continue;
        const stages = Object.fromEntries(Object.entries(trace.stages || {}).slice(0, 16)
          .filter(([stage, time]) => validName(stage) && Number.isFinite(time) && time >= 0));
        clean.traces.push({id: trace.id, stages});
      }
      remote.set(name, clean);
    },
    snapshot() {
      const summaries = {};
      for (const [name, values] of timings) {
        const sorted = [...values].sort((a, b) => a - b);
        summaries[name] = {count: sorted.length, p50: percentile(sorted, .5), p95: percentile(sorted, .95),
          p99: percentile(sorted, .99), max: sorted.at(-1)};
      }
      return {enabled: api.enabled, scope, clock: 'local-monotonic', units: 'milliseconds',
        timings: summaries, counters: Object.fromEntries(counters),
        traces: [...traces].map(([id, stages]) => ({id, stages: Object.fromEntries(stages)})),
        remote: Object.fromEntries(remote)};
    },
    clear() {timings.clear(); counters.clear(); traces.clear(); remote.clear();},
  };
  return api;
}

function registry(target) {
  if (!target.__weeDiagnostics) {
    const scopes = new Map(), clocks = new Map();
    target.__weeDiagnostics = {
      enabled: true,
      scope(name, now, clock) {
        if (clocks.get(name) !== clock && (scopes.has(name) || scopes.size < 24)) {
          scopes.set(name, createDiagnostics({enabled: true, scope: name, now})); clocks.set(name, clock);
        }
        return scopes.get(name) || createDiagnostics();
      },
      snapshot: () => ({notice: 'Local durations and RTT; not measured motion-to-screen latency.',
        scopes: Object.fromEntries([...scopes].map(([name, value]) => [name, value.snapshot()]))}),
      clear: () => {for (const value of scopes.values()) value.clear();},
    };
  }
  return target.__weeDiagnostics;
}

/** Open a room/standalone page with ?diagnostics=1. Inspect
 * window.__weeDiagnostics.snapshot() in devtools; normal play creates no panel. */
export function browserDiagnostics(scope, target = globalThis.window) {
  if (!target) return createDiagnostics();
  let owner = target, enabled = false;
  try {
    enabled = new URLSearchParams(target.location?.search).get('diagnostics') === '1';
    if (target.parent !== target && target.parent?.__weeDiagnostics?.enabled) {owner = target.parent; enabled = true;}
  } catch { /* A cross-origin parent cannot enable or read this diagnostic scope. */ }
  return enabled ? registry(owner).scope(scope, () => target.performance.now(), target.performance) : createDiagnostics();
}

/** Native developer opt-in: set globalThis.__WEE_DIAGNOSTICS__ = true before
 * opening the controller. No data is sent or stored until explicitly exported. */
export function nativeDiagnostics(scope, target = globalThis) {
  return target.__WEE_DIAGNOSTICS__ === true ? registry(target).scope(scope, () => target.performance.now(), target.performance) : createDiagnostics();
}
