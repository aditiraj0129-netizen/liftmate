"use client";

/**
 * LIVE AI COACH
 * Phone does the fast work: camera -> MediaPipe pose (on device, video never uploaded) -> person lock
 * -> "get into position" guide -> rep counter + form rules -> instant voice (counts, cues, motivation).
 * Only small text events go to the backend AI: set start, set summary, and anything the user says.
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { api, Exercise, Session } from "@/lib/api";
import { allGuidance, cueText, ENGINES, Engine, Lang, mistakeAdvice } from "@/lib/pose/engines";
import { RepCounter, SetSummary } from "@/lib/pose/counter";
import { bestSide, J, Landmark, SKELETON } from "@/lib/pose/geometry";
import { PersonTracker } from "@/lib/pose/person";
import { checkReadiness, READY_TEXT, stepBackText } from "@/lib/pose/readiness";
import { allLines, countWord, line, remainingLine, remainingLines, secondsLine } from "@/lib/coachLines";
import {
  canListen, getVoiceGender, Gender, isMuted, isSpeaking, listen, preload, setMuted, setVoiceGender, speak, stopSpeaking, unlockAudio,
} from "@/lib/speech";
import { useProfile } from "@/components/AuthGate";
import { ErrorNote, GhostButton, inputClass, labelClass, PrimaryButton, Segmented, Spinner } from "@/components/ui";
import { IconAlert, IconClose, IconFlip, IconMic, IconMute, IconPause, IconPlay, IconSend, IconSpeaker } from "@/components/icons";

const MODEL_LITE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MODEL_FULL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const CUE_COOLDOWN_MS = 4000;
const GUIDE_COOLDOWN_MS = 4500;
const READY_HOLD_MS = 1200;

type Phase = "setup" | "loading" | "positioning" | "live" | "summary";
type LiveView = { visible: boolean; reps: number; bad: number; partial: number; cue: string | null; rir: number | null; hold: number; holding: boolean; lastBad: boolean; depth: number };
const EMPTY_VIEW: LiveView = { visible: true, reps: 0, bad: 0, partial: 0, cue: null, rir: null, hold: 0, holding: false, lastBad: false, depth: 0 };
type ChatMsg = { role: "coach" | "you"; text: string };
type Feedback = {
  how_it_went?: string;
  good?: string[];
  improved?: string[];
  to_improve?: { issue: string; how_to_fix: string }[];
  next_set?: string;
};

function upperReps(text: string | null): number | null {
  if (!text) return null;
  const nums = text.match(/\d+/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}

function CoachScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { profile, refresh } = useProfile();
  const slug = params.get("slug") ?? "";
  const restSeconds = Number(params.get("rest") ?? 90) || 90;
  const plannedSets = Number(params.get("sets") ?? 0) || null;

  const [lang, setLang] = useState<Lang>(profile?.language === "hi" ? "hi" : "en");
  const [gender, setGender] = useState<Gender>(getVoiceGender());
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [targetReps, setTargetReps] = useState<string>(String(upperReps(params.get("reps")) ?? 10));
  const [setNumber, setSetNumber] = useState(1);
  const [view, setView] = useState<LiveView>(EMPTY_VIEW);
  const [guide, setGuide] = useState<string>("");
  const [coachLine, setCoachLine] = useState<string>("");
  const [summary, setSummary] = useState<SetSummary | null>(null);
  const [savedSetId, setSavedSetId] = useState<string | null>(null);
  const [editReps, setEditReps] = useState(0);
  const [editBad, setEditBad] = useState(0);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [rest, setRest] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mute, setMute] = useState(isMuted());
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const trackerRef = useRef(new PersonTracker());
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("setup");
  const pausedRef = useRef(false);
  const lastVideoTime = useRef(-1);
  const lastSaid = useRef<Map<string, number>>(new Map());
  const cueShownAt = useRef(0);
  const readySince = useRef(0);
  // Calm-coach memory for the current set: what has already been said, so nothing is nagged
  const mistakeState = useRef<Map<string, { said: number; rep: number }>>(new Map());
  const guideSaid = useRef<Set<string>>(new Set());
  const posStart = useRef(0);
  const reminderSaid = useRef(false);
  const frameWarned = useRef(false);
  const adviceUntil = useRef(0);
  const cueTextRef = useRef<string | null>(null);
  const viewRef = useRef<LiveView>(EMPTY_VIEW);
  const flags = useRef({ target: false, lastTwo: false, rir: false, holdTick: 0, praiseEvery: 3 });
  const sessionIdRef = useRef<string | null>(params.get("session"));
  const settingsRef = useRef({ lang, target: Number(targetReps) || null });
  settingsRef.current = { lang, target: Number(targetReps) || null };

  const goPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // ---------- load exercise ----------
  useEffect(() => {
    if (!slug) {
      setError("No exercise selected.");
      return;
    }
    api<Exercise>(`/exercises/${slug}`)
      .then((ex) => {
        setExercise(ex);
        setEngine(ex.engine ? ENGINES[ex.engine] ?? null : null);
        const last = ex.history?.[0]?.weight_kg;
        if (last) setWeight(String(last));
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    stopCamera();
    landmarkerRef.current?.close();
    stopSpeaking();
  }, [stopCamera]);

  // ---------- rest timer ----------
  useEffect(() => {
    if (rest <= 0) return;
    const timer = setTimeout(() => {
      const next = rest - 1;
      setRest(next);
      if (next === 10) speak(line("restTen", lang), lang, false, "hype");
      if (next === 0) speak(line("restDone", lang), lang, false, "hype");
    }, 1000);
    return () => clearTimeout(timer);
  }, [rest, lang]);

  // ---------- voice helpers ----------
  /** Say a line unless the same line was said very recently. */
  const sayOnce = useCallback((text: string, now: number, opts: { interrupt?: boolean; hype?: boolean; cooldown?: number } = {}) => {
    const l = settingsRef.current.lang;
    const last = lastSaid.current.get(text) ?? 0;
    if (!text || now - last < (opts.cooldown ?? CUE_COOLDOWN_MS)) return false;
    lastSaid.current.set(text, now);
    speak(text, l, opts.interrupt ?? false, opts.hype ? "hype" : "normal");
    return true;
  }, []);

  // ---------- drawing ----------
  function draw(pose: Landmark[] | undefined, others: Landmark[][], warn: boolean) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lineWidth = Math.max(4, canvas.width / 160);
    const drawPose = (lm: Landmark[], color: string, width: number, dots: boolean) => {
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      for (const [a, b] of SKELETON) {
        const pa = lm[a], pb = lm[b];
        if (!pa || !pb || (pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
        ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
        ctx.stroke();
      }
      if (!dots) return;
      ctx.fillStyle = "#f2f5f1";
      for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        const pt = lm[i];
        if (!pt || (pt.visibility ?? 1) < 0.4) continue;
        ctx.beginPath();
        ctx.arc(pt.x * canvas.width, pt.y * canvas.height, width * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const other of others) if (other !== pose) drawPose(other, "rgba(154,165,158,0.35)", lineWidth * 0.5, false);
    if (pose) drawPose(pose, warn ? "#ffb547" : "#c6f432", lineWidth, true);
  }

  function publish(next: LiveView) {
    const prev = viewRef.current;
    if (Object.keys(next).some((k) => prev[k as keyof LiveView] !== next[k as keyof LiveView])) {
      viewRef.current = next;
      setView(next);
    }
  }

  // ---------- positioning ----------
  // Each positioning tip is spoken once. One general reminder after 15 s. Otherwise the coach waits quietly.
  function handlePositioning(pose: Landmark[] | undefined, aspect: number, now: number, world?: Landmark[]) {
    const e = engineRef.current!;
    const l = settingsRef.current.lang;
    const check = checkReadiness(e, pose ? { lm: pose, aspect, world } : null, l);
    setGuideIfChanged(check.message);
    const talking = isSpeaking(); // let the instructions finish before anything else
    if (check.ok) {
      if (talking) {
        readySince.current = 0;
        return;
      }
      if (!readySince.current) readySince.current = now;
      if (now - readySince.current > READY_HOLD_MS && pose) {
        trackerRef.current.lock(pose);
        counterRef.current = new RepCounter(e);
        mistakeState.current.clear();
        frameWarned.current = false;
        adviceUntil.current = 0;
        cueTextRef.current = null;
        flags.current = { target: false, lastTwo: false, rir: false, holdTick: 0, praiseEvery: 2 + Math.floor(Math.random() * 2) };
        viewRef.current = EMPTY_VIEW;
        setView(EMPTY_VIEW);
        lastSaid.current.clear();
        goPhase("live");
        speak(READY_TEXT.go[l], l, true, "hype");
      }
    } else {
      readySince.current = 0;
      if (talking) return;
      if (!guideSaid.current.has(check.key)) {
        guideSaid.current.add(check.key);
        speak(check.message, l);
      } else if (!reminderSaid.current && now - posStart.current > 15000) {
        reminderSaid.current = true;
        speak(READY_TEXT.waiting[l], l);
      }
    }
  }

  const guideRef = useRef("");
  function setGuideIfChanged(text: string) {
    if (guideRef.current !== text) {
      guideRef.current = text;
      setGuide(text);
    }
  }

  // ---------- live counting ----------
  function handleLive(pose: Landmark[] | undefined, aspect: number, now: number, world?: Landmark[]) {
    const counter = counterRef.current!;
    const e = counter.engine;
    const l = settingsRef.current.lang;
    const target = settingsRef.current.target;
    const prev = viewRef.current;

    if (!pose) {
      if (trackerRef.current.lostFor(now) > 2500 && !frameWarned.current) {
        frameWarned.current = true; // said once per set, then the screen shows it
        speak(READY_TEXT.lost[l], l);
      }
      publish({ ...prev, visible: false });
      return;
    }

    const r = counter.update({ lm: pose, aspect, world }, now);
    if (!r.visible) {
      const side = bestSide({ lm: pose, aspect }, e.joints);
      const missing = e.joints.find((j) => (pose[J[j][side]].visibility ?? 1) < 0.5);
      if (missing && !frameWarned.current) {
        frameWarned.current = true;
        speak(stepBackText(missing, l), l);
      }
    }

    /** Speak advice about a mistake at most twice per set (see mistakeAdvice). Always show the short cue on screen. */
    const advise = (key: string) => {
      cueTextRef.current = cueText(e, key, l);
      cueShownAt.current = now;
      const st = mistakeState.current.get(key);
      let attempt: 1 | 2 | null = null;
      if (!st) {
        attempt = 1;
        mistakeState.current.set(key, { said: 1, rep: counter.reps });
      } else if (st.said === 1 && counter.reps - st.rep >= 5) {
        attempt = 2;
        st.said = 2;
      }
      if (!attempt) return;
      const text = mistakeAdvice(e, key, attempt, l);
      speak(text, l, true);
      adviceUntil.current = now + Math.min(6000, 900 + text.length * 60);
      cueTextRef.current = text;
      setCoachLine(text);
    };

    if (r.repDone) {
      const n = counter.reps;
      const busy = now < adviceUntil.current; // don't cut off advice that is still being spoken
      const count = countWord(n, l);
      speak(count, l, !busy, "normal");
      let extra = "";
      if (!busy) {
        const rir = counter.rir();
        const rem = target ? target - n : null;
        if (rir !== null && rir <= 1 && n >= 4 && !flags.current.rir && (rem === null || rem > 1)) {
          flags.current.rir = true;
          extra = line("lowRir", l);
        } else if (rem !== null && rem > 0) {
          extra = n === 1 && rem > 3 ? `${line("firstRep", l)} ${remainingLine(rem, l)}` : remainingLine(rem, l);
        } else if (rem === 0) {
          extra = line("target", l);
        } else if (rem !== null && rem < 0) {
          extra = (n - (target ?? 0)) % 2 === 1 ? line("bonus", l) : "";
        } else {
          extra = n === 1 ? line("firstRep", l) : n % 2 === 0 ? line("praise", l) : line("struggle", l);
        }
        if (extra) speak(extra, l, false, "hype");
        setCoachLine(extra ? `${count}! ${extra}` : `${count}!`);
      }
    } else if (r.partialDone) {
      advise("partial");
    } else if (r.cueKey) {
      advise(r.cueKey);
    } else if (r.struggle) {
      const text = line("struggle", l);
      if (now >= adviceUntil.current && sayOnce(text, now, { interrupt: true, hype: true, cooldown: 2500 })) setCoachLine(text);
    } else if (r.idle) {
      const text = line("idle", l);
      if (sayOnce(text, now, { cooldown: 15000 })) setCoachLine(text);
    }

    // holds (plank): call out time and keep them going
    const hold = Math.floor(counter.holdMs / 1000);
    if (e.mode === "hold" && hold > 0 && hold % 10 === 0 && hold !== flags.current.holdTick) {
      flags.current.holdTick = hold;
      speak(secondsLine(hold, l), l, true);
      if (hold >= 20) speak(line("holdPush", l), l, false, "hype");
    }

    const showCue = now - cueShownAt.current < 3500;
    publish({
      visible: r.visible,
      reps: counter.reps,
      bad: counter.badReps,
      partial: counter.partial,
      cue: showCue ? cueTextRef.current : null,
      rir: counter.rir(),
      hold,
      holding: r.holding,
      lastBad: r.repDone ? r.repBad : prev.lastBad,
      depth: r.visible ? Math.round(Math.min(1, r.progress / 0.9) * 20) / 20 : prev.depth,
    });
  }

  const engineRef = useRef<Engine | null>(null);
  engineRef.current = engine;

  // ---------- main loop ----------
  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    const phaseNow = phaseRef.current;
    if (
      video && landmarker && engineRef.current && video.readyState >= 2 && !pausedRef.current &&
      (phaseNow === "positioning" || phaseNow === "live") && video.currentTime !== lastVideoTime.current
    ) {
      lastVideoTime.current = video.currentTime;
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const poses = result.landmarks as Landmark[][];
      const aspect = video.videoWidth / video.videoHeight;
      const pose = trackerRef.current.pick(poses, now);
      draw(pose, poses, now - cueShownAt.current < 1500);
      const world = pose ? (result.worldLandmarks?.[poses.indexOf(pose)] as Landmark[] | undefined) : undefined;
      if (phaseNow === "positioning") handlePositioning(pose, aspect, now, world);
      else handleLive(pose, aspect, now, world);
    }
    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- start ----------
  async function openCamera(mode: "user" | "environment") {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();
  }

  async function loadModel() {
    if (landmarkerRef.current) return;
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const big = window.innerWidth > 900 && (navigator.hardwareConcurrency ?? 4) >= 8;
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: big ? MODEL_FULL : MODEL_LITE, delegate },
      runningMode: "VIDEO" as const,
      numPoses: 3, // see up to 3 people so we can ignore the ones in the background
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  function warmVoice(e: Engine) {
    const max = Math.max(20, (Number(targetReps) || 10) + 6);
    const numbers = Array.from({ length: max }, (_, i) => countWord(i + 1, lang));
    const cues = [...allGuidance(e, lang), e.startHint[lang], ...Object.values(READY_TEXT).map((t) => t[lang]),
      ...e.joints.map((j) => stepBackText(j, lang)), ...[10, 20, 30, 40, 50, 60].map((n) => secondsLine(n, lang))];
    const countdown = Array.from({ length: Number(targetReps) || 0 }, (_, i) => remainingLines(i + 1, lang)).flat();
    void preload(countdown, lang, "hype");
    void preload([`${e.setupTip[lang]} ${e.howTo[lang]} ${e.startHint[lang]} ${READY_TEXT.waiting[lang]}`], lang, "normal");
    void preload([...numbers, ...cues], lang, "normal");
    void preload(allLines(lang), lang, "hype");
  }

  async function ensureSession() {
    if (sessionIdRef.current) return sessionIdRef.current;
    const session = await api<Session>("/sessions/quick", { body: { title: exercise?.name_en ?? "Quick workout" } });
    sessionIdRef.current = session.id;
    return session.id;
  }

  function beginPositioning(intro: boolean) {
    trackerRef.current.unlock();
    readySince.current = 0;
    guideRef.current = "";
    guideSaid.current.clear();
    reminderSaid.current = false;
    posStart.current = performance.now();
    setGuide(READY_TEXT.intro[lang]);
    pausedRef.current = false;
    setPaused(false);
    goPhase("positioning");
    if (intro && engine) {
      // Explain everything ONCE: camera placement, how to do the movement, start position.
      speak(`${engine.setupTip[lang]} ${engine.howTo[lang]} ${engine.startHint[lang]} ${READY_TEXT.waiting[lang]}`, lang, true);
    }
  }

  async function start() {
    if (!engine) return;
    setError(null);
    unlockAudio();
    warmVoice(engine);
    goPhase("loading");
    speak(line("settingUp", lang), lang, true);
    try {
      await Promise.all([loadModel(), openCamera(facing)]);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
      beginPositioning(true);
      api<{ reply: string }>("/coach/talk", {
        body: { exercise_slug: slug, event: "set_start", coach_gender: gender, state: { set_number: 1, target_reps: Number(targetReps) || null, weight_kg: weight ? Number(weight) : null } },
      }).then(({ reply }) => setCoachLine(reply)).catch(() => {});
    } catch (e) {
      const err = e as Error;
      setError(
        err.name === "NotAllowedError" || err.message.toLowerCase().includes("permission")
          ? "Camera permission was blocked. Allow camera access in your browser settings and try again."
          : `Couldn't start the camera or AI model. ${err.message}`,
      );
      goPhase("setup");
    }
  }

  async function flipCamera() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    try {
      await openCamera(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    speak(line(pausedRef.current ? "paused" : "resumed", lang), lang, true);
  }

  async function changeLanguage(next: Lang) {
    setLang(next);
    if (next !== profile?.language) {
      try {
        await api("/me", { method: "PUT", body: { language: next } });
        await refresh();
      } catch {
        /* keep local choice */
      }
    }
  }

  // ---------- end of set ----------
  async function endSet() {
    const counter = counterRef.current;
    if (!engine) return;
    pausedRef.current = true;
    stopSpeaking();
    if (!counter) {
      goPhase("summary");
      setSummary({ reps: 0, badReps: 0, partial: 0, formScore: null, rir: null, struggled: false, holdSeconds: 0, goodPoints: [], improvePoints: [], cues: [], repLog: [] });
      return;
    }
    const result = counter.summary(lang);
    setSummary(result);
    setEditReps(result.reps);
    setEditBad(result.badReps);
    setSavedSetId(null);
    setChat([]);
    setFeedback(null);
    goPhase("summary");
    const nothing = engine.mode === "hold" ? result.holdSeconds === 0 : result.reps === 0 && result.partial === 0;
    if (nothing) return;
    setSaving(true);
    try {
      const sessionId = await ensureSession();
      const saved = await api<{ id: string }>(`/sessions/${sessionId}/sets`, {
        body: {
          exercise_slug: slug,
          weight_kg: weight ? Number(weight) : null,
          reps_full: result.reps,
          reps_bad: result.badReps,
          reps_partial: result.partial,
          form_score: result.formScore,
          est_rir: result.rir,
          good_points: result.goodPoints,
          improve_points: result.improvePoints,
          hold_seconds: engine.mode === "hold" ? result.holdSeconds : null,
          source: "ai",
        },
      });
      lastSent.current = { reps: result.reps, bad: result.badReps };
      setSavedSetId(saved.id);
      const { reply, feedback: fb } = await api<{ reply: string; feedback: Feedback | null }>("/coach/talk", {
        body: {
          exercise_slug: slug,
          event: "set_end",
          coach_gender: gender,
          set_id: saved.id,
          state: {
            rep_log: result.repLog,
            set_number: setNumber, reps: result.reps, bad_reps: result.badReps, partial: result.partial, target_reps: Number(targetReps) || null,
            weight_kg: weight ? Number(weight) : null, form_score: result.formScore, est_rir: result.rir, struggled: result.struggled,
            cues: result.cues, hold_seconds: result.holdSeconds,
          },
        },
      });
      setFeedback(fb ?? null);
      setChat([{ role: "coach", text: reply }]);
      speak(reply, lang, true);
      setRest(restSeconds);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // save corrected rep counts (debounced)
  const lastSent = useRef({ reps: 0, bad: 0 });
  useEffect(() => {
    if (!savedSetId || !summary) return;
    if (editReps === lastSent.current.reps && editBad === lastSent.current.bad) return;
    const timer = setTimeout(() => {
      lastSent.current = { reps: editReps, bad: editBad };
      api(`/sets/${savedSetId}`, { method: "PATCH", body: { reps_full: editReps, reps_bad: Math.min(editBad, editReps) } }).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [editReps, editBad, savedSetId, summary]);

  function nextSet() {
    setSetNumber((n) => n + 1);
    setRest(0);
    setSummary(null);
    setChat([]);
    setFeedback(null);
    setCoachLine("");
    speak(line("nextSet", lang), lang, true, "hype");
    beginPositioning(false);
  }

  // ---------- conversation ----------
  async function talk(text: string, from: "voice" | "text") {
    if (!text.trim()) return;
    setChat((c) => [...c, { role: "you", text }]);
    setChatDraft("");
    const c = counterRef.current;
    try {
      const { reply } = await api<{ reply: string }>("/coach/talk", {
        body: {
          exercise_slug: slug,
          event: "question",
          text,
          coach_gender: gender,
          state: {
            set_number: setNumber, reps: summary?.reps ?? c?.reps ?? 0, bad_reps: summary?.badReps ?? c?.badReps ?? 0, partial: c?.partial ?? 0,
            target_reps: Number(targetReps) || null, weight_kg: weight ? Number(weight) : null, est_rir: c?.rir() ?? null,
            form_score: summary?.formScore ?? null, struggled: c?.struggledOnce ?? false,
          },
        },
      });
      setChat((m) => [...m, { role: "coach", text: reply }]);
      if (phaseRef.current !== "summary") setCoachLine(reply);
      speak(reply, lang, true);
    } catch (e) {
      setError((e as Error).message);
    }
    void from;
  }

  async function askByVoice() {
    setAsking(true);
    const wasPaused = pausedRef.current;
    pausedRef.current = true;
    try {
      const said = await listen(lang);
      if (said) await talk(said, "voice");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pausedRef.current = wasPaused;
      setAsking(false);
    }
  }

  function finish() {
    stopCamera();
    stopSpeaking();
    router.push(sessionIdRef.current ? `/session/${sessionIdRef.current}` : `/exercises/${slug}`);
  }

  // ---------- render ----------
  if (error && !exercise) return <div className="p-6"><ErrorNote message={error} /></div>;
  if (!exercise) return <Spinner />;

  if (!engine) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
        <h1 className="font-display text-3xl font-bold">{exercise.name_en}</h1>
        <p className="text-soft">AI rep counting isn&apos;t ready for this exercise yet. You can still follow the guide and log your sets manually.</p>
        <Link href={`/exercises/${slug}`} className="text-lime">Back to the exercise guide</Link>
      </div>
    );
  }

  const mirrored = facing === "user";
  const isHold = engine.mode === "hold";
  const tank = view.rir === null ? null : Math.min(3, view.rir);
  const target = Number(targetReps) || null;
  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#171b19] text-ink">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={{ transform: mirrored ? "scaleX(-1)" : undefined }} aria-hidden="true" />

      {/* Top bar */}
      <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-2">
        <button onClick={finish} aria-label="Close live coach" className="flex h-11 w-11 items-center justify-center rounded-full bg-ground/75"><IconClose /></button>
        <div className="flex min-w-0 flex-col items-center rounded-3xl bg-ground/75 px-4 py-2 text-center">
          <span className="truncate text-sm font-semibold">{exercise.name_en}</span>
          <span className="text-xs text-muted">{t("Set", "सेट")} {setNumber}{plannedSets ? ` / ${plannedSets}` : ""}{weight ? ` · ${weight} kg` : ""}</span>
        </div>
        <button onClick={flipCamera} aria-label="Switch camera" className="flex h-11 w-11 items-center justify-center rounded-full bg-ground/75"><IconFlip /></button>
      </div>

      {/* Setup / loading */}
      {(phase === "setup" || phase === "loading") && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end overflow-y-auto bg-ground/90 p-5">
          <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-20">
            <div>
              <h1 className="font-display text-4xl font-extrabold uppercase leading-none">{exercise.name_en}</h1>
              {exercise.name_hi && <p className="mt-1 text-muted">{exercise.name_hi}</p>}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-soft">
              <p className="mb-1 font-semibold text-ink">{t("Camera setup", "कैमरा सेटअप")}</p>
              {engine.setupTip[lang]}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {!isHold && (
                <label className={labelClass}>{t("Weight (kg)", "वज़न (kg)")}
                  <input className={inputClass} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={t("bodyweight", "बॉडीवेट")} />
                </label>
              )}
              {!isHold && (
                <label className={labelClass}>{t("Target reps", "टारगेट रेप्स")}
                  <input className={inputClass} inputMode="numeric" value={targetReps} onChange={(e) => setTargetReps(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                </label>
              )}
            </div>
            <div className={labelClass}>{t("Coach language", "कोच की भाषा")}
              <Segmented label="Coach language" value={lang} onChange={changeLanguage} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिंदी" }]} />
            </div>
            <div className={labelClass}>{t("Coach voice", "कोच की आवाज़")}
              <Segmented label="Coach voice" value={gender} onChange={(g) => { setGender(g); setVoiceGender(g); }} options={[{ value: "female", label: t("Female", "महिला") }, { value: "male", label: t("Male", "पुरुष") }]} />
            </div>
            <ErrorNote message={error} />
            <PrimaryButton onClick={start} disabled={phase === "loading"}>
              {phase === "loading" ? t("Loading AI coach...", "AI कोच लोड हो रहा है...") : t("Start live coach", "लाइव कोच शुरू करो")}
            </PrimaryButton>
            <p className="text-center text-xs text-muted">{t("Video stays on your phone. Only rep counts and form scores are saved.", "वीडियो सिर्फ़ तुम्हारे फ़ोन पर रहता है। सिर्फ़ रेप्स और फॉर्म स्कोर सेव होते हैं।")}</p>
          </div>
        </div>
      )}

      {/* Get into position */}
      {phase === "positioning" && (
        <div className="absolute inset-x-4 bottom-4 z-10 flex flex-col gap-3">
          <div role="status" className="rounded-3xl border border-lime/60 bg-ground/85 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-lime">{t("Get into position", "पोज़ीशन में आओ")}</p>
            <p className="mt-1 text-lg font-semibold leading-snug">{guide}</p>
            <p className="mt-2 text-sm leading-relaxed text-soft">{engine.howTo[lang]}</p>
            <p className="mt-2 text-xs text-muted">{t("Take your time. Counting starts automatically when you're ready. People in the background are ignored.", "आराम से तैयार हो। सही पोज़ीशन होते ही गिनती अपने आप शुरू होगी। पीछे के लोगों को नज़रअंदाज़ किया जाएगा।")}</p>
          </div>
          {coachLine && (
            <div className="flex items-center gap-3 rounded-2xl bg-surface2/95 px-3 py-2.5">
              <span className="h-8 w-8 shrink-0 rounded-full bg-lime" aria-hidden="true" />
              <p className="text-sm leading-snug">{coachLine}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <GhostButton onClick={() => { trackerRef.current.unlock(); goPhase("live"); counterRef.current = new RepCounter(engine); viewRef.current = EMPTY_VIEW; setView(EMPTY_VIEW); }}>
              {t("Skip, start counting", "छोड़ो, गिनती शुरू")}
            </GhostButton>
            <GhostButton onClick={finish}>{t("Exit", "बाहर")}</GhostButton>
          </div>
        </div>
      )}

      {/* Depth / range meter: fills as you move, turns green when the rep's turnaround point is reached */}
      {phase === "live" && !isHold && (
        <div className="absolute right-4 top-24 z-10 flex flex-col items-center gap-1.5" aria-hidden="true">
          <div className="relative h-48 w-4 overflow-hidden rounded-full bg-ground/70 ring-1 ring-line">
            <div className={`absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-100 ${view.depth >= 1 ? "bg-lime" : "bg-amber"}`} style={{ height: `${view.depth * 100}%` }} />
          </div>
          <span className="rounded-md bg-ground/70 px-1.5 text-[10px] text-muted">{t("RANGE", "रेंज")}</span>
        </div>
      )}

      {/* Live HUD */}
      {phase === "live" && (
        <div className="absolute inset-x-4 bottom-4 z-10 flex flex-col gap-3">
          {!view.visible && (
            <div className="rounded-xl bg-ground/80 px-3 py-2 text-center text-sm text-amber">{READY_TEXT.lost[lang]}</div>
          )}
          {view.cue && (
            <div role="status" className="flex items-center gap-2.5 rounded-2xl border border-amber bg-amber-deep/95 px-4 py-3">
              <IconAlert className="h-5 w-5 shrink-0 text-amber" />
              <span className="text-base font-semibold text-[#ffe2b0]">{view.cue}</span>
            </div>
          )}
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1.5" aria-live="polite">
                <span className={`font-display text-[112px] font-extrabold leading-[0.8] ${view.lastBad ? "text-amber" : ""}`}>{isHold ? view.hold : view.reps}</span>
                <span className="font-display text-3xl font-bold text-muted">{isHold ? t("sec", "सेकंड") : target ? `/ ${target}` : t("reps", "रेप्स")}</span>
              </div>
              {!isHold && target && target - view.reps > 0 && (
                <span className="mt-1 text-sm font-semibold text-lime">{t(`${target - view.reps} more to go`, `${target - view.reps} और बाकी`)}</span>
              )}
              {!isHold && (view.bad > 0 || view.partial > 0) && (
                <span className="mt-1 text-xs text-amber">
                  {view.reps - view.bad} {t("clean", "सही")} · {view.bad} {t("bad", "गलत")}{view.partial ? ` · ${view.partial} ${t("half", "आधे")}` : ""}
                </span>
              )}
            </div>
            {!isHold ? (
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-xs text-muted">{t("Reps left in the tank", "टैंक में बचे रेप्स")}</span>
                <div className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((i) => <span key={i} className={`h-2.5 w-6 rounded-sm ${tank !== null && i < tank ? "bg-lime" : "bg-line"}`} />)}
                </div>
                <span className="text-sm font-semibold text-lime">
                  {tank === null ? t("Measuring...", "माप रहे हैं...") : tank >= 3 ? t("Plenty left, push on", "अभी काफ़ी दम है") : tank === 0 ? t("At your limit", "लिमिट पर हो") : t(`${tank} more strong rep${tank > 1 ? "s" : ""}`, `${tank} और दमदार रेप`)}
                </span>
              </div>
            ) : (
              <span className={`text-sm font-semibold ${view.holding ? "text-lime" : "text-amber"}`}>{view.holding ? t("Holding, great line", "बढ़िया, होल्ड करो") : t("Fix your position", "पोज़ीशन ठीक करो")}</span>
            )}
          </div>
          {coachLine && (
            <div className="flex items-center gap-3 rounded-2xl bg-surface2/95 px-3 py-2.5">
              <span className="h-9 w-9 shrink-0 rounded-full bg-lime shadow-[0_0_0_6px_rgba(198,244,50,0.18)]" aria-hidden="true" />
              <p className="text-sm leading-snug">{coachLine}</p>
            </div>
          )}
          <div className="grid grid-cols-[52px_52px_1fr_52px] gap-2">
            <button onClick={togglePause} aria-label={paused ? "Resume" : "Pause"} className="flex h-14 items-center justify-center rounded-2xl border border-line bg-surface">{paused ? <IconPlay /> : <IconPause />}</button>
            {canListen() ? (
              <button onClick={askByVoice} disabled={asking} aria-label="Talk to the coach" className={`flex h-14 items-center justify-center rounded-2xl border border-line ${asking ? "bg-lime text-ground" : "bg-surface"}`}><IconMic /></button>
            ) : <span />}
            <button onClick={endSet} className="h-14 rounded-2xl bg-lime font-bold text-ground">{t("End set · log it", "सेट खत्म · सेव करो")}</button>
            <button onClick={() => { setMuted(!mute); setMute(!mute); }} aria-label={mute ? "Unmute coach" : "Mute coach"} className="flex h-14 items-center justify-center rounded-2xl border border-line bg-surface">
              {mute ? <IconMute /> : <IconSpeaker />}
            </button>
          </div>
        </div>
      )}

      {/* Set summary + conversation + rest */}
      {phase === "summary" && summary && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[88dvh] overflow-y-auto rounded-t-[28px] bg-ground p-5">
          <div className="mx-auto flex max-w-md flex-col gap-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-lime">{t("Set", "सेट")} {setNumber} {savedSetId ? t("logged", "सेव हुआ") : ""}</p>
                <p className="font-display text-5xl font-extrabold leading-none">
                  {isHold ? `${summary.holdSeconds}s` : `${editReps} ${t("reps", "रेप्स")}`}
                </p>
              </div>
              {summary.formScore !== null && (
                <div className="text-right">
                  <p className="font-display text-4xl font-bold text-lime">{summary.formScore}</p>
                  <p className="text-[11px] text-muted">{t("FORM SCORE", "फॉर्म स्कोर")}</p>
                </div>
              )}
            </div>

            {!isHold && (
              <div className="grid grid-cols-2 gap-3">
                {([[t("Total reps", "कुल रेप्स"), editReps, setEditReps], [t("Bad reps", "गलत रेप्स"), editBad, setEditBad]] as const).map(([label, value, setter]) => (
                  <div key={label} className="flex flex-col gap-1.5 rounded-2xl border border-line p-3">
                    <span className="text-xs text-muted">{label}</span>
                    <div className="flex items-center justify-between">
                      <button aria-label={`${label} minus one`} onClick={() => setter(Math.max(0, value - 1))} className="h-11 w-11 rounded-xl bg-surface text-xl font-bold">−</button>
                      <span className="font-display text-3xl font-bold">{value}</span>
                      <button aria-label={`${label} plus one`} onClick={() => setter(value + 1)} className="h-11 w-11 rounded-xl bg-surface text-xl font-bold">+</button>
                    </div>
                  </div>
                ))}
                <p className="col-span-2 -mt-1 text-xs text-muted">
                  {summary.partial > 0 && `${summary.partial} ${t("half reps (not counted). ", "आधे रेप (गिने नहीं गए)। ")}`}
                  {t("Camera miscounted? Fix it here, it saves automatically.", "गिनती गलत? यहीं ठीक करो, अपने आप सेव होगा।")}
                </p>
              </div>
            )}

            {feedback ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
                {feedback.how_it_went && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">{t("How your reps went", "रेप्स कैसे रहे")}</p>
                    <p className="text-sm leading-relaxed text-soft">{feedback.how_it_went}</p></div>
                )}
                {!!feedback.good?.length && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-lime">{t("Good", "अच्छा")}</p>
                    <ul className="flex flex-col gap-1 text-sm text-soft">{feedback.good.map((g) => <li key={g}>+ {g}</li>)}</ul></div>
                )}
                {!!feedback.improved?.length && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-lime">{t("Improved since last set", "पिछले सेट से बेहतर")}</p>
                    <ul className="flex flex-col gap-1 text-sm text-soft">{feedback.improved.map((g) => <li key={g}>↑ {g}</li>)}</ul></div>
                )}
                {!!feedback.to_improve?.length && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-amber">{t("Work on this", "इस पर काम करो")}</p>
                    <ul className="flex flex-col gap-2 text-sm">{feedback.to_improve.map((x) => (
                      <li key={x.issue} className="rounded-xl bg-surface p-2.5"><p className="font-semibold text-ink">{x.issue}</p><p className="mt-0.5 text-soft">{t("How:", "कैसे:")} {x.how_to_fix}</p></li>
                    ))}</ul></div>
                )}
                {feedback.next_set && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">{t("Next set", "अगला सेट")}</p>
                    <p className="text-sm leading-relaxed text-soft">{feedback.next_set}</p></div>
                )}
              </div>
            ) : (
              <>
                {summary.goodPoints.length > 0 && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">{t("Good", "अच्छा")}</p>
                    <ul className="flex flex-col gap-1 text-sm">{summary.goodPoints.map((g) => <li key={g} className="text-soft">+ {g}</li>)}</ul>
                  </div>
                )}
                {summary.improvePoints.length > 0 && (
                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-amber">{t("Improve", "सुधारो")}</p>
                    <ul className="flex flex-col gap-1 text-sm">{summary.improvePoints.map((g) => <li key={g} className="text-soft">- {g}</li>)}</ul>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-col gap-2">
              {saving && <Spinner label={t("Coach is reviewing your set", "सेट का रिव्यू हो रहा है")} />}
              {chat.map((m, i) => (
                <div key={i} className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "coach" ? "self-start bg-surface" : "self-end bg-lime text-ground"}`}>
                  {m.text}
                </div>
              ))}
              {!saving && chat.length > 0 && (
                <form onSubmit={(e) => { e.preventDefault(); talk(chatDraft, "text"); }} className="flex gap-2">
                  <label className="sr-only" htmlFor="coach-reply">Reply to coach</label>
                  <input id="coach-reply" className={inputClass} value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder={t("Reply to your coach...", "कोच को जवाब दो...")} />
                  {canListen() && (
                    <button type="button" onClick={askByVoice} disabled={asking} aria-label="Reply by voice" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${asking ? "bg-lime text-ground" : "border border-line"}`}><IconMic /></button>
                  )}
                  <button type="submit" disabled={!chatDraft.trim()} aria-label="Send" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lime text-ground disabled:opacity-50"><IconSend /></button>
                </form>
              )}
            </div>

            <ErrorNote message={error} />
            {rest > 0 && (
              <div className="flex items-center justify-between rounded-2xl border border-line p-4">
                <span className="text-sm text-muted">{t("Rest", "आराम")}</span>
                <span className="font-display text-4xl font-bold">{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}</span>
                <button onClick={() => setRest(0)} className="text-sm text-lime">{t("Skip", "छोड़ो")}</button>
              </div>
            )}
            {!isHold && (
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>{t("Next set weight (kg)", "अगले सेट का वज़न")}
                  <input className={inputClass} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </label>
                <label className={labelClass}>{t("Target reps", "टारगेट रेप्स")}
                  <input className={inputClass} inputMode="numeric" value={targetReps} onChange={(e) => setTargetReps(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                </label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <GhostButton onClick={finish}>{t("Done with exercise", "एक्सरसाइज़ खत्म")}</GhostButton>
              <PrimaryButton onClick={nextSet}>{t("Next set", "अगला सेट")}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoachPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CoachScreen />
    </Suspense>
  );
}
