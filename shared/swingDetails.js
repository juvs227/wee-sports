/** Optional orientation is diagnostic metadata, never an input authorization. */
export function isNormalVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) &&
    value.every(component => Math.abs(component) <= 1.001) && Math.abs(Math.hypot(...value) - 1) <= .02;
}

/** Keep current placement options and PR 14's legacy two-vector call compatible.
 * Invalid values are preserved for isSwing to reject before any transport sends.
 */
export function copySwingDetails(details = {}, swingNormal) {
  const value = Array.isArray(details) ? {netNormal: details, swingNormal} : details ?? {};
  const result = {};
  for (const key of ['aim', 'depth', 'netNormal', 'swingNormal']) {
    if (value[key] !== undefined) result[key] = Array.isArray(value[key]) ? [...value[key]] : value[key];
  }
  return result;
}
