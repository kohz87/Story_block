// The standard widgets Story Block ships (SPEC §13.5), keyed by their namespaced names (`ss.<name>`,
// MODULES §F9), and the building blocks of Story Suite's look (ss.tile, ss.bar, ss.status, ss.pill).
// Each is `{ props, primary, render(el, props, api) → { update(props), destroy() }, validate(props) }`.

import { badge } from './badge.js';
import { bar, pill, status, tile } from './glass.js';
import { map } from './map.js';
import { meter } from './meter.js';
import { portrait } from './portrait.js';
import { radar } from './radar.js';
import { skillTree } from './skill-tree.js';
import { stepper } from './stepper.js';
import { timeline } from './timeline.js';

export const standardWidgets = Object.freeze({
    'ss.meter': meter,
    'ss.radar': radar,
    'ss.map': map,
    'ss.skill-tree': skillTree,
    'ss.portrait': portrait,
    'ss.badge': badge,
    'ss.timeline': timeline,
    'ss.stepper': stepper,
    // Story Suite's look (view/glass.css, the UI stage).
    'ss.tile': tile,
    'ss.bar': bar,
    'ss.status': status,
    'ss.pill': pill,
});

export { badge, bar, map, meter, pill, portrait, radar, skillTree, status, stepper, tile, timeline };
export { defineWidget, propProblems, resolveProps, unfoldValue } from './props.js';
export { ensureStyles, faClasses, safeImageUrl } from './dom.js';
export { widgetCss } from './styles.js';
