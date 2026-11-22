/** Data-only registry usable by browser, native controller and room server. */
export const SPORT_REGISTRY = Object.freeze({tennis: Object.freeze({id: 'tennis', name: 'Tennis', players: Object.freeze({min: 1, max: 2}),
    soloModes: Object.freeze(['practice', 'bot']), input: 'swing', rulesVersion: 1, checkpointVersion: null,
    controllerVersion: 1, controllerCapabilities: Object.freeze(['buttons']), entry: '/game.html'}), bowling: Object.freeze({id: 'bowling', name: 'Bowling', players: Object.freeze({min: 1, max: 8}),
    soloModes: Object.freeze(['practice', 'match']), input: 'roll', rulesVersion: 1, checkpointVersion: 1,
    controllerVersion: 1, controllerCapabilities: Object.freeze(['buttons']), entry: '/bowling.html'})});
export const getSport = id => Object.hasOwn(SPORT_REGISTRY, id) ? SPORT_REGISTRY[id] : null;
