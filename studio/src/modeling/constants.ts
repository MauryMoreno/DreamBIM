/** Espesor por defecto de un muro, en metros. */
export const WALL_THICKNESS = 0.2;
/** Altura por defecto de un muro, en metros. */
export const WALL_HEIGHT = 3;
/** Maximum distance between ends to consider them the same joint, in meters. */
export const JOIN_TOLERANCE = 0.001;
/** Name of the generic wall type (with a dash "–"). */
export const WALL_TYPE_NAME = 'Basic Wall: Generic – 200mm';
/** Espesor por defecto de un suelo, en metros. */
export const FLOOR_THICKNESS = 0.3;
/** Name of the generic floor type. */
export const FLOOR_TYPE_NAME = 'Floor: Generic 300mm';
/** Name of the default level. */
export const LEVEL_NAME = 'Level 1';
/** Nombre de un proyecto sin guardar. */
export const UNTITLED = 'Untitled';
/** Maximum riser of a stair, in meters. */
export const STAIR_MAX_RISER = 0.178;
/** Huella de una escalera, en metros. */
export const STAIR_TREAD = 0.28;
/** Ancho por defecto de un tramo de escalera, en metros. */
export const STAIR_WIDTH = 1.1;
/** Minimum width of a flight, in meters. */
export const STAIR_MIN_WIDTH = 0.9;
/** Maximum width of a flight, in meters. */
export const STAIR_MAX_WIDTH = 2;
/** Gap between the two flights of a U-shaped stair, in meters. */
export const STAIR_GAP = 0.1;
/** Minimum depth of the clear zones at the foot and at the arrival, in meters. */
export const STAIR_CLEAR = 1.1;
/** Minimum clear height above each step, in meters. */
export const STAIR_HEADROOM = 2.05;
/** Maximum risers of a straight flight. */
export const STAIR_STRAIGHT_MAX_RISERS = 18;
/** Minimum height between the two levels of a stair, in meters. */
export const STAIR_MIN_RISE = 1;
/** Maximum height between the two levels of a stair, in meters. */
export const STAIR_MAX_RISE = 6;
/** Height of the protective railing, in meters. */
export const GUARD_HEIGHT = 1.02;
/** Altura del pasamanos de pared, en metros. */
export const HANDRAIL_HEIGHT = 0.86;
/** Thickness of the landing of a U-shaped stair, in meters. */
export const LANDING_THICKNESS = 0.2;
/** Side of the cell of the geometric review, in meters. */
export const REVIEW_CELL = 0.1;
/** Maximum travel to an exit to the outside, in meters. */
export const REVIEW_MAX_TRAVEL = 45;
/** Maximum travel to a stair on an upper level, in meters. */
export const REVIEW_MAX_TRAVEL_TO_STAIR = 30;
/** Minimum clear passage along the whole route, in meters. */
export const REVIEW_MIN_PASSAGE = 0.8;
/** Minimum clear passage of the common corridor, in meters. */
export const REVIEW_MIN_CORRIDOR = 1.2;
/** Minimum area of a room, in square meters. */
export const REVIEW_MIN_ROOM_AREA = 1.5;
/** Minimum height of a hosted piece for it to count as a door, in meters. */
export const DOOR_MIN_HEIGHT = 1.9;
