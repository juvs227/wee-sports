export function validAimX(value) {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1);
}

export function validPower(value) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}
