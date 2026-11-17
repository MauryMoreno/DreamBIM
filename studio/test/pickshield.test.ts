import { beforeEach, describe, expect, it } from 'vitest';
import { setPickShield } from '../src/schedule/pickshield';

beforeEach(() => {
  document.body.innerHTML =
    '<div id="app"><div id="ribbon"></div><div id="main"><div id="left"></div><div id="center"><div id="tabs"></div><div id="view"><div id="canvas"></div></div><div id="bar"></div></div></div></div>' +
    '<div class="modal-scrim" id="dialog"></div><div id="toast"></div>';
});
const $ = (id: string) => document.getElementById(id)!;
const inert = () => [...document.querySelectorAll('[inert]')].map((e) => e.id).sort();

describe('escudo mientras se eligen elementos', () => {
  it('deja inerte y atenuado todo menos el modelo, su camino hasta el body y el modal comprimido', () => {
    setPickShield($('view'), true);
    expect(inert()).toEqual(['bar', 'left', 'ribbon', 'tabs', 'toast']);
    expect($('ribbon').classList.contains('is-pick-dim')).toBe(true);
    expect($('view').hasAttribute('inert')).toBe(false); // el modelo sigue activo
    expect($('canvas').hasAttribute('inert')).toBe(false);
    expect($('dialog').hasAttribute('inert')).toBe(false); // the compressed dialog also
    expect($('app').hasAttribute('inert')).toBe(false);
  });

  it('al apagarlo lo quita todo, y encenderlo dos veces no deja restos', () => {
    $('toast').setAttribute('inert', ''); // ya inerte por otra causa: no se toca
    setPickShield($('view'), true);
    setPickShield($('view'), true);
    setPickShield($('view'), false);
    expect(inert()).toEqual(['toast']);
    expect(document.querySelectorAll('.is-pick-dim')).toHaveLength(0);
  });
});
