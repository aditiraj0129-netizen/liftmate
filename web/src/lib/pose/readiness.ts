/**
 * "Get into position" check before counting starts.
 * Tells the user exactly what to fix: step into view, step back (which body part is missing),
 * turn sideways / face the camera, or get into the start position.
 */
import { bestSide, distance, Frame, J, Joint, p, vis } from "./geometry";
import { Engine, isHorizontal, Lang } from "./engines";

export type Readiness = { ok: boolean; key: string; message: string };

const PART: Record<Joint, { en: string; hi: string }> = {
  ankle: { en: "feet", hi: "पैर" },
  knee: { en: "knees", hi: "घुटने" },
  hip: { en: "hips", hi: "हिप्स" },
  wrist: { en: "hands", hi: "हाथ" },
  elbow: { en: "elbows", hi: "कोहनियाँ" },
  shoulder: { en: "shoulders", hi: "कंधे" },
};

export const READY_TEXT = {
  intro: { en: "Get into position. Counting starts when your position looks right.", hi: "पोज़ीशन में आओ। पोज़ीशन सही होते ही गिनती शुरू होगी।" },
  noPerson: { en: "I can't see you yet. Step in front of the camera.", hi: "अभी तुम दिख नहीं रहे, कैमरे के सामने आओ।" },
  turnSide: { en: "Turn sideways to the camera.", hi: "कैमरे की तरफ साइड से खड़े हो जाओ।" },
  faceCamera: { en: "Face the camera.", hi: "कैमरे की तरफ मुँह करो।" },
  ready: { en: "Perfect position. Go when you're ready!", hi: "बढ़िया पोज़ीशन। जब तैयार हो, शुरू करो!" },
  go: { en: "Perfect. Stay there. Let's start!", hi: "बढ़िया, ऐसे ही रहो। चलो शुरू करते हैं!" },
  waiting: { en: "Take your time. I'll start counting as soon as you're in position.", hi: "आराम से। सही पोज़ीशन में आते ही गिनती शुरू होगी।" },
  lost: { en: "I lost you. Step back into view.", hi: "तुम फ्रेम से बाहर हो गए, वापस आओ।" },
};

export function stepBackText(part: Joint, lang: Lang) {
  return lang === "hi" ? `थोड़ा पीछे जाओ, ${PART[part].hi} नहीं दिख रहे।` : `Step back, I can't see your ${PART[part].en}.`;
}

export function checkReadiness(engine: Engine, f: Frame | null, lang: Lang): Readiness {
  if (!f) return { ok: false, key: "noPerson", message: READY_TEXT.noPerson[lang] };

  const s = bestSide(f, engine.joints);
  const missing = engine.joints.find((j) => vis(f.lm[J[j][s]]) < 0.6);
  if (missing) return { ok: false, key: `missing_${missing}`, message: stepBackText(missing, lang) };

  // Side or front view? Compare shoulder width to torso length.
  const left = p(f, "shoulder", 0), right = p(f, "shoulder", 1);
  const sh = p(f, "shoulder", s), hp = p(f, "hip", s);
  const torsoLength = distance(sh, hp) || 1;
  const spread = Math.abs(left.x - right.x) / torsoLength;
  if (engine.view === "side" && engine.mode === "reps" && spread > 0.65) return { ok: false, key: "turnSide", message: READY_TEXT.turnSide[lang] };
  if (engine.view === "front" && spread < 0.35) return { ok: false, key: "faceCamera", message: READY_TEXT.faceCamera[lang] };

  if (engine.mode === "hold") {
    if (!isHorizontal(f, s)) return { ok: false, key: "start", message: engine.startHint[lang] };
    return { ok: true, key: "ready", message: READY_TEXT.ready[lang] };
  }

  if (!engine.anyStart) {
    const value = engine.metric(f, s);
    const span = engine.high - engine.low || 1;
    const progress = engine.start === "extended" ? (engine.high - value) / span : (value - engine.low) / span;
    if (progress > 0.2) return { ok: false, key: "start", message: engine.startHint[lang] };
  }
  return { ok: true, key: "ready", message: READY_TEXT.ready[lang] };
}
