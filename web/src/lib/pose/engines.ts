/**
 * Exercise engines: one small config per movement pattern.
 * Each engine says which angle to track, where a rep turns around, which form rules to check,
 * how to coach each mistake (a short shout, then step-by-step fixes if it keeps happening),
 * and how to guide the user into the start position. Every spoken line exists in English and Hindi.
 *
 * Framing is lenient: for most exercises only head-to-knees must be visible.
 * If the feet are hidden, knee angle is estimated from the thigh direction.
 */
import { angle, distance, fromVerticalDown, fromVerticalUp, Frame, Joint, p } from "./geometry";

export type Lang = "en" | "hi";
export type Text = { en: string; hi: string };
const T = (en: string, hi: string): Text => ({ en, hi });

export type Rule = {
  id: string;
  cue: Text; // short shout the first time
  fixes: Text[]; // how to correct it, used when the mistake repeats
  good: Text; // shown after the set when the mistake never happened
  test: (f: Frame, s: number, progress: number, value: number) => boolean;
};

export type Engine = {
  id: string;
  mode: "reps" | "hold";
  view: "side" | "front" | "any";
  mover: Joint; // the body part that must really travel during a rep (stops fake reps from jitter)
  setupTip: Text;
  startHint: Text;
  anyStart?: boolean;
  joints: Joint[]; // must be visible
  metric: (f: Frame, s: number) => number;
  start: "extended" | "flexed";
  high: number;
  low: number;
  concentric: "out" | "back";
  partialCue: Text;
  partialFixes: Text[];
  rules: Rule[];
};

const visible = (f: Frame, joint: Joint, s: number) => p(f, joint, s).v >= 0.65;

/** Knee angle; if the ankle is out of frame, estimate it from how far the thigh has tilted. */
const knee = (f: Frame, s: number) =>
  visible(f, "ankle", s)
    ? angle(p(f, "hip", s), p(f, "knee", s), p(f, "ankle", s))
    : 180 - fromVerticalDown(p(f, "hip", s), p(f, "knee", s));
const kneeStrict = (f: Frame, s: number) => angle(p(f, "hip", s), p(f, "knee", s), p(f, "ankle", s));
const elbow = (f: Frame, s: number) => angle(p(f, "shoulder", s), p(f, "elbow", s), p(f, "wrist", s));
const hip = (f: Frame, s: number) => angle(p(f, "shoulder", s), p(f, "hip", s), p(f, "knee", s));
const torso = (f: Frame, s: number) => fromVerticalUp(p(f, "shoulder", s), p(f, "hip", s));
const upperArm = (f: Frame, s: number) => fromVerticalDown(p(f, "shoulder", s), p(f, "elbow", s));
/** Body line shoulder-hip-ankle (or knee if feet are out of frame). */
const bodyEnd = (f: Frame, s: number) => (visible(f, "ankle", s) ? p(f, "ankle", s) : p(f, "knee", s));
const bodyLine = (f: Frame, s: number) => angle(p(f, "shoulder", s), p(f, "hip", s), bodyEnd(f, s));

const leanRule = (limit: number, cue: Text, fixes: Text[], good: Text, minProgress = 0): Rule => ({
  id: "lean", cue, fixes, good,
  test: (f, s, progress) => progress >= minProgress && torso(f, s) > limit,
});

const elbowDrift = (limit: number, cue: Text, fixes: Text[]): Rule => ({
  id: "elbow_drift", cue, fixes,
  good: T("Elbows stayed in place", "कोहनियाँ अपनी जगह पर रहीं"),
  test: (f, s, progress) => progress > 0.3 && upperArm(f, s) > limit,
});

const HEAD_TO_KNEES = T("Phone 2-3 metres to your side. Head to knees in frame is enough.", "फ़ोन 2-3 मीटर साइड में रखो। सिर से घुटनों तक दिखना काफ़ी है।");
const UPPER_BODY = T("Face the phone or stand side-on, about 2 metres away. Head to hips in frame is enough.", "फ़ोन की तरफ मुँह करके या साइड से खड़े हो, 2 मीटर दूर। सिर से हिप्स तक दिखना काफ़ी है।");

export const ENGINES: Record<string, Engine> = {
  squat: {
    id: "squat", mode: "reps", view: "side", mover: "hip", setupTip: HEAD_TO_KNEES,
    startHint: T("Stand tall to start.", "शुरू करने के लिए सीधे खड़े हो जाओ।"),
    joints: ["shoulder", "hip", "knee"],
    metric: knee, start: "extended", high: 160, low: 100, concentric: "back",
    partialCue: T("Go a little deeper!", "थोड़ा और नीचे!"),
    partialFixes: [
      T("Sit down like into a low chair until your hips reach knee level.", "जैसे नीची कुर्सी पर बैठते हो, वैसे हिप्स घुटनों तक लाओ।"),
      T("Push your knees out as you go down, it opens space for depth.", "नीचे जाते हुए घुटने बाहर धकेलो, इससे गहराई आसानी से आएगी।"),
    ],
    rules: [leanRule(50, T("Chest up!", "छाती ऊपर!"), [
      T("Brace your core and keep your chest proud, eyes forward.", "कोर टाइट करो, छाती ऊपर, नज़र सामने।"),
      T("Sit your hips down between your heels, not back. If it keeps happening, take a little weight off.", "हिप्स एड़ियों के बीच नीचे बैठाओ, पीछे नहीं। बार-बार हो तो थोड़ा वज़न कम करो।"),
    ], T("Chest stayed up", "छाती ऊपर रही"), 0.6)],
  },
  pushup: {
    id: "pushup", mode: "reps", view: "side", mover: "shoulder",
    setupTip: T("Phone on the floor, 2 metres to your side. Head to knees in frame is enough.", "फ़ोन ज़मीन पर, 2 मीटर साइड में। सिर से घुटनों तक दिखना काफ़ी है।"),
    startHint: T("Get into the top of a push-up, arms straight.", "पुश-अप की ऊपर वाली पोज़ीशन में आओ, बाँहें सीधी।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "extended", high: 155, low: 95, concentric: "back",
    partialCue: T("Go lower!", "और नीचे!"),
    partialFixes: [
      T("Lower until your chest is a fist away from the floor, elbows slightly tucked.", "छाती ज़मीन से एक मुट्ठी दूर तक लाओ, कोहनियाँ थोड़ी अंदर।"),
      T("Slow down on the way down, count two seconds.", "नीचे धीरे जाओ, दो सेकंड गिनकर।"),
    ],
    rules: [{
      id: "hips", cue: T("Hips in line!", "हिप्स लाइन में!"),
      fixes: [
        T("Squeeze your glutes and pull your belly in, body straight like a plank.", "ग्लूट्स दबाओ और पेट अंदर, शरीर तख्ते जैसा सीधा।"),
        T("If your hips keep dropping, do a few reps on your knees with a straight body.", "हिप्स बार-बार गिर रहे हैं तो कुछ रेप्स घुटनों पर, शरीर सीधा रखकर करो।"),
      ],
      good: T("Straight body line", "शरीर एकदम सीधी लाइन में"),
      test: (f, s) => bodyLine(f, s) < 155,
    }],
  },
  curl: {
    id: "curl", mode: "reps", view: "any", mover: "wrist", setupTip: UPPER_BODY,
    startHint: T("Arms straight down by your sides.", "बाँहें सीधी नीचे, साइड में रखो।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "extended", high: 150, low: 60, concentric: "out",
    partialCue: T("Full range!", "पूरी रेंज!"),
    partialFixes: [
      T("Straighten your arms fully at the bottom and squeeze hard at the top.", "नीचे बाँहें पूरी सीधी करो और ऊपर ज़ोर से दबाओ।"),
      T("A full stretch at the bottom builds more muscle.", "नीचे पूरा खिंचाव ज़्यादा मसल बनाता है।"),
    ],
    rules: [
      elbowDrift(30, T("Pin your elbows!", "कोहनियाँ टिकाओ!"), [
        T("Glue your elbows to your ribs, only your forearms move.", "कोहनियाँ पसलियों से चिपकाओ, सिर्फ़ हाथ का निचला हिस्सा चले।"),
        T("Elbows still drifting? Go a little lighter so your biceps do the work.", "कोहनियाँ अब भी हिल रही हैं? थोड़ा हल्का वज़न लो ताकि बाइसेप्स काम करें।"),
      ]),
      leanRule(15, T("No swinging!", "झूलो मत!"), [
        T("Stand tall, squeeze your glutes, no rocking back.", "सीधे खड़े रहो, ग्लूट्स टाइट, पीछे मत झूलो।"),
        T("If you need to swing, the weight is too heavy. Go a bit lighter.", "झूलना पड़ रहा है तो वज़न ज़्यादा है, थोड़ा हल्का लो।"),
      ], T("No body swing", "शरीर स्थिर रहा")),
    ],
  },
  press_overhead: {
    id: "press_overhead", mode: "reps", view: "any", mover: "wrist",
    setupTip: UPPER_BODY,
    startHint: T("Weights at shoulder height.", "वज़न कंधों की ऊँचाई पर रखो।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "flexed", high: 155, low: 90, concentric: "out",
    partialCue: T("All the way up!", "पूरा ऊपर!"),
    partialFixes: [
      T("Lock your arms out overhead, biceps next to your ears.", "ऊपर बाँहें पूरी सीधी, बाइसेप्स कानों के पास।"),
      T("Push your head slightly forward through your arms at the top.", "ऊपर सिर को बाँहों के बीच थोड़ा आगे निकालो।"),
    ],
    rules: [leanRule(20, T("Don't lean back!", "पीछे मत झुको!"), [
      T("Squeeze your glutes and keep your ribs down, press straight up.", "ग्लूट्स टाइट और पसलियाँ नीचे, सीधा ऊपर प्रेस करो।"),
      T("Leaning back means it's heavy for now. Drop the weight a little.", "पीछे झुकना मतलब वज़न अभी भारी है, थोड़ा कम करो।"),
    ], T("Stayed upright", "सीधे खड़े रहे"))],
  },
  pulldown: {
    id: "pulldown", mode: "reps", view: "any", mover: "wrist", setupTip: UPPER_BODY,
    startHint: T("Arms straight up, holding the bar.", "बार पकड़कर बाँहें ऊपर सीधी रखो।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "extended", high: 150, low: 80, concentric: "out",
    partialCue: T("Pull to your chest!", "छाती तक खींचो!"),
    partialFixes: [
      T("Drive your elbows down until the bar touches your upper chest.", "कोहनियाँ नीचे खींचो जब तक बार ऊपरी छाती को छुए।"),
      T("Squeeze your shoulder blades down at the bottom.", "नीचे कंधों के ब्लेड नीचे दबाओ।"),
    ],
    rules: [leanRule(35, T("Sit taller!", "सीधे बैठो!"), [
      T("Lean back just a little, then pull your elbows down towards your pockets.", "बस हल्का सा पीछे झुको, फिर कोहनियाँ जेब की तरफ खींचो।"),
      T("Too much swing. Lighten the stack slightly.", "बहुत झूल रहे हो, थोड़ा वज़न कम करो।"),
    ], T("Controlled torso", "धड़ कंट्रोल में रहा"))],
  },
  leg_press: {
    id: "leg_press", mode: "reps", view: "side", mover: "knee",
    setupTip: T("Phone to the side of the machine, hips, knees and feet in frame.", "फ़ोन मशीन के साइड में, हिप्स, घुटने और पैर दिखें।"),
    startHint: T("Legs extended, knees soft.", "पैर सीधे, घुटने हल्के मुड़े हुए।"),
    joints: ["hip", "knee", "ankle"],
    metric: kneeStrict, start: "extended", high: 155, low: 95, concentric: "back",
    partialCue: T("Go deeper!", "और गहराई तक!"),
    partialFixes: [
      T("Bring your knees close to your chest while your lower back stays on the pad.", "घुटने छाती के पास लाओ, कमर पैड पर टिकी रहे।"),
      T("If your back lifts off the pad, that's your limit. Go just above it.", "कमर पैड से उठे तो वही लिमिट है, उससे थोड़ा ऊपर तक जाओ।"),
    ],
    rules: [{
      id: "lockout", cue: T("Don't lock your knees!", "घुटने लॉक मत करो!"),
      fixes: [
        T("Stop just before your knees lock, keep a tiny bend.", "घुटने लॉक होने से ठीक पहले रुको, हल्का मोड़ रखो।"),
        T("Control the top, never snap your knees straight.", "ऊपर कंट्रोल रखो, घुटने झटके से सीधे मत करो।"),
      ],
      good: T("Soft knees at the top", "ऊपर घुटने सुरक्षित रहे"),
      test: (f, s) => kneeStrict(f, s) > 176,
    }],
  },
  lunge: {
    id: "lunge", mode: "reps", view: "side", mover: "hip", setupTip: HEAD_TO_KNEES,
    startHint: T("Stand tall, feet hip-width apart.", "सीधे खड़े हो, पैर कमर जितने खुले।"),
    joints: ["shoulder", "hip", "knee"],
    metric: (f) => Math.min(knee(f, 0), knee(f, 1)), start: "extended", high: 160, low: 105, concentric: "back",
    partialCue: T("Lower!", "और नीचे!"),
    partialFixes: [
      T("Drop your back knee straight down towards the floor.", "पीछे वाला घुटना सीधे ज़मीन की तरफ लाओ।"),
      T("Take a slightly longer step for more depth.", "गहराई के लिए कदम थोड़ा लंबा करो।"),
    ],
    rules: [leanRule(30, T("Torso upright!", "धड़ सीधा!"), [
      T("Keep your chest tall and drop straight down like an elevator.", "छाती ऊपर, लिफ्ट की तरह सीधे नीचे जाओ।"),
      T("Take a shorter step if you keep tipping forward.", "आगे झुक रहे हो तो कदम थोड़ा छोटा करो।"),
    ], T("Upright torso", "धड़ सीधा रहा"))],
  },
  hinge: {
    id: "hinge", mode: "reps", view: "side", mover: "shoulder", anyStart: true, setupTip: HEAD_TO_KNEES,
    startHint: T("Set up at the bar.", "बार के पास पोज़ीशन लो।"),
    joints: ["shoulder", "hip", "knee"],
    metric: hip, start: "extended", high: 160, low: 110, concentric: "back",
    partialCue: T("Hips back more!", "हिप्स और पीछे!"),
    partialFixes: [
      T("Push your hips back like you're closing a car door with your butt.", "हिप्स पीछे धकेलो, जैसे पीछे से कार का दरवाज़ा बंद कर रहे हो।"),
      T("Keep a soft knee and feel the stretch in your hamstrings.", "घुटने हल्के मुड़े रखो और हैमस्ट्रिंग में खिंचाव महसूस करो।"),
    ],
    rules: [{
      id: "bar_far", cue: T("Bar close!", "बार पास!"),
      fixes: [
        T("Drag the bar along your legs, lats tight like squeezing oranges in your armpits.", "बार पैरों से सटाकर चलाओ, बगल में संतरे दबाने जैसा लैट्स टाइट।"),
        T("Start with the bar over the middle of your foot.", "शुरुआत में बार पैर के बीच के ऊपर रखो।"),
      ],
      good: T("Bar stayed close", "बार पास रहा"),
      test: (f, s, progress) => {
        if (!visible(f, "ankle", s) || !visible(f, "wrist", s)) return false;
        const legLength = Math.abs(p(f, "hip", s).y - p(f, "ankle", s).y) || 1;
        const wr = p(f, "wrist", s), an = p(f, "ankle", s);
        return progress > 0.5 && Math.hypot(wr.x - an.x, wr.z - an.z) / legLength > 0.45;
      },
    }],
  },
  lateral_raise: {
    id: "lateral_raise", mode: "reps", view: "front", mover: "elbow",
    setupTip: T("Face the phone, 2 metres away. Head to hips in frame is enough.", "फ़ोन की तरफ मुँह करो, 2 मीटर दूर। सिर से हिप्स तक दिखना काफ़ी है।"),
    startHint: T("Arms down by your sides.", "बाँहें नीचे साइड में रखो।"),
    joints: ["shoulder", "elbow", "hip"],
    metric: (f, s) => angle(p(f, "hip", s), p(f, "shoulder", s), p(f, "elbow", s)),
    start: "flexed", high: 80, low: 30, concentric: "out",
    partialCue: T("Up to shoulder height!", "कंधे तक उठाओ!"),
    partialFixes: [
      T("Raise until your arms are level with your shoulders.", "बाँहें कंधों की सीध तक उठाओ।"),
      T("Use a lighter weight to get the full range.", "पूरी रेंज के लिए हल्का वज़न लो।"),
    ],
    rules: [{
      id: "too_high", cue: T("Stop at shoulder height!", "कंधे पर रुको!"),
      fixes: [
        T("Lift only to shoulder height and lead with your elbows.", "सिर्फ़ कंधे की ऊँचाई तक उठाओ, कोहनियों से लीड करो।"),
        T("Above the shoulder your traps take over. Stop at the line.", "कंधे से ऊपर ट्रैप्स काम करने लगते हैं, वहीं रुको।"),
      ],
      good: T("Stopped at shoulder height", "कंधे की ऊँचाई पर रुके"),
      test: (f, s) => angle(p(f, "hip", s), p(f, "shoulder", s), p(f, "elbow", s)) > 110,
    }],
  },
  bench: {
    id: "bench", mode: "reps", view: "side", mover: "wrist",
    setupTip: T("Phone to your side at bench height, shoulders, elbows and wrists in frame.", "फ़ोन बेंच की ऊँचाई पर साइड में, कंधे, कोहनी और कलाई दिखें।"),
    startHint: T("Arms straight, weight over your chest.", "बाँहें सीधी, वज़न छाती के ऊपर।"),
    joints: ["shoulder", "elbow", "wrist"],
    metric: elbow, start: "extended", high: 150, low: 90, concentric: "back",
    partialCue: T("Touch your chest!", "छाती तक!"),
    partialFixes: [
      T("Bring the bar all the way down to touch your chest.", "बार को पूरा नीचे छाती तक लाओ।"),
      T("Lower slowly, touch, then drive up hard.", "धीरे नीचे, छाती छुओ, फिर ज़ोर से ऊपर।"),
    ],
    rules: [{
      id: "wrist_stack", cue: T("Wrists over elbows!", "कलाई कोहनी के ऊपर!"),
      fixes: [
        T("Stack your wrists straight over your elbows at the bottom.", "नीचे कलाई सीधे कोहनी के ऊपर रखो।"),
        T("Tuck your elbows a little, about 45 degrees from your body.", "कोहनियाँ थोड़ी अंदर, शरीर से लगभग 45 डिग्री।"),
      ],
      good: T("Wrists stacked over elbows", "कलाई कोहनी के ऊपर रहीं"),
      test: (f, s, progress) => progress > 0.6 && fromVerticalUp(p(f, "wrist", s), p(f, "elbow", s)) > 25,
    }],
  },
  pushdown: {
    id: "pushdown", mode: "reps", view: "any", mover: "wrist", setupTip: UPPER_BODY,
    startHint: T("Elbows at your sides, forearms up.", "कोहनियाँ साइड में, हाथ ऊपर।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "flexed", high: 155, low: 90, concentric: "out",
    partialCue: T("Straighten fully!", "पूरा सीधा!"),
    partialFixes: [
      T("Straighten your arms fully and squeeze your triceps at the bottom.", "बाँहें पूरी सीधी करके नीचे ट्राइसेप्स दबाओ।"),
      T("Pause one second at the bottom.", "नीचे एक सेकंड रुको।"),
    ],
    rules: [
      elbowDrift(25, T("Elbows tucked!", "कोहनियाँ अंदर!"), [
        T("Pin your elbows to your sides, only your forearms move.", "कोहनियाँ साइड में टिकाओ, सिर्फ़ हाथ चलें।"),
        T("If your elbows flare, the stack is heavy. Drop a plate.", "कोहनियाँ खुल रही हैं तो वज़न भारी है, एक प्लेट कम करो।"),
      ]),
      leanRule(30, T("Stand tall!", "सीधे खड़े!"), [
        T("Stand tall with only a slight forward lean.", "सीधे खड़े रहो, बस हल्का सा आगे झुकाव।"),
        T("Step a little closer to the cable.", "केबल के थोड़ा पास खड़े हो।"),
      ], T("Stood tall", "सीधे खड़े रहे")),
    ],
  },
  row_bent: {
    id: "row_bent", mode: "reps", view: "side", mover: "wrist", setupTip: HEAD_TO_KNEES,
    startHint: T("Hinge over, arms hanging straight.", "आगे झुको, बाँहें सीधी लटकी हुई।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "extended", high: 150, low: 85, concentric: "out",
    partialCue: T("Pull to your belly!", "पेट तक खींचो!"),
    partialFixes: [
      T("Pull the bar to your belly button, elbows past your body.", "बार नाभि तक खींचो, कोहनियाँ शरीर से पीछे तक।"),
      T("Squeeze your shoulder blades together at the top.", "ऊपर कंधों के ब्लेड आपस में दबाओ।"),
    ],
    rules: [{
      id: "stand_up", cue: T("Stay bent over!", "झुके रहो!"),
      fixes: [
        T("Keep your torso bent forward, hinge from your hips.", "धड़ आगे झुका रखो, हिप्स से झुको।"),
        T("Standing up means it's too heavy. Lighten it a bit.", "खड़े हो रहे हो मतलब वज़न भारी है, थोड़ा कम करो।"),
      ],
      good: T("Held the hinge", "झुकाव बना रहा"),
      test: (f, s) => torso(f, s) < 35,
    }],
  },
  row_seated: {
    id: "row_seated", mode: "reps", view: "side", mover: "wrist", setupTip: UPPER_BODY,
    startHint: T("Sit tall, arms straight forward.", "सीधे बैठो, बाँहें आगे सीधी।"),
    joints: ["shoulder", "elbow", "wrist", "hip"],
    metric: elbow, start: "extended", high: 150, low: 85, concentric: "out",
    partialCue: T("To your stomach!", "पेट तक!"),
    partialFixes: [
      T("Pull the handle to your stomach and squeeze your back.", "हैंडल पेट तक खींचो और पीठ दबाओ।"),
      T("Let your arms go fully straight before the next pull.", "अगले रेप से पहले बाँहें पूरी सीधी होने दो।"),
    ],
    rules: [leanRule(25, T("Torso still!", "धड़ स्थिर!"), [
      T("Sit tall and still, pull with your back, not your body.", "सीधे और स्थिर बैठो, पीठ से खींचो, शरीर से नहीं।"),
      T("Lighten it a little if you have to rock.", "हिलना पड़ रहा है तो थोड़ा वज़न कम करो।"),
    ], T("Torso stayed still", "धड़ स्थिर रहा"))],
  },
  leg_extension: {
    id: "leg_extension", mode: "reps", view: "side", mover: "ankle",
    setupTip: T("Phone to the side of the machine, hip, knee and ankle in frame.", "फ़ोन मशीन के साइड में, हिप, घुटना और टखना दिखें।"),
    startHint: T("Sit back, knees bent.", "पीछे टिककर बैठो, घुटने मुड़े।"),
    joints: ["hip", "knee", "ankle"],
    metric: kneeStrict, start: "flexed", high: 160, low: 95, concentric: "out",
    partialCue: T("Straighten fully!", "पूरा सीधा!"),
    partialFixes: [
      T("Straighten your legs fully and squeeze your quads at the top.", "पैर पूरे सीधे करो और ऊपर क्वाड्स दबाओ।"),
      T("Pause one second at the top.", "ऊपर एक सेकंड रुको।"),
    ],
    rules: [],
  },
  leg_curl: {
    id: "leg_curl", mode: "reps", view: "side", mover: "ankle",
    setupTip: T("Phone to the side of the machine, hip, knee and ankle in frame.", "फ़ोन मशीन के साइड में, हिप, घुटना और टखना दिखें।"),
    startHint: T("Legs straight to start.", "शुरू में पैर सीधे रखो।"),
    joints: ["hip", "knee", "ankle"],
    metric: kneeStrict, start: "extended", high: 155, low: 85, concentric: "out",
    partialCue: T("Heels closer!", "एड़ियाँ और पास!"),
    partialFixes: [
      T("Curl your heels all the way towards your glutes.", "एड़ियाँ पूरी ग्लूट्स की तरफ लाओ।"),
      T("Keep your hips pressed into the pad.", "हिप्स पैड पर दबाकर रखो।"),
    ],
    rules: [],
  },
  plank: {
    id: "plank", mode: "hold", view: "side", mover: "hip",
    setupTip: T("Phone on the floor, 2 metres to your side. Head to knees in frame is enough.", "फ़ोन ज़मीन पर, 2 मीटर साइड में। सिर से घुटनों तक दिखना काफ़ी है।"),
    startHint: T("Get into your plank.", "प्लैंक पोज़ीशन में आओ।"),
    joints: ["shoulder", "hip", "knee"],
    metric: bodyLine, start: "extended", high: 180, low: 150, concentric: "out",
    partialCue: T("", ""), partialFixes: [],
    rules: [
      {
        id: "sag", cue: T("Hips up!", "हिप्स ऊपर!"),
        fixes: [T("Squeeze your glutes and pull your belly in.", "ग्लूट्स दबाओ और पेट अंदर खींचो।"), T("Push the floor away with your elbows.", "कोहनियों से ज़मीन को दूर धकेलो।")],
        good: T("Hips never sagged", "हिप्स नहीं गिरे"),
        test: (f, s) => {
          const sh = p(f, "shoulder", s), hp = p(f, "hip", s), en = bodyEnd(f, s);
          const t = (hp.x - sh.x) / (en.x - sh.x || 1e-6);
          return hp.y - (sh.y + t * (en.y - sh.y)) > 0.15 * (distance(sh, hp) || 1);
        },
      },
      {
        id: "pike", cue: T("Hips down!", "हिप्स नीचे!"),
        fixes: [T("Lower your hips until you're one straight line.", "हिप्स नीचे करो, सिर से एड़ी तक एक लाइन।"), T("Look at the floor between your hands.", "हाथों के बीच ज़मीन पर देखो।")],
        good: T("No piking", "हिप्स ज़्यादा ऊपर नहीं गए"),
        test: (f, s) => {
          const sh = p(f, "shoulder", s), hp = p(f, "hip", s), en = bodyEnd(f, s);
          const t = (hp.x - sh.x) / (en.x - sh.x || 1e-6);
          return sh.y + t * (en.y - sh.y) - hp.y > 0.18 * (distance(sh, hp) || 1);
        },
      },
    ],
  },
};

/** Is the body roughly horizontal (needed for planks)? */
export const isHorizontal = (f: Frame, s: number) => fromVerticalUp(p(f, "shoulder", s), bodyEnd(f, s)) > 50;

/** Short cue text. key = a rule id, or "partial". */
export function cueText(engine: Engine, key: string, lang: Lang): string {
  if (key === "partial") return engine.partialCue[lang];
  return engine.rules.find((r) => r.id === key)?.cue[lang] ?? "";
}

/**
 * What to say for a mistake, depending on how many times it has happened this set:
 * 1st time = short cue, 2nd = how to fix it, 3rd+ = the next fix tip (then they alternate).
 */
export function guidance(engine: Engine, key: string, times: number, lang: Lang): string {
  const fixes = key === "partial" ? engine.partialFixes : engine.rules.find((r) => r.id === key)?.fixes ?? [];
  if (times <= 1 || fixes.length === 0) return cueText(engine, key, lang);
  return fixes[(times - 2) % fixes.length][lang];
}

/** Every fix sentence, for preloading the voice. */
export function allGuidance(engine: Engine, lang: Lang): string[] {
  return [
    engine.partialCue[lang], ...engine.partialFixes.map((t) => t[lang]),
    ...engine.rules.flatMap((r) => [r.cue[lang], ...r.fixes.map((t) => t[lang])]),
  ].filter(Boolean);
}
