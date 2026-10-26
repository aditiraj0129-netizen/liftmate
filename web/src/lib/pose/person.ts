/**
 * Crowded gym support: MediaPipe can see up to 3 people. We lock onto ONE person
 * (the biggest / closest at the moment they get into position) and then follow them,
 * ignoring anyone walking or training in the background.
 */
import { Landmark } from "./geometry";

type Track = { x: number; y: number; size: number };

function describe(pose: Landmark[]): Track {
  const ids = [11, 12, 23, 24];
  const x = ids.reduce((s, i) => s + pose[i].x, 0) / ids.length;
  const y = ids.reduce((s, i) => s + pose[i].y, 0) / ids.length;
  const visible = pose.filter((l) => (l.visibility ?? 1) > 0.4);
  const ys = (visible.length ? visible : pose).map((l) => l.y);
  const xs = (visible.length ? visible : pose).map((l) => l.x);
  const size = Math.max(Math.max(...ys) - Math.min(...ys), Math.max(...xs) - Math.min(...xs));
  return { x, y, size };
}

export class PersonTracker {
  private target: Track | null = null;
  private lostSince = 0;
  locked = false;

  /** Biggest person in view (used before locking). */
  static biggest(poses: Landmark[][]): Landmark[] | undefined {
    let best: Landmark[] | undefined;
    let bestScore = -1;
    for (const pose of poses) {
      const t = describe(pose);
      const centred = 1 - Math.min(1, Math.abs(t.x - 0.5) * 2); // small bonus for being near the middle
      const score = t.size + centred * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = pose;
      }
    }
    return best;
  }

  lock(pose: Landmark[]) {
    this.target = describe(pose);
    this.locked = true;
    this.lostSince = 0;
  }

  unlock() {
    this.target = null;
    this.locked = false;
  }

  /** Pick our person from this frame. Returns undefined if they are not in view. */
  pick(poses: Landmark[][], now: number): Landmark[] | undefined {
    if (!this.locked || !this.target) return PersonTracker.biggest(poses);
    let best: Landmark[] | undefined;
    let bestDistance = Infinity;
    for (const pose of poses) {
      const t = describe(pose);
      const sizeRatio = t.size / (this.target.size || 1);
      if (sizeRatio < 0.5 || sizeRatio > 2) continue; // very different size = someone else
      const distance = Math.hypot(t.x - this.target.x, t.y - this.target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pose;
      }
    }
    if (best && bestDistance < 0.3) {
      const t = describe(best);
      // follow slowly so a passer-by can't "steal" the lock
      this.target = { x: this.target.x * 0.7 + t.x * 0.3, y: this.target.y * 0.7 + t.y * 0.3, size: this.target.size * 0.9 + t.size * 0.1 };
      this.lostSince = 0;
      return best;
    }
    if (!this.lostSince) this.lostSince = now;
    return undefined;
  }

  /** How long our person has been out of view (ms). */
  lostFor(now: number) {
    return this.lostSince ? now - this.lostSince : 0;
  }
}
