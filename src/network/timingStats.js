/** Bounded same-clock durations. Never subtract clocks from different devices. */
export function createTimingStats(limit = 40) {
  const values = [];
  const capacity = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 40;
  return {
    add(value) {
      if (!Number.isFinite(value) || value < 0 || value > 10000) return;
      values.push(value);
      if (values.length > capacity) values.shift();
    },
    summary() {
      if (!values.length) return null;
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
      return { count: values.length, median, p95: ordered[Math.ceil(ordered.length * .95) - 1] };
    },
    clear() { values.length = 0; },
  };
}
