/**
 * MecchaChameleon  —  WebGL engine (native ESM build)
 * Drops a figure onto the page as a visual overlay and lights it in 3D from a
 * normal map (relief, diffuse + specular). Optional brush-painted background
 * and shadow texture. Non-interactive (visual only).
 *
 * This is the ESM entry point (`import`). It has NO top-level side effects, so
 * with "sideEffects": false in package.json bundlers can tree-shake it away
 * when unused. The CommonJS/UMD build (for `require` and <script> CDN usage)
 * lives in ./meccha-chameleon.js and is kept in sync with this file.
 *
 * Browser-only: mount() touches the DOM, so call it on the client.
 *
 *   import MecchaChameleon from 'meccha-chameleon';
 *   MecchaChameleon.mount({ image:'figure.png', normalMap:'figure-normal.png', target:'#hero' });
 *
 * NOTE: WebGL cannot load textures from file://. Serve the page over HTTP.
 */

const DEFAULTS = {
  image: null,           // (REQUIRED) base color PNG (with alpha)
  normalMap: null,       // (REQUIRED) normal map aligned to the figure

  target: null,          // CSS selector (#id / .class) the figure is anchored to
                         //   (centered over that element). Falls back to the
                         //   viewport center when null or the element is missing.
  width: 200,            // width in px (height keeps the image aspect ratio)

  // --- Light ---
  animateLight: false,    // the light orbits on its own
  lightSpeed: 0.35,      // turns per second
  lightRadius: 0.35,      // orbit radius (0..~1.5)
  lightAngle: -0.7,      // fixed angle (rad) when animateLight = false
  lightZ: 1.4,          // light height/closeness (lower = grazing = more relief)
  lightColor: '#ffffff',
  lightIntensity: 0.45,

  ambient: 0.22,         // fill light (0 = black shadows)
  specularStrength: 0.75,// highlight strength
  specularHardness: 22,  // highlight size (higher = smaller spot)

  relief: 1,           // exaggerates the normal map (1 = as-is)
  tint: null,            // hex color multiplied over the base color (e.g. '#8fd0ff')

  // --- Brush-painted background (CSS layer beneath the figure) ---
  brush: true,          // paints the real background inside the silhouette
  brushUsesNormalMap: false, // true = rigid refraction following the shape (glass);
                         //         false = noise smear (brush strokes, more "painted")
  brushStrength: 24,     // smear/displacement in px (the stroke drags the background)
  brushFrequency: 0.03,  // stroke size: lower = thicker stroke
  brushOctaves: 2,
  brushBlur: 1.0,        // blur in px -> wet-paint look
  brushPosterize: 17,     // tones per channel (flattens color into patches). 0 = off
  brushGrain: 0.1,      // canvas/bristle texture (0 = smooth, 1 = strong)
  brushSaturation: 1.25,
  brushContrast: 1.08,

  // --- Figure layer ---
  opacity: 0.2,            // lower (e.g. 0.5) to see the painted background through the figure
  blendMode: 'normal',   // canvas mix-blend-mode ('multiply', 'screen'...)

  // --- Shadow layer (PNG texture on top of everything) ---
  shadow: null,          // shadow PNG URL (transparent, aligned to the figure)
  shadowOpacity: 0.3,    // individual shadow opacity
  shadowBlendMode: 'normal', // shadow mix-blend-mode

  zIndex: 2147483000,
  id: 'meccha-chameleon-overlay'
};

const VERT =
  'attribute vec2 aPos;varying vec2 vUv;' +
  'void main(){vUv=vec2(aPos.x*0.5+0.5,1.0-(aPos.y*0.5+0.5));' +
  'gl_Position=vec4(aPos,0.0,1.0);}';

const FRAG =
  'precision mediump float;varying vec2 vUv;' +
  'uniform sampler2D uAlbedo;uniform sampler2D uNormal;' +
  'uniform vec3 uLightPos;uniform vec3 uLightColor;' +
  'uniform float uIntensity;uniform float uAmbient;' +
  'uniform float uSpecStrength;uniform float uShininess;' +
  'uniform float uRelief;uniform vec3 uTint;uniform float uUseTint;' +
  'void main(){' +
  ' vec4 albedo=texture2D(uAlbedo,vUv);' +
  ' if(albedo.a<0.01) discard;' +
  ' vec3 nTex=texture2D(uNormal,vUv).rgb*2.0-1.0;' +
  ' nTex.y=-nTex.y;' +               // flip G to screen space (y goes down)
  ' nTex.xy*=uRelief;' +
  ' vec3 N=normalize(nTex);' +
  ' vec3 fragPos=vec3(vUv*2.0-1.0,0.0);' +
  ' vec3 L=normalize(uLightPos-fragPos);' +
  ' vec3 V=vec3(0.0,0.0,1.0);' +
  ' vec3 H=normalize(L+V);' +
  ' float diff=max(dot(N,L),0.0);' +
  ' float spec=pow(max(dot(N,H),0.0),uShininess)*uSpecStrength;' +
  ' vec3 base=albedo.rgb;' +
  ' if(uUseTint>0.5) base*=uTint;' +
  ' vec3 color=base*(uAmbient+diff*uLightColor*uIntensity)+spec*uLightColor;' +
  ' gl_FragColor=vec4(color,albedo.a);' +
  '}';

function hexRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Injects the SVG <filter> that PAINTS the real background (brush effect):
// noise smear -> blur -> posterize (color patches) -> canvas grain.
function createBrushFilter(cfg, uid) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  Object.assign(svg.style, { position: 'absolute', width: '0', height: '0', overflow: 'hidden' });
  const f = document.createElementNS(NS, 'filter');
  const fid = 'meccha-chameleon-brush-' + uid;
  f.setAttribute('id', fid);
  f.setAttribute('x', '-20%'); f.setAttribute('y', '-20%');
  f.setAttribute('width', '140%'); f.setAttribute('height', '140%');
  f.setAttribute('color-interpolation-filters', 'sRGB');

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    f.appendChild(e);
    return e;
  }
  function transfer(inName, out, slope, intercept, discreteTable) {
    const ct = el('feComponentTransfer', { in: inName, result: out });
    ['feFuncR', 'feFuncG', 'feFuncB'].forEach(function (fn) {
      const fe = document.createElementNS(NS, fn);
      if (discreteTable) { fe.setAttribute('type', 'discrete'); fe.setAttribute('tableValues', discreteTable); }
      else { fe.setAttribute('type', 'linear'); fe.setAttribute('slope', slope); fe.setAttribute('intercept', intercept); }
      ct.appendChild(fe);
    });
    return ct;
  }

  // 1) Smear map: coarse noise (brush strokes) or normal map (rigid refraction).
  if (cfg.brushUsesNormalMap && cfg.normalMap) {
    const im = el('feImage', { x: '0', y: '0', width: '100%', height: '100%',
      preserveAspectRatio: 'none', result: 'map' });
    im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', cfg.normalMap);
    im.setAttribute('href', cfg.normalMap);
  } else {
    el('feTurbulence', { type: 'fractalNoise',
      baseFrequency: cfg.brushFrequency + ' ' + cfg.brushFrequency,
      numOctaves: cfg.brushOctaves, seed: '7', stitchTiles: 'stitch', result: 'map' });
  }

  // 2) Displace the background (drags the texture like a brush stroke).
  el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map',
    scale: cfg.brushStrength, xChannelSelector: 'R', yChannelSelector: 'G', result: 'smear' });

  // 3) Blur to fuse into wet-paint strokes.
  el('feGaussianBlur', { in: 'smear', stdDeviation: cfg.brushBlur, result: 'soft' });

  let current = 'soft';

  // 4) Posterize: flattens color into flat patches (the essence of "painted").
  if (cfg.brushPosterize && cfg.brushPosterize > 1) {
    const n = Math.round(cfg.brushPosterize), tv = [];
    for (let i = 0; i < n; i++) tv.push((i / (n - 1)).toFixed(4));
    transfer('soft', 'post', null, null, tv.join(' '));
    current = 'post';
  }

  // 5) Canvas/bristle grain: fine gray noise multiplied on top.
  if (cfg.brushGrain && cfg.brushGrain > 0) {
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.7 0.7',
      numOctaves: '2', seed: '11', result: 'gn0' });
    // Noise -> opaque gray (RGB = luminance, alpha = 1), then compress its range.
    el('feColorMatrix', { in: 'gn0', type: 'matrix', result: 'gg',
      values: '0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1' });
    const g = cfg.brushGrain;
    transfer('gg', 'grain', String(g), String(1 - g)); // map [0,1] -> [1-g, 1] (mostly bright)
    el('feBlend', { mode: 'multiply', in: current, in2: 'grain', result: 'painted' });
    current = 'painted';
  }

  // Final output (ensures the active result is the last primitive).
  el('feOffset', { in: current, dx: '0', dy: '0' });

  svg.appendChild(f);
  document.body.appendChild(svg);
  return { svg, fid };
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[meccha-chameleon] shader:', gl.getShaderInfoLog(s));
  }
  return s;
}

function loadTexture(gl, url, cb) {
  const tex = gl.createTexture();
  const img = new Image();
  img.onload = function () {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    cb(tex, img.naturalWidth, img.naturalHeight);
  };
  img.onerror = function () { console.error('[meccha-chameleon] failed to load', url); };
  img.src = url;
  return tex;
}

let COUNTER = 0;

const MecchaChameleon = {
  _state: null,
  _raf: null,
  _canvas: null,
  _root: null,
  _svg: null,
  _shadow: null,
  _ro: null,
  _onReposition: null,

  mount(options) {
    this.unmount();
    const cfg = Object.assign({}, DEFAULTS, options || {});
    if (!cfg.image || !cfg.normalMap) {
      console.error('[meccha-chameleon] Missing "image" and/or "normalMap".');
      return this;
    }
    this._state = cfg;
    const self = this;
    const start = () => self._init(cfg);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else { start(); }
    return this;
  },

  _init(cfg) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const uid = ++COUNTER;
    const self = this;

    // Container above everything (non-interactive). Its left/top/position are
    // set by _place(), which anchors it to cfg.target (or the viewport center).
    const root = document.createElement('div');
    root.id = cfg.id;
    Object.assign(root.style, {
      width: cfg.width + 'px',
      transform: 'translate(-50%,-50%)',
      zIndex: String(cfg.zIndex),
      pointerEvents: 'none'
    });
    document.body.appendChild(root);
    this._root = root;

    // Anchor to the target selector now and keep it in sync as the page
    // scrolls / reflows / resizes.
    this._place();
    this._onReposition = () => self._place();
    window.addEventListener('resize', this._onReposition);
    window.addEventListener('scroll', this._onReposition, { passive: true, capture: true });
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onReposition);
      this._ro.observe(document.documentElement);
      const tgt = cfg.target && document.querySelector(cfg.target);
      if (tgt) this._ro.observe(tgt);
    }

    // Optional layer: the REAL background painted with the brush, clipped to the silhouette.
    if (cfg.brush) {
      const filter = createBrushFilter(cfg, uid);
      this._svg = filter.svg;
      const brushDiv = document.createElement('div');
      const bf = 'url(#' + filter.fid + ') saturate(' + cfg.brushSaturation + ') contrast(' + cfg.brushContrast + ')';
      const mask = 'url("' + cfg.image + '")';
      Object.assign(brushDiv.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none',
        WebkitBackdropFilter: bf, backdropFilter: bf,
        WebkitMaskImage: mask, maskImage: mask,
        WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat'
      });
      root.appendChild(brushDiv);
    }

    // Lit figure layer (WebGL), above the brush.
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'relative', display: 'block',
      width: '100%', height: 'auto',
      pointerEvents: 'none',
      opacity: String(cfg.opacity),
      mixBlendMode: cfg.blendMode
    });
    root.appendChild(canvas);
    this._canvas = canvas;

    // Shadow layer (PNG) on top of everything, with its own opacity and blend mode.
    if (cfg.shadow) {
      const shadow = document.createElement('img');
      shadow.src = cfg.shadow;
      shadow.alt = '';
      shadow.draggable = false;
      Object.assign(shadow.style, {
        position: 'absolute', left: '0', top: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none', userSelect: 'none',
        opacity: String(cfg.shadowOpacity),
        mixBlendMode: cfg.shadowBlendMode
      });
      root.appendChild(shadow);
      this._shadow = shadow;
    }

    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true })
          || canvas.getContext('experimental-webgl');
    if (!gl) { console.error('[meccha-chameleon] WebGL not available'); return; }

    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const U = {};
    ['uLightPos', 'uLightColor', 'uIntensity', 'uAmbient', 'uSpecStrength',
     'uShininess', 'uRelief', 'uTint', 'uUseTint', 'uAlbedo', 'uNormal']
      .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

    let ready = 0;
    const texA = loadTexture(gl, cfg.image, function (t, w, h) {
      // size the canvas to the image aspect ratio
      const height = Math.round(cfg.width * (h / w));
      canvas.style.height = height + 'px';
      canvas.width = Math.round(cfg.width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (++ready === 2) start();
    });
    const texN = loadTexture(gl, cfg.normalMap, function () {
      if (++ready === 2) start();
    });

    function start() {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA);
      gl.uniform1i(U.uAlbedo, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texN);
      gl.uniform1i(U.uNormal, 1);
      self._loop(gl, U);
    }
  },

  // Positions the root: centered over cfg.target, or the viewport center as
  // a fallback. Uses absolute (document) coords so it scrolls with the target,
  // and fixed coords for the viewport-center fallback.
  _place() {
    const cfg = this._state, root = this._root;
    if (!cfg || !root) return;
    const el = cfg.target ? document.querySelector(cfg.target) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      const sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
      root.style.position = 'absolute';
      root.style.left = (r.left + sx + r.width / 2) + 'px';
      root.style.top = (r.top + sy + r.height / 2) + 'px';
    } else {
      if (cfg.target) console.warn('[meccha-chameleon] target not found:', cfg.target);
      root.style.position = 'fixed';
      root.style.left = '50%';
      root.style.top = '50%';
    }
  },

  _loop(gl, U) {
    const self = this;
    function frame(ts) {
      const cfg = self._state;
      if (!cfg) return;
      const t = (ts || 0) / 1000;
      const ang = cfg.animateLight ? t * cfg.lightSpeed * Math.PI * 2 : cfg.lightAngle;
      gl.uniform3f(U.uLightPos, Math.cos(ang) * cfg.lightRadius, Math.sin(ang) * cfg.lightRadius, cfg.lightZ);
      const lc = hexRgb(cfg.lightColor);
      gl.uniform3f(U.uLightColor, lc[0], lc[1], lc[2]);
      gl.uniform1f(U.uIntensity, cfg.lightIntensity);
      gl.uniform1f(U.uAmbient, cfg.ambient);
      gl.uniform1f(U.uSpecStrength, cfg.specularStrength);
      gl.uniform1f(U.uShininess, cfg.specularHardness);
      gl.uniform1f(U.uRelief, cfg.relief);
      if (cfg.tint) { const tn = hexRgb(cfg.tint); gl.uniform3f(U.uTint, tn[0], tn[1], tn[2]); gl.uniform1f(U.uUseTint, 1); }
      else gl.uniform1f(U.uUseTint, 0);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      self._raf = requestAnimationFrame(frame);
    }
    this._raf = requestAnimationFrame(frame);
  },

  // Change parameters LIVE: MecchaChameleon.update({ lightIntensity: 2 })
  update(options) {
    if (this._state && options) {
      Object.assign(this._state, options);
      if (this._canvas) {
        if ('opacity' in options) this._canvas.style.opacity = String(options.opacity);
        if ('blendMode' in options) this._canvas.style.mixBlendMode = options.blendMode;
      }
      if (this._shadow) {
        if ('shadowOpacity' in options) this._shadow.style.opacity = String(options.shadowOpacity);
        if ('shadowBlendMode' in options) this._shadow.style.mixBlendMode = options.shadowBlendMode;
      }
      // Re-anchor when the target selector changes.
      if ('target' in options) this._place();
    }
    return this;
  },

  unmount() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._onReposition) {
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, { passive: true, capture: true });
    }
    if (this._ro) this._ro.disconnect();
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    if (this._svg && this._svg.parentNode) this._svg.parentNode.removeChild(this._svg);
    this._raf = this._canvas = this._root = this._svg = this._shadow = this._state = null;
    this._ro = this._onReposition = null;
    return this;
  }
};

// Named exports (convenience, statically analyzable) + default export.
export const mount = (options) => MecchaChameleon.mount(options);
export const update = (options) => MecchaChameleon.update(options);
export const unmount = () => MecchaChameleon.unmount();
export { MecchaChameleon };
export default MecchaChameleon;
