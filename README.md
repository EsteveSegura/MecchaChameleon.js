# MecchaChameleon.js

A tiny WebGL overlay that lights a 2D figure from a **normal map** (relief +
specular highlights) and floats it above your page. It's **non-interactive**
(`pointer-events: none`) — purely visual. Optionally it can paint the real page
behind the figure with a live **brush** effect and overlay a **shadow** texture.

Zero dependencies. Ships as native **ESM** (`import`) and **CommonJS/UMD**
(`require` and `<script>`), and is **tree-shakeable** (`"sideEffects": false`,
no top-level side effects). No images are bundled — you provide your own.

## Install

```bash
npm install meccha-chameleon
```

```js
import MecchaChameleon from 'meccha-chameleon';

MecchaChameleon.mount({
  image: 'figure.png',           // base color PNG (with alpha)
  normalMap: 'figure-normal.png',// normal map aligned to the figure
  target: '#hero', width: 200    // anchor the figure over #hero
});
```

Named imports also work:

```js
import { mount, update, unmount } from 'meccha-chameleon';
```

### Batteries-included presets (optional)

Don't have a figure yet? Import a ready-made preset — the images come embedded
as data URIs, so there's nothing to copy into `public/`, no bundler asset
config, and no `file://` / CORS texture issues:

```js
import MecchaChameleon from 'meccha-chameleon';
import mecha1 from 'meccha-chameleon/presets/mecha1';

MecchaChameleon.mount({ ...mecha1, target: '#hero' });
```

Presets are **separate modules**: importing the core library never pulls them
in, so they stay tree-shakeable. A bundler only ships a preset's images if you
actually import that subpath (verified: a core-only build is ~20 KB; adding the
preset adds ~2.5 MB — nothing in between).

Or with a plain script tag (global `MecchaChameleon`):

```html
<script src="https://unpkg.com/meccha-chameleon"></script>
<script>
  MecchaChameleon.mount({ image: 'figure.png', normalMap: 'figure-normal.png' });
</script>
```

> **WebGL note:** browsers will not load textures from `file://`. Serve your
> page over HTTP (`npx http-server`, Vite, etc.).

## API

- `MecchaChameleon.mount(config)` — create the overlay.
- `MecchaChameleon.update(partialConfig)` — change parameters **live** (light,
  opacity, shadow, target…). Structural changes (`brush` and brush params) need
  a fresh `mount()`.
- `MecchaChameleon.unmount()` — remove it and detach all listeners.

## Config

Two assets are **required**: `image` (base color) and `normalMap`.

| Key | Default | What it does |
|-----|---------|--------------|
| `image` | — | Base color PNG (with alpha). **Required.** |
| `normalMap` | — | Normal map, same framing as the figure. **Required.** |
| `target` | `null` | CSS selector (`#id`/`.class`) the figure is centered over. It tracks the element on scroll/resize. `null` or a missing element falls back to the viewport center. |
| `width` | `200` | Width in px (height keeps the image aspect). |
| `animateLight` | `true` | Light orbits on its own. |
| `lightIntensity` | `1.35` | Light intensity. |
| `ambient` | `0.22` | Fill light (0 = black shadows). |
| `specularStrength` | `0.75` | Specular strength. |
| `specularHardness` | `22` | Specular hardness (higher = smaller highlight). |
| `relief` | `1.4` | Exaggerates the normal map. |
| `lightZ` | `0.65` | Light height (lower = grazing = more relief). |
| `lightRadius` | `0.9` | Orbit radius. |
| `lightSpeed` | `0.35` | Orbit speed (turns/sec). |
| `lightAngle` | `-0.7` | Fixed light angle (rad) when `animateLight:false`. |
| `lightColor` | `'#ffffff'` | Light color. |
| `tint` | `null` | Hex color multiplied over the base. |
| `opacity` | `1` | Figure opacity. |
| `blendMode` | `'normal'` | Figure `mix-blend-mode`. |
| `brush` | `false` | Paint the real background inside the silhouette. |
| `brushStrength` | `14` | Smear strength (px). |
| `brushPosterize` | `5` | Color levels per channel (paint patches). 0 = off. |
| `brushGrain` | `0.35` | Canvas/bristle grain (0–1). |
| `brushUsesNormalMap` | `false` | `true` = rigid glass-like refraction following the shape. |
| `shadow` | `null` | Shadow texture PNG (aligned to the figure). |
| `shadowOpacity` | `0.6` | Shadow opacity. |
| `shadowBlendMode` | `'normal'` | Shadow `mix-blend-mode`. |

## Package layout

- `src/meccha-chameleon.mjs` — native ESM (used by `import` / bundlers).
- `src/meccha-chameleon.js` — CommonJS/UMD (used by `require` and CDN `<script>`).
- `src/presets/*` — optional ready-made figures with embedded images, imported
  on demand via `meccha-chameleon/presets/<name>`.

Only `src/` (plus README and LICENSE) is published; the playground itself is not
part of the package.

## Playground / config generator

`playground/index.html` is a visual editor: tune the sliders and it prints the
exact `MecchaChameleon.mount({...})` config for the current look, with a **Copy**
button. Serve it over HTTP:

```bash
npm run playground
# or: npx http-server -c-1 -o playground/
```

The playground uses local demo images under `playground/assets/` which are not
tracked in git. Drop your own `image`, `normalMap` and (optional) `shadow` PNGs
there to try the effect.

## Browser support

`brush` uses `backdrop-filter` + SVG filters — solid in Chromium/Safari; the
`url()` reference in `backdrop-filter` is weak in Firefox (the lit figure still
works, the painted background may not).

## License

MIT
