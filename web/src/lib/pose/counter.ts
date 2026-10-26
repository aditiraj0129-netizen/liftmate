/**
 * Rep counter + form checker. Fed one pose frame at a time (20-30 per second).
 *
 * How a rep is counted (state machine):
 *   home  --leaves start position-->  out  --reaches turn-around point-->  turned  --back home-->  rep +1
 * Coming back home without reaching the turn-around point = a partial rep.
 * A full rep with a form mistake still counts, but as a "bad rep".
 *
 * Effort sensing:
 *  - Fatigue: the lifting half of each rep is timed. 30-50% slower than the first reps = close to failure.
 *  - Struggle: a rep that is grinding much longer than normal triggers motivation ("Come on, push!").
 *  - Idle: a long pause mid-set triggers a check-in.
 */
import { bestSide, distance, Frame, minVisibility, p } from "./geometry";
import { Engine, isHorizontal, Lang } from "./engines";

export type FrameResult = {
  visible: boolean;
  value: number | null;
  progress: number;
  repDone: boolean;
  repBad: boolean;
  badKey: string | null; // which rule made the rep bad
  partialDone: boolean;
  cueKey: string | null; // rule id or "partial" to speak right now
  struggle: boolean;
  idle: boolean;
  holding: boolean;
};

export type SetSummary = {
  reps: number;
  badReps: number;
  partial: number;
  formScore: number | null;
  rir: number | null;
  struggled: boolean;
  holdSeconds: number;
  goodPoints: string[];
  improvePoints: string[];
  cues: string[];
  repLog: RepInfo[];
};

export type RepInfo = { n: number; score: number; errors: string[]; seconds: number };

const RULE_FRAMES = 4; // a mistake must last this many frames in a row before we call it out
const EMA = 0.4;
const MIN_VISIBILITY = 0.5; // joints must be clearly seen (and inside the picture)
const CONFIRM_FRAMES = 2; // leaving / returning to the start must hold this many frames
const MIN_REP_MS = 450; // nobody does a real rep faster than this
const TURN_AT = 0.9; // share of the full range that counts as reaching the bottom / top
const MIN_TRAVEL = 0.15; // the moving body part must travel at least this share of torso length
const RESET_AFTER_LOST = 8; // frames out of view before the current rep is thrown away

export class RepCounter {
  reps = 0;
  badReps = 0;
  partial = 0;
  holdMs = 0;
  struggledOnce = false;
  private state: "home" | "out" | "turned" = "home";
  private smoothed: number | null = null;
  private maxProgress = 0;
  private outAt = 0;
  private turnAt = 0;
  private lastTime = 0;
  private lastActivity = 0;
  private struggleSaid = false;
  private idleSaid = false;
  private concentric: number[] = [];
  repLog: RepInfo[] = [];
  private repScores: number[] = [];
  private repFlags = new Set<string>();
  private setFlags = new Map<string, number>();
  private streak = new Map<string, number>();
  private recent: number[] = []; // last raw angles, for a median filter
  private lostFrames = 0;
  private pending = 0; // frames the next state change has been seen in a row
  private moverStart: { x: number; y: number; z: number } | null = null;
  private maxTravel = 0;

  constructor(public engine: Engine) {}

  update(f: Frame, now: number): FrameResult {
    const e = this.engine;
    const result: FrameResult = {
      visible: false, value: null, progress: 0, repDone: false, repBad: false, badKey: null,
      partialDone: false, cueKey: null, struggle: false, idle: false, holding: false,
    };
    const dt = this.lastTime ? Math.min(now - this.lastTime, 200) : 0;
    this.lastTime = now;
    if (!this.lastActivity) this.lastActivity = now;

    const s = bestSide(f, e.joints);
    if (minVisibility(f, e.joints, s) < MIN_VISIBILITY) {
      // Out of view: never count anything, and forget a half-finished rep after a moment.
      this.lostFrames += 1;
      if (this.lostFrames > RESET_AFTER_LOST) this.resetRep();
      return result;
    }
    this.lostFrames = 0;
    result.visible = true;

    // Median of the last 5 readings removes single-frame spikes, then smoothing removes jitter.
    this.recent.push(e.metric(f, s));
    if (this.recent.length > 5) this.recent.shift();
    const raw = [...this.recent].sort((x, y) => x - y)[Math.floor(this.recent.length / 2)];
    this.smoothed = this.smoothed === null ? raw : this.smoothed * (1 - EMA) + raw * EMA;
    const a = this.smoothed;
    result.value = Math.round(a);
    const span = e.high - e.low || 1;
    const progress = Math.max(0, Math.min(1.2, e.start === "extended" ? (e.high - a) / span : (a - e.low) / span));
    result.progress = progress;

    // Form rules (debounced so one shaky frame doesn't trigger a cue)
    for (const rule of e.rules) {
      const bad = rule.test(f, s, progress, a);
      const count = bad ? (this.streak.get(rule.id) ?? 0) + 1 : 0;
      this.streak.set(rule.id, count);
      if (count === RULE_FRAMES) {
        this.repFlags.add(rule.id);
        this.setFlags.set(rule.id, (this.setFlags.get(rule.id) ?? 0) + 1);
        result.cueKey = rule.id;
      }
    }

    if (e.mode === "hold") {
      const ruleActive = e.rules.some((r) => (this.streak.get(r.id) ?? 0) >= RULE_FRAMES);
      result.holding = isHorizontal(f, s) && !ruleActive;
      if (result.holding) this.holdMs += dt;
      return result;
    }

    // How far the moving body part has travelled since the rep started (in torso lengths).
    const mover = p(f, e.mover, s);
    const scale = this.bodyScale(f, s);
    if (this.state !== "home" && this.moverStart) {
      this.maxTravel = Math.max(this.maxTravel, distance(mover, { ...this.moverStart, v: 1 }) / scale);
    }
    const confirm = (condition: boolean) => {
      this.pending = condition ? this.pending + 1 : 0;
      if (this.pending >= CONFIRM_FRAMES) {
        this.pending = 0;
        return true;
      }
      return false;
    };

    switch (this.state) {
      case "home":
        if (confirm(progress > 0.25)) {
          this.state = "out";
          this.outAt = now;
          this.maxProgress = progress;
          this.maxTravel = 0;
          this.moverStart = { x: mover.x, y: mover.y, z: mover.z };
          this.struggleSaid = false;
          this.idleSaid = false;
        } else if (progress <= 0.25) {
          this.moverStart = { x: mover.x, y: mover.y, z: mover.z };
          if (this.reps + this.partial > 0 && !this.idleSaid && now - this.lastActivity > 8000) {
            this.idleSaid = true;
            result.idle = true;
          }
        }
        break;
      case "out":
        this.maxProgress = Math.max(this.maxProgress, progress);
        if (progress >= TURN_AT) {
          // the bottom / top of a rep is often only a split second, so one frame is enough here
          this.state = "turned";
          this.turnAt = now;
          this.pending = 0;
        } else if (progress < 0.12 && confirm(true)) {
          const real = this.maxTravel >= MIN_TRAVEL && now - this.outAt >= MIN_REP_MS;
          if (real && this.maxProgress > 0.4) {
            this.partial += 1;
            result.partialDone = true;
            result.cueKey = result.cueKey ?? "partial";
            this.lastActivity = now;
          }
          this.resetRep();
        } else if (progress >= 0.12) {
          this.pending = 0;
        }
        break;
      case "turned":
        if (progress < 0.12 && confirm(true)) {
          const real = this.maxTravel >= MIN_TRAVEL && now - this.outAt >= MIN_REP_MS;
          if (!real) {
            this.resetRep(); // jitter, not a rep
            break;
          }
          this.reps += 1;
          result.repDone = true;
          const liftMs = e.concentric === "out" ? this.turnAt - this.outAt : now - this.turnAt;
          this.concentric.push(liftMs);
          const score = Math.max(40, 100 - 25 * this.repFlags.size);
          this.repScores.push(score);
          this.repLog.push({
            n: this.reps,
            score,
            errors: [...this.repFlags].map((id) => e.rules.find((r) => r.id === id)?.cue.en ?? id),
            seconds: Math.round(liftMs / 100) / 10,
          });
          if (this.repFlags.size > 0) {
            this.badReps += 1;
            result.repBad = true;
            result.badKey = [...this.repFlags][0];
          }
          this.resetRep();
          this.lastActivity = now;
        } else if (progress >= 0.12) {
          this.pending = 0;
        }
        break;
    }

    // Struggle: the lifting half of this rep is taking far longer than normal
    const lifting = (e.concentric === "out" && this.state === "out") || (e.concentric === "back" && this.state === "turned");
    if (lifting && !this.struggleSaid) {
      const startedAt = e.concentric === "out" ? this.outAt : this.turnAt;
      const base = this.concentric.length >= 2 ? (this.concentric[0] + this.concentric[1]) / 2 : 1500;
      if (now - startedAt > Math.max(1500, base * 1.5)) {
        this.struggleSaid = true;
        this.struggledOnce = true;
        result.struggle = true;
      }
    }
    return result;
  }

  private resetRep() {
    this.state = "home";
    this.pending = 0;
    this.maxProgress = 0;
    this.maxTravel = 0;
    this.repFlags.clear();
  }

  /** Torso length (or thigh length when the torso isn't the reference), used to judge real movement. */
  private bodyScale(f: Frame, s: number): number {
    const sh = p(f, "shoulder", s), hp = p(f, "hip", s), kn = p(f, "knee", s);
    if (sh.v >= 0.5 && hp.v >= 0.5) return distance(sh, hp) || 0.2;
    if (hp.v >= 0.5 && kn.v >= 0.5) return distance(hp, kn) * 1.2 || 0.2;
    return 0.25;
  }

  /** Estimated reps left in reserve from how much the lifting part has slowed down. */
  rir(): number | null {
    if (this.concentric.length < 3) return null;
    const base = (this.concentric[0] + this.concentric[1]) / 2;
    const last = this.concentric[this.concentric.length - 1];
    const ratio = last / (base || 1);
    if (ratio < 1.15) return 3;
    if (ratio < 1.3) return 2;
    if (ratio < 1.5) return 1;
    return 0;
  }

  summary(lang: Lang = "en"): SetSummary {
    const e = this.engine;
    const holdSeconds = Math.round(this.holdMs / 1000);
    const formScore = this.repScores.length
      ? Math.round(this.repScores.reduce((a, b) => a + b, 0) / this.repScores.length)
      : e.mode === "hold" && holdSeconds > 0
        ? Math.max(40, 100 - 10 * [...this.setFlags.values()].reduce((a, b) => a + b, 0))
        : null;
    const flagged = [...this.setFlags.entries()].sort((a, b) => b[1] - a[1]);
    const improve = flagged.map(([id]) => e.rules.find((r) => r.id === id)?.cue[lang] ?? id);
    if (this.partial > 0 && e.partialCue[lang]) {
      improve.push(lang === "hi" ? `${e.partialCue.hi} (${this.partial} आधे रेप)` : `${e.partialCue.en} (${this.partial} partial rep${this.partial > 1 ? "s" : ""})`);
    }
    const good = e.rules.filter((r) => !this.setFlags.has(r.id)).map((r) => r.good[lang]);
    if (e.mode === "reps" && this.reps > 0 && this.partial === 0) good.unshift(lang === "hi" ? "हर रेप पूरी रेंज में" : "Full range on every rep");
    const rir = this.rir();
    if (rir !== null && rir >= 1 && this.reps >= 5) good.push(lang === "hi" ? "कंट्रोल और स्थिर टेम्पो" : "Controlled, steady tempo");
    if (this.struggledOnce && this.reps > 0) good.push(lang === "hi" ? "मुश्किल रेप में भी हार नहीं मानी" : "Fought through a tough rep");
    return {
      reps: this.reps,
      badReps: this.badReps,
      partial: this.partial,
      formScore,
      rir,
      struggled: this.struggledOnce,
      holdSeconds,
      goodPoints: good.slice(0, 3),
      improvePoints: improve.slice(0, 3),
      cues: flagged.map(([id]) => e.rules.find((r) => r.id === id)?.cue.en ?? id),
      repLog: this.repLog,
    };
  }
}
