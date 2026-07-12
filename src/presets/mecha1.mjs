/**
 * MecchaChameleon preset: "mecha1" (pose 1) — ESM wrapper.
 * The data URIs live once in ./mecha1.js (CommonJS); this file re-exports them
 * so `import mecha1 from 'meccha-chameleon/presets/mecha1'` works. Importing
 * the main library never pulls this in, so it stays tree-shakeable.
 *
 *   import MecchaChameleon from 'meccha-chameleon';
 *   import mecha1 from 'meccha-chameleon/presets/mecha1';
 *   MecchaChameleon.mount({ ...mecha1, target: '#hero' });
 */
import mecha1 from './mecha1.js';

export const { image, normalMap, shadow } = mecha1;
export default mecha1;
