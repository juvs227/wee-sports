import {SPORT_REGISTRY} from './sportRegistry.js';
export const CONTROLLER_PROTOCOL = Object.freeze({major: 4, minor: 1});
const features = ['motion', 'orientation', 'haptics', 'buttons'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const legacyCapabilities = () => ({protocol: {major: 4, minor: 0}, sports: {tennis: 1, bowling: 1},
  motion: false, orientation: false, haptics: false, buttons: true, legacy: true});
/** Missing declarations retain the supported legacy sports.
 * Optional haptics and sensors never block a touch-capable controller.
 */
export function negotiateControllerCapabilities(offer) {
  if (offer === undefined || offer === null) return {ok: true, capabilities: legacyCapabilities()};
  if (!record(offer) || !record(offer.protocol) || offer.protocol.major !== CONTROLLER_PROTOCOL.major ||
      !Number.isSafeInteger(offer.protocol.minor) || offer.protocol.minor < 0 || !record(offer.sports) ||
      Object.keys(offer.sports).length === 0 || Object.keys(offer.sports).length > 16 ||
      features.some(name => offer[name] !== undefined && typeof offer[name] !== 'boolean')) {
    return {ok: false, error: 'bad-capabilities'};
  }
  const sports = {};
  for (const [id, version] of Object.entries(offer.sports)) {
    if (!Number.isSafeInteger(version) || version < 1) return {ok: false, error: 'bad-capabilities'};
    if (Object.hasOwn(SPORT_REGISTRY, id) && version === SPORT_REGISTRY[id].controllerVersion) sports[id] = version;
  }
  if (!Object.keys(sports).length) return {ok: false, error: 'unsupported-sport'};
  const capabilities = {protocol: {major: CONTROLLER_PROTOCOL.major,
    minor: Math.min(offer.protocol.minor, CONTROLLER_PROTOCOL.minor)}, sports, legacy: false};
  for (const feature of features) capabilities[feature] = offer[feature] === true;
  if (!capabilities.buttons && !capabilities.motion) return {ok: false, error: 'bad-capabilities'};
  return {ok: true, capabilities};
}
export function supportsSport(capabilities, sport) {
  return Object.hasOwn(SPORT_REGISTRY, sport) && capabilities?.sports?.[sport] === SPORT_REGISTRY[sport].controllerVersion;
}
export function createControllerCapabilities({motion = false, orientation = false, haptics = false,
  buttons = true, sports = Object.keys(SPORT_REGISTRY)} = {}) {
  return {protocol: {...CONTROLLER_PROTOCOL}, sports: Object.fromEntries(sports.filter(id => Object.hasOwn(SPORT_REGISTRY, id))
    .map(id => [id, SPORT_REGISTRY[id].controllerVersion])), motion, orientation, haptics, buttons};
}
