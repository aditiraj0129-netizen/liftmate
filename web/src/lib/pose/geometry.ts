/**
 * Body landmark maths.
 * MediaPipe gives two versions of the 33 body points:
 *  - image landmarks (x, y in 0..1 of the picture) -> used for "is it visible / in frame" and drawing
 *  - world landmarks (real 3D positions in metres)  -> used for angles, so an elbow bend measures the
 *    same whether you face the camera or stand side-on.
 */

export type Landmark = { x: number; y: number; z: number; visibility?: number };
/** aspect = video width / height. world = 3D landmarks for the same person (optional). */
export type Frame = { lm: Landmark[]; aspect: number; world?: Landmark[] };
export type Point = { x: number; y: number; z: number; v: number };

/** MediaPipe Pose landmark numbers, as [left, right] pairs. */
export const J = {
  shoulder: [11, 12],
  elbow: [13, 14],
  wrist: [15, 16],
  hip: [23, 24],
  knee: [25, 26],
  ankle: [27, 28],
} as const;

export type Joint = keyof typeof J;

/**
 * How sure we are that a landmark is really seen (0-1).
 * MediaPipe still "guesses" joints that are outside the camera frame; those guesses jump around
 * and cause fake reps, so anything outside the picture counts as not visible.
 */
export function vis(l: Landmark | undefined): number {
  if (!l) return 0;
  if (l.x < -0.02 || l.x > 1.02 || l.y < -0.02 || l.y > 1.02) return 0;
  return l.visibility ?? 1;
}

/** A joint on side s (0 = left, 1 = right). Uses 3D world position when available. */
export function p(f: Frame, joint: Joint, s: number): Point {
  const index = J[joint][s];
  const l = f.lm[index];
  const w = f.world?.[index];
  if (w) return { x: w.x, y: w.y, z: w.z, v: vis(l) };
  return { x: l.x * f.aspect, y: l.y, z: 0, v: vis(l) };
}

/** Angle ABC at point B, in degrees (0-180), in 3D. */
export function angle(a: Point, b: Point, c: Point): number {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const len = Math.hypot(v1[0], v1[1], v1[2]) * Math.hypot(v2[0], v2[1], v2[2]) || 1e-9;
  return (Math.acos(Math.max(-1, Math.min(1, dot / len))) * 180) / Math.PI;
}

/** How far the segment from `bottom` up to `top` leans away from straight up (0 = vertical). */
export function fromVerticalUp(top: Point, bottom: Point): number {
  const sideways = Math.hypot(top.x - bottom.x, top.z - bottom.z);
  return Math.abs((Math.atan2(sideways, bottom.y - top.y) * 180) / Math.PI);
}

/** How far the segment from `upper` down to `lower` leans away from straight down (0 = hanging straight). */
export function fromVerticalDown(upper: Point, lower: Point): number {
  const sideways = Math.hypot(lower.x - upper.x, lower.z - upper.z);
  return Math.abs((Math.atan2(sideways, lower.y - upper.y) * 180) / Math.PI);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Pick the body side the camera sees best for these joints. */
export function bestSide(f: Frame, joints: Joint[]): number {
  const score = (s: number) => joints.reduce((sum, j) => sum + vis(f.lm[J[j][s]]), 0);
  return score(0) >= score(1) ? 0 : 1;
}

export function minVisibility(f: Frame, joints: Joint[], s: number): number {
  return Math.min(...joints.map((j) => vis(f.lm[J[j][s]])));
}

/** Lines to draw for the skeleton overlay. */
export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];
