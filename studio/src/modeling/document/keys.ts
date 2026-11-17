import type { IfcxSchema } from '../../ifcx/types';

export const DOC_VERSION = 5;

/** Location line of the wall (constant for now). */
export const LOCATION_LINE = 'Wall Centerline';

export const CLASS_BASE = 'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/';

export const K_CLASS = 'bsi::ifc::class';

export const K_NAME = 'bsi::ifc::prop::Name';

export const K_DOC = 'ifcx-studio::document';

export const K_LEVEL = 'ifcx-studio::level';

export const K_WALL = 'ifcx-studio::wall';

export const K_FLOOR = 'ifcx-studio::floor';

export const K_STAIR = 'ifcx-studio::stair';

export const K_COMPOSER = 'ifcx-studio::composer';

/** Prefix of the name of the linked-file containers. */
export const CONTAINER_PREFIX = 'Linked · ';

export const uuid = () => crypto.randomUUID();

export const real = (quantityKind?: string) => ({ dataType: 'Real' as const, ...(quantityKind ? { quantityKind } : {}) });

export const point2 = {
  dataType: 'Array' as const,
  arrayRestrictions: { min: 2, max: 2, value: { dataType: 'Real' as const, quantityKind: 'Length' } },
};

/** Studio's own schemas, so that the file is self-describing. */
export const STUDIO_SCHEMAS: Record<string, IfcxSchema> = {
  [K_DOC]: {
    value: { dataType: 'Object', objectRestrictions: { values: { version: { dataType: 'Integer' } } } },
  },
  [K_COMPOSER]: { value: { dataType: 'Object' } },
  // Properties of the floors that the standard schema prop@v5a does not declare (a validating viewer requires them)
  'bsi::ifc::prop::PredefinedType': { value: { dataType: 'String' } },
  'bsi::ifc::prop::GrossArea': { value: real('Area') },
  'bsi::ifc::prop::Perimeter': { value: real('Length') },
  'bsi::ifc::prop::NumberOfRiser': { value: { dataType: 'Integer' } },
  'bsi::ifc::prop::NumberOfTreads': { value: { dataType: 'Integer' } },
  'bsi::ifc::prop::RiserHeight': { value: real('Length') },
  'bsi::ifc::prop::TreadLength': { value: real('Length') },
  'bsi::ifc::prop::Length': { value: real('Length') },
  'bsi::ifc::prop::Height': { value: real('Length') },
  [K_STAIR]: {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          base: { dataType: 'String' as const },
          top: { dataType: 'String' as const },
          shape: { dataType: 'String' as const },
          origin: point2,
          angle: real(),
          width: real('Length'),
          turn: { dataType: 'String' as const, optional: true },
        },
      },
    },
  },
  [K_LEVEL]: {
    value: { dataType: 'Object', objectRestrictions: { values: { elevation: real('Length') } } },
  },
  [K_FLOOR]: {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          boundary: { dataType: 'Array' as const, arrayRestrictions: { min: 3, value: point2 } },
          thickness: real('Length'),
          offset: real('Length'),
        },
      },
    },
  },
  [K_WALL]: {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          start: point2,
          end: point2,
          thickness: real('Length'),
          height: real('Length'),
          baseOffset: real('Length'),
          topOffset: real('Length'),
          topLevel: { dataType: 'String' as const, optional: true },
          locationLine: { dataType: 'String' as const, optional: true },
        },
      },
    },
  },
};

export const cls = (code: string) => ({ [K_CLASS]: { code, uri: CLASS_BASE + code } });
