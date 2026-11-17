import { describe, expect, it } from 'vitest';
import { apuDe, type ApuRule } from '../../Snowdon Towers Example/00_MANAGEMENT/generar_costos_estructura';

const AE = 'Acero estructural';
const HA = 'Hormigón armado';
const AG = 'Acero galvanizado';
const ARM = 'Acero de refuerzo fy 420 MPa';

const regla = (code: string, extra: Partial<ApuRule> = {}): ApuRule => ({
  code, description: code, unit: 'kg', price: 1,
  clasificacion: ['21-02 10'], ...extra,
});

const apus: ApuRule[] = [
  regla('EST-AE', { material: AE }),
  regla('EST-HA-ZAP', { clasificacion: ['21-01 10 10'], material: HA, producto: ['23-25 05 17'], unit: 'm³' }),
  regla('EST-HA-MUR', { clasificacion: ['21-01 20', '21-02 10'], material: HA, producto: ['23-25 30 24 11'], unit: 'm³' }),
  regla('EST-HA-LOS', { clasificacion: ['21-01 40', '21-02 10'], material: HA, producto: ['23-25 30 27'], unit: 'm³' }),
  regla('EST-HA-COL', { material: HA, producto: ['23-25 30 11 14 11'], unit: 'm³' }),
  regla('EST-HA-VIG', { material: HA, producto: ['23-25 30 11 14 14'], unit: 'm³' }),
  regla('EST-DECK', { material: AG, producto: ['23-25 30 27'], unit: 'm²' }),
  regla('EST-AG', { material: AG, producto: ['23-20 40 11'] }),
  regla('EST-PIL-PRE', { clasificacion: ['21-01 10 20 15'], material: HA, unit: 'm' }),
  regla('EST-ENC', { clasificacion: ['21-01 10 10'], material: HA, producto: ['23-25 05 17'], unit: 'm³' }),
  regla('EST-VIG-K', { material: AE, producto: ['23-25 30 11 14 14'], tipo: ['K-Series', 'LH-Series'] }),
  regla('EST-ARM', { clasificacion: ['21-01 40', '21-02 10'], material: ARM }),
  regla('EST-ANC', { material: AG, producto: ['23-20 40 11 11'], unit: 'u' }),
];

describe('apuDe', () => {
  it('columna W → EST-AE', () => {
    expect(apuDe({ code21: '21-02 10 10 10', material: AE, product23: '23-25 30 11 14 11',
      tipo: 'W Shapes-Column:W10x49' }, apus)?.code).toBe('EST-AE');
  });

  it('vigueta K con EST-VIG-K declarando ese producto → EST-VIG-K, no EST-AE', () => {
    expect(apuDe({ code21: '21-02 10 10 10', material: AE, product23: '23-25 30 11 14 14',
      tipo: 'K-Series Bar Joist-Angle Web:16K6' }, apus)?.code).toBe('EST-VIG-K');
  });

  it('concrete slab in basement → EST-HA-LOS', () => {
    expect(apuDe({ code21: '21-01 40 10', material: HA, product23: null }, apus)?.code).toBe('EST-HA-LOS');
  });

  it('elemento sin APU → null', () => {
    expect(apuDe({ code21: '99-99 99 99', material: 'Desconocido', product23: null }, apus)).toBeNull();
  });
});
