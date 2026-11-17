import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hideLoading, nextPaint, setLoadingText, showLoading } from '../src/shell/loading';

const overlays = () => document.querySelectorAll('.loading-overlay');

describe('indicador de carga', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('muestra el aviso sobre #app con role=status y aria-busy', () => {
    showLoading('Opening wall.ifcx…');
    const el = document.querySelector<HTMLElement>('#app .loading-overlay')!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toContain('Opening wall.ifcx…');
    expect(el.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('setLoadingText actualiza el texto sin duplicar el aviso', () => {
    showLoading('Reading…');
    setLoadingText('Composing…');
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0].textContent).toContain('Composing…');
    expect(overlays()[0].textContent).not.toContain('Reading…');
  });

  it('hideLoading lo retira sin dejar nodos', () => {
    showLoading('x');
    hideLoading();
    expect(overlays()).toHaveLength(0);
    expect(document.getElementById('app')!.childElementCount).toBe(0);
  });

  it('llamar dos veces a showLoading no duplica; hideLoading sin aviso no falla', () => {
    showLoading('a');
    showLoading('b');
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0].textContent).toContain('b');
    hideLoading();
    hideLoading();
    expect(overlays()).toHaveLength(0);
    setLoadingText('nada'); // sin aviso: no hace nada
    expect(overlays()).toHaveLength(0);
  });

  it('el texto se inserta como texto, no como HTML', () => {
    showLoading('<img src=x onerror=alert(1)>.ifcx');
    expect(document.querySelector('.loading-overlay img')).toBeNull();
  });
});

describe('nextPaint', () => {
  it('espera dos fotogramas', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    let listo = false;
    const p = nextPaint().then(() => (listo = true));
    frames.shift()!(0);
    await Promise.resolve();
    expect(listo).toBe(false);
    frames.shift()!(0);
    await p;
    expect(listo).toBe(true);
    vi.unstubAllGlobals();
  });

  it('no se queda esperando si la ventana no pinta (rAF detenido)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    let listo = false;
    void nextPaint().then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(300);
    expect(listo).toBe(true);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
