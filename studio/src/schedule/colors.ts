// Colors of the 4D. Numbers so as not to have color literals in strings (css-tokens.test.ts).
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** What is being built on the date of the slider. */
export const ACTIVE = hex(0xff8c1a);
/** What has not started yet, with Future → Ghost (painted with opacity 0.12). */
export const GHOST = hex(0x9aa4b2);
export const GHOST_OPACITY = 0.12;
/** What already belongs to the task while more elements are chosen for it (the rest goes in GHOST). */
export const PICKED = hex(0xffc400);
/** What is being demolished (Demolish tasks). */
export const DEMOLISH = hex(0xe5484d);
/** Obra temporal en pie: andamios, encofrados (tareas Temporary). */
export const TEMPORARY = hex(0x2bb3c0);
