/**
 * The playback speed ladder, spanning the three orders of magnitude the
 * machines need: a backyard stroke wants 0.05× to be readable, a siege
 * engine's long flight wants 3× to get past.
 *
 * Shared by the speed picker's chips and the transport's −/+ steppers, which
 * walk the same rungs — and living here rather than in either component file
 * because react-refresh requires component modules to export only components.
 */
export const SPEED_STOPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3]
