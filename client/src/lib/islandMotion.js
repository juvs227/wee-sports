// Animate the existing illustration in its own coordinates. No new raster art,
// re-encoding, scene geometry, or UI is involved. Coordinates are top-left UVs.
const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2(position.x * .5 + .5, .5 - position.y * .5);
  gl_Position = vec4(position, 0., 1.);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform sampler2D artwork;
uniform vec2 sourceSize;
uniform float time;
uniform float variant;
uniform float ocean;
uniform float strength;
uniform float u_crop;

float oval(vec2 p, vec2 center, vec2 radius) {
  return 1. - smoothstep(.65, 1., length((p - center) / radius));
}
float region(vec2 p, vec4 bounds, vec2 feather) {
  vec2 inside = smoothstep(bounds.xy - feather, bounds.xy, p)
    * (1. - smoothstep(bounds.zw, bounds.zw + feather, p));
  return inside.x * inside.y;
}
vec2 boat(vec2 p, vec4 bounds, vec2 pivot, float phase, float travel, out float mask) {
  // Include the old AND new boat positions in the rigid region. The feather
  // starts outside that region, so the sail never bends or leaves a duplicate.
  vec2 padding = vec2((travel + 2.) / sourceSize.x, 2. / sourceSize.y);
  mask = region(p, bounds + vec4(-padding, padding), vec2(.005, .010));
  vec2 local = (p - pivot) * sourceSize;
  float angle = sin(time * .55 + phase) * .0035 * strength;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 drift = vec2(sin(time * .18 + phase) * travel, sin(time * .70 + phase) * .75) * strength;
  return (rotation * (local - drift) - local) / sourceSize * mask;
}
void main() {
  bool landing = variant > .5;
  vec2 p = uv;
  if (ocean > .5) p.x = .5 + (p.x - .5) * u_crop;
  float horizon = landing ? .465 : .323;
  float sky = 1. - smoothstep(landing ? .335 : .205, landing ? .378 : .242, p.y);
  float edges = smoothstep(0., .025, p.x) * (1. - smoothstep(.975, 1., p.x));
  // Clouds travel horizontally. The camera and vertical framing never move.
  vec2 skyFlow = vec2(sin(time * .035) * 32., 0.)
    / sourceSize * sky * edges * strength;

  float sea = smoothstep(horizon, horizon + .025, p.y);
  float sides = max(1. - smoothstep(landing ? .135 : .145, landing ? .17 : .18, p.x),
    smoothstep(landing ? .835 : .825, landing ? .88 : .87, p.x));
  float bottom = smoothstep(landing ? .855 : .805, landing ? .89 : .845, p.y);
  float bay = landing ? oval(p, vec2(.55, .715), vec2(.115, .100))
    : oval(p, vec2(.565, .655), vec2(.085, .060));
  float water = sea * max(max(sides, bottom), bay);
  if (ocean > .5) water = sea;
  else if (landing) {
    // The landing has two foreground rock/flower islets outside the main
    // coast. Explicitly protect their foliage as well as their sandy edges.
    water *= 1. - region(p, vec4(.145, .718, .342, .840), vec2(.012, .018));
    water *= 1. - region(p, vec4(.675, .731, .846, .844), vec2(.012, .018));
  }

  float nearMask = 0.;
  float farMask = 0.;
  vec2 boatFlow = vec2(0.);
  if (ocean < .5) {
    boatFlow += boat(p, landing ? vec4(.700, .621, .738, .686) : vec4(.685, .645, .738, .740),
      landing ? vec2(.719, .678) : vec2(.712, .731), .4, 8., nearMask);
    boatFlow += boat(p, landing ? vec4(.199, .457, .219, .493) : vec4(.206, .327, .231, .378),
      landing ? vec2(.209, .489) : vec2(.218, .371), 2.5, 2.5, farMask);
  }
  water *= (1. - nearMask) * (1. - farMask);
  // Fixed water texture with passing reflected-light crests. No broad UV
  // wobble: large-screen scenery stays anchored while surface light travels.
  vec3 color = texture2D(artwork, p + skyFlow + boatFlow).rgb;
  float crest = pow(.5 + .5 * sin(p.y * 390. - time * 1.8 + sin(p.x * 35.) * 2.), 12.);
  float brokenLight = .25 + .75 * pow(.5 + .5 * sin(p.x * 190. + p.y * 70. + time * .38), 3.);
  float existingLight = smoothstep(.31, .72, dot(color, vec3(.21, .72, .07)));
  color = mix(color, vec3(.70, .96, 1.), crest * brokenLight * (.12 + existingLight * .16) * water * strength);

  if (ocean < .5) {
    // Animate light in the water column, never resample/warp the waterfall.
    // The original silhouette, rock lip, texture and pool keep their shape.
    vec4 fallBounds = landing ? vec4(.446, .473, .463, .505) : vec4(.437, .361, .454, .399);
    float fall = region(p, fallBounds, vec2(.001, .0025));
    vec2 fallUV = (p - fallBounds.xy) / (fallBounds.zw - fallBounds.xy);
    float strands = .30 + .70 * pow(.5 + .5 * sin(fallUV.x * 39. + sin(fallUV.x * 15.) * 2.), 3.);
    float drops = pow(.5 + .5 * sin(fallUV.y * 24. - time * 9. + fallUV.x * 7.), 5.);
    color = mix(color, vec3(.90, .99, 1.), fall * strands * drops * .58 * strength);
    vec2 pool = landing ? vec2(.454, .510) : vec2(.446, .405);
    float foam = oval(p, pool, vec2(.011, .005));
    float foamLight = .5 + .5 * sin(p.x * 1800. + time * 2.2) * sin(p.y * 2100. - time * 3.1);
    color = mix(color, vec3(.90, .99, 1.), foam * foamLight * .18 * strength);

    vec2 streamStart = landing ? vec2(.499, .566) : vec2(.504, .493);
    vec2 streamEnd = landing ? vec2(.533, .585) : vec2(.540, .529);
    vec2 line = streamEnd - streamStart;
    float along = clamp(dot(p - streamStart, line) / dot(line, line), 0., 1.);
    vec2 nearest = streamStart + line * along;
    float stream = (1. - smoothstep(.0015, .004, length(p - nearest)))
      * smoothstep(0., .15, along) * (1. - smoothstep(.8, 1., along));
    float streamCrest = pow(.5 + .5 * sin(along * 22. - time * 3.5), 5.);
    color = mix(color, vec3(.70, .96, 1.), stream * streamCrest * .22 * strength);
  }
  gl_FragColor = vec4(color, 1.);
}`;

/** Returns a renderer or null. The caller retains the original <img> fallback. */
export function createIslandMotion(canvas, image, {variant, ocean = false}) {
  let gl;
  try {
    gl = canvas.getContext('webgl', {alpha: true, antialias: false, depth: false,
      stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power'});
  } catch { return null; }
  if (!gl) return null;
  // A reset or unavailable frame must reveal the original image beneath it.
  gl.clearColor(0, 0, 0, 0);
  const resources = {shaders: []};
  const dispose = () => {
    if (resources.texture) gl.deleteTexture(resources.texture);
    if (resources.buffer) gl.deleteBuffer(resources.buffer);
    if (resources.program) gl.deleteProgram(resources.program);
    resources.shaders.forEach(shader => gl.deleteShader(shader));
  };
  try {
    const compile = (type, code) => {
      const shader = gl.createShader(type);
      resources.shaders.push(shader);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Island shader unavailable');
      return shader;
    };
    const program = resources.program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Island renderer unavailable');
    gl.useProgram(program);
    resources.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    resources.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const uniform = name => gl.getUniformLocation(program, name);
    gl.uniform1i(uniform('artwork'), 0);
    gl.uniform2f(uniform('sourceSize'), image.naturalWidth, image.naturalHeight);
    gl.uniform1f(uniform('variant'), variant === 'shore' ? 1 : 0);
    gl.uniform1f(uniform('ocean'), ocean ? 1 : 0);
    const clock = uniform('time');
    const strength = uniform('strength');
    const crop = uniform('u_crop');
    const maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const draw = seconds => {
      if (gl.isContextLost()) return false;
      gl.uniform1f(clock, seconds);
      // Ease into the effect from the exact still on every activation.
      gl.uniform1f(strength, Math.min(seconds / 1.2, 1));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    };
    return {
      resize(width, height, seconds = 0) {
        if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          gl.clear(gl.COLOR_BUFFER_BIT);
          return false;
        }
        // The two decorative layers used to each render up to 4K/Retina size
        // at 30 fps, although their artwork contains only ~1.6M source pixels.
        // Bound shader work to that source detail. CSS framing, the original
        // still and all interactive text remain at their normal resolution.
        const budget = Math.min(image.naturalWidth * image.naturalHeight, 1920 * 1080);
        const ratio = Math.min(window.devicePixelRatio || 1, 2,
          Math.sqrt(budget / (width * height)), maxSize / width, maxSize / height);
        const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
        // Match the centered ocean still: narrow windows crop its horizontal
        // edges instead of stretching clouds vertically. Island UVs stay fixed.
        gl.uniform1f(crop, ocean ? Math.min(1, width / height * image.naturalHeight / image.naturalWidth) : 1);
        // Changing either canvas dimension clears its buffer. Repaint in this
        // same callback, including recovery to an unchanged supported size.
        return draw(seconds);
      },
      draw,
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}
