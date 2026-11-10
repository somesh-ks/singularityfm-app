/**
 * The UI sound engine. Framework-agnostic, Web Audio only, no assets.
 *
 * Hard rules, each enforced in play() or unlock():
 * - The AudioContext is created lazily, inside a user gesture (unlock), never at import or load.
 * - Nothing plays while the document is hidden, the engine is disabled, or the volume is zero.
 * - The engine never touches the narration audio element. It only asks the app whether narration
 *   is playing, then skips or ducks per recipe. The one page-wide thing it sets is the audio session
 *   type, "playback" only while Sounds is on (syncSession).
 * - A suspended or interrupted context is resumed, and the cues asked for meanwhile are held (at
 *   most four, each for 300 ms) and played in order, as far apart as they were asked, once the
 *   resume lands. Each keeps the level it was asked at, so narration that starts in the wait does
 *   not silence the cue that came before it. A new press discards what was held before it began:
 *   a cue asked for earlier would sound at the tap as a sound that tap did not make. Scheduling
 *   into a suspended context would replay every sound late, as a burst.
 * - At most four voices at once. The oldest voice is faded out in 12 ms to make room.
 * - On iOS, Web Audio follows the silent switch and is treated as ambient audio, so a silenced
 *   phone plays no UI sound. That is the intended behavior.
 */
import { generateNoise } from "./noise.js";
import {
  dbToGain,
  FLOOR,
  MASTER_LOWPASS,
  MAX_POLYPHONY,
  type NoiseLayer,
  type PlayOptions,
  RECIPES,
  recipeDurationMs,
  resolveFrequency,
  type SoundName,
  type ToneLayer,
  volumeToGain,
} from "./recipes.js";

export interface SoundEngineOptions {
  /** The Sounds switch in settings. Reduced motion should default this to false until the user opts in. */
  isEnabled: () => boolean;
  /** Master volume, 0 to 1. */
  getVolume: () => number;
  /** True while the narration audio element is playing. */
  isNarrationPlaying: () => boolean;
  /** Test seam. Defaults to document.hidden. */
  isHidden?: () => boolean;
  /** Test seam. Defaults to `new AudioContext()`. */
  createContext?: () => AudioContext;
  /** Test seam for rate limiting. Defaults to performance.now(). */
  now?: () => number;
  /** Test seam. Defaults to `navigator.audioSession`, which only Safari has. */
  getAudioSession?: () => { type: string } | undefined;
}

export interface SoundEngine {
  /** Plays a sound. Returns true when a voice was scheduled, or the cue is held for the resume under way. */
  play: (name: SoundName, options?: PlayOptions) => boolean;
  /** Creates and resumes the AudioContext. Call from inside a user gesture. Safe to call often. */
  unlock: () => void;
  /** Gives the audio session back, or takes it, to match the Sounds setting. For when it changes outside a gesture the engine sees. */
  refreshSession: () => void;
  /** Stops everything and closes the context. */
  dispose: () => void;
  /** Voices currently sounding, at most four. For the lab's polyphony meter and tests. */
  activeVoices: () => number;
}

interface Voice {
  endsAt: number;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  remaining: number;
}

interface Graph {
  input: GainNode;
  noise: AudioBuffer;
}

/** How long a cue held by a suspended context waits for the resume before it is stale. */
const QUEUED_CUE_MS = 300;

/** The events of one press (down, up, touchend, click) come closer together than this; a later one is a new press. */
const PRESS_GAP_MS = 1_000;

/** A cue waiting for the resume. Its level is settled when it is asked for, not when it plays. */
interface HeldCue {
  name: SoundName;
  options: PlayOptions;
  gain: number;
  at: number;
}

/** Layer start offsets into the shared noise buffer, so two noise layers never share samples. */
const noiseOffsetSeconds = (layerIndex: number): number => (layerIndex * 0.137) % 0.5;

/** Floor, then an exponential rise to the peak, then an exponential fall back to the floor. */
function scheduleEnvelope(
  param: AudioParam,
  start: number,
  attackMs: number,
  decayMs: number,
  peak: number,
): void {
  param.setValueAtTime(FLOOR, start);
  param.exponentialRampToValueAtTime(peak, start + attackMs / 1000);
  param.exponentialRampToValueAtTime(FLOOR, start + (attackMs + decayMs) / 1000);
}

export function createSoundEngine(options: SoundEngineOptions): SoundEngine {
  const {
    isEnabled,
    getVolume,
    isNarrationPlaying,
    isHidden = () => typeof document !== "undefined" && document.hidden,
    createContext = () => new AudioContext(),
    now = () => performance.now(),
    getAudioSession = () =>
      typeof navigator === "undefined"
        ? undefined
        : (navigator as { audioSession?: { type: string } }).audioSession,
  } = options;

  let context: AudioContext | null = null;
  let graph: Graph | null = null;
  let disposed = false;
  let voices: Voice[] = [];
  let held: HeldCue[] = [];
  /** When unlock() last ran: the most recent gesture event the engine saw. */
  let lastGestureAt = Number.NEGATIVE_INFINITY;
  const lastPlayedAt = new Map<SoundName, number>();
  /** True once this engine has put the page's audio session on "playback". */
  let tookSession = false;
  /** A pending hand-back of the session, waiting for the last voice to finish. */
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * iOS mutes Web Audio while the ring/silent switch is on, unless the page asks for playback (D105).
   * That session can also stop other apps' audio, so it is held only while Sounds is on (D295): a
   * listener who turned Sounds off keeps the phone's other audio, and the session goes back to the
   * browser's default the next time the engine looks.
   */
  function syncSession(): void {
    try {
      const session = getAudioSession();
      if (!session) return;
      if (isEnabled()) {
        if (session.type !== "playback") session.type = "playback";
        tookSession = true;
      } else if (tookSession && !releaseTimer) {
        // (With the hand-back pending, the off cue is still sounding: refreshSession() will do it.)
        session.type = "auto";
        tookSession = false;
      }
    } catch {
      // Not fatal: older browsers have no audio session.
    }
  }

  function buildGraph(ctx: AudioContext): Graph {
    const input = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = MASTER_LOWPASS.frequencyHz;
    lowpass.Q.value = MASTER_LOWPASS.qDb;
    // A safety net, not a sound shaper: the threshold sits above every recipe's peak.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    input.connect(lowpass);
    lowpass.connect(limiter);
    limiter.connect(ctx.destination);

    const samples = generateNoise(ctx.sampleRate);
    const noise = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    noise.getChannelData(0).set(samples);
    return { input, noise };
  }

  /**
   * Turning Sounds off plays its confirmation first (D295), so the session is given back after the
   * last voice has finished, not under it: on an iPhone with the ringer off, dropping "playback"
   * mid-sound would cut the cue short. A later syncSession() reads the setting again, so turning Sounds
   * back on in the meantime keeps the session.
   */
  function refreshSession(): void {
    if (disposed) return;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    const ctx = context;
    const endsAt = ctx ? Math.max(0, ...voices.map((voice) => voice.endsAt - ctx.currentTime)) : 0;
    if (isEnabled() || endsAt <= 0) {
      syncSession();
      return;
    }
    releaseTimer = setTimeout(
      () => {
        releaseTimer = null;
        if (!disposed) syncSession();
      },
      endsAt * 1000 + 30,
    );
  }

  function retire(voice: Voice): void {
    voices = voices.filter((candidate) => candidate !== voice);
    try {
      voice.gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  function stealOldest(ctx: AudioContext): void {
    const oldest = voices[0];
    if (!oldest) return;
    const t = ctx.currentTime;
    oldest.gain.gain.cancelScheduledValues(t);
    oldest.gain.gain.setTargetAtTime(0, t, 0.004);
    for (const source of oldest.sources) {
      try {
        source.stop(t + 0.012);
      } catch {
        // Already stopped.
      }
    }
    retire(oldest);
  }

  function scheduleTone(
    ctx: AudioContext,
    layer: ToneLayer,
    playOptions: PlayOptions,
    t0: number,
    destination: AudioNode,
    voice: Voice,
  ): void {
    const start = t0 + layer.startMs / 1000;
    const frequency = resolveFrequency(layer, playOptions);
    let layerOut: AudioNode = destination;
    if (layer.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = layer.lowpass.frequencyHz;
      filter.Q.value = layer.lowpass.qDb;
      filter.connect(destination);
      layerOut = filter;
    }

    const parts = [
      { ratio: 1, gain: 1, decayScale: 1, wave: layer.wave },
      ...(layer.partials ?? []).map((partial) => ({ ...partial, wave: "sine" as const })),
    ];
    for (const part of parts) {
      const oscillator = ctx.createOscillator();
      oscillator.type = part.wave;
      const target = frequency * part.ratio;
      if (layer.glide) {
        oscillator.frequency.setValueAtTime(target * layer.glide.fromRatio, start);
        oscillator.frequency.exponentialRampToValueAtTime(target, start + layer.glide.ms / 1000);
      } else {
        oscillator.frequency.setValueAtTime(target, start);
      }
      if (layer.detuneCents) oscillator.detune.value = layer.detuneCents;

      const envelope = ctx.createGain();
      envelope.gain.value = 0;
      const decayMs = layer.decayMs * part.decayScale;
      scheduleEnvelope(envelope.gain, start, layer.attackMs, decayMs, layer.peak * part.gain);
      oscillator.connect(envelope);
      envelope.connect(layerOut);

      oscillator.start(start);
      oscillator.stop(start + (layer.attackMs + decayMs) / 1000 + 0.02);
      track(voice, oscillator, envelope);
    }
  }

  function scheduleNoise(
    ctx: AudioContext,
    layer: NoiseLayer,
    layerIndex: number,
    t0: number,
    destination: AudioNode,
    voice: Voice,
    noise: AudioBuffer,
  ): void {
    const start = t0 + layer.startMs / 1000;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter.type;
    filter.frequency.value = layer.filter.frequencyHz;
    filter.Q.value = layer.filter.type === "lowpass" ? layer.filter.qDb : layer.filter.q;
    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    scheduleEnvelope(envelope.gain, start, layer.attackMs, layer.decayMs, layer.peak);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(start, noiseOffsetSeconds(layerIndex));
    source.stop(start + (layer.attackMs + layer.decayMs) / 1000 + 0.02);
    track(voice, source, envelope, filter);
  }

  /** Disconnects a layer's nodes once its source ends, so nothing lingers in the graph. */
  function track(voice: Voice, source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    voice.sources.push(source);
    voice.remaining += 1;
    source.onended = () => {
      for (const node of [source, ...nodes]) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      voice.remaining -= 1;
      if (voice.remaining <= 0) retire(voice);
    };
  }

  /** Plays what the resume was waited for, oldest first, as far apart as the cues were asked. */
  function flushHeld(): void {
    const cues = held.filter((cue) => now() - cue.at < QUEUED_CUE_MS);
    held = [];
    const ctx = context;
    const first = cues[0];
    if (!first || disposed || !ctx || !graph || ctx.state !== "running") return;
    // Silence is rechecked: Sounds, the volume or the page may have changed in the wake. A cue's level
    // (narration) stays as it was settled when it was asked.
    if (!isEnabled() || isHidden() || !(getVolume() > 0.001)) return;
    for (const cue of cues) start(ctx, graph, cue, cue.at - first.at);
  }

  function play(name: SoundName, playOptions: PlayOptions = {}): boolean {
    if (disposed || !isEnabled() || isHidden()) return false;
    // Sounds may have been switched on since the last gesture: the switch's own cue must be heard.
    syncSession();
    const recipe = RECIPES[name];
    const volume = getVolume();
    if (!(volume > 0.001)) return false;

    let gain = volumeToGain(volume) * Math.min(1, Math.max(0, playOptions.gain ?? 1));
    if (isNarrationPlaying()) {
      if (recipe.whileNarrating.mode === "skip") return false;
      gain *= dbToGain(recipe.whileNarrating.gainDb);
    }

    const ctx = context;
    if (!ctx || !graph) return false;
    const cue: HeldCue = { name, options: playOptions, gain, at: now() };
    if (ctx.state === "running") return start(ctx, graph, cue, 0);
    // The first cue after a suspend is heard once the resume lands, with the ones that follow it;
    // one that waits longer than that is stale and is let go.
    held = [...held, cue].slice(-MAX_POLYPHONY);
    void ctx
      .resume()
      .then(flushHeld)
      .catch(() => undefined);
    return true;
  }

  /** Schedules one cue now, `delayMs` later at most a few hundred ms. Returns false when rate limited. */
  function start(ctx: AudioContext, current: Graph, cue: HeldCue, delayMs: number): boolean {
    const recipe = RECIPES[cue.name];
    // Spaced by when it was asked, so two cues held through one wake keep the gap they were asked at.
    const previous = lastPlayedAt.get(cue.name);
    if (previous !== undefined && cue.at - previous < recipe.minIntervalMs) return false;
    lastPlayedAt.set(cue.name, cue.at);

    const t0 = ctx.currentTime + 0.005 + delayMs / 1000;
    voices = voices.filter((voice) => voice.endsAt > ctx.currentTime);
    while (voices.length >= MAX_POLYPHONY) stealOldest(ctx);

    const output = ctx.createGain();
    output.gain.value = cue.gain;
    output.connect(current.input);
    const voice: Voice = {
      endsAt: t0 + recipeDurationMs(recipe) / 1000 + 0.05,
      gain: output,
      sources: [],
      remaining: 0,
    };
    voices.push(voice);

    recipe.layers.forEach((layer, index) => {
      if (layer.kind === "tone") scheduleTone(ctx, layer, cue.options, t0, output, voice);
      else scheduleNoise(ctx, layer, index, t0, output, voice, current.noise);
    });
    return true;
  }

  function unlock(): void {
    if (disposed) return;
    // A new press: what was asked for before it began is not its to sound.
    const stamp = now();
    if (stamp - lastGestureAt > PRESS_GAP_MS) held = [];
    lastGestureAt = stamp;
    syncSession();
    if (!context) {
      try {
        context = createContext();
        graph = buildGraph(context);
      } catch {
        context = null;
        graph = null;
        return;
      }
    }
    if (context.state !== "running") void context.resume().catch(() => undefined);
    // Some iOS versions only leave "suspended" after a source starts inside the gesture.
    try {
      const silent = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = silent;
      source.connect(context.destination);
      source.start();
    } catch {
      // Not fatal: resume() above is the main path.
    }
  }

  function dispose(): void {
    disposed = true;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    // A replacement engine starts with no memory of the session this one took.
    if (tookSession) {
      try {
        const session = getAudioSession();
        if (session) session.type = "auto";
      } catch {
        // Not fatal.
      }
      tookSession = false;
    }
    for (const voice of [...voices]) {
      for (const source of voice.sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      retire(voice);
    }
    if (context) void context.close().catch(() => undefined);
    held = [];
    context = null;
    graph = null;
  }

  function activeVoices(): number {
    if (!context) return 0;
    const t = context.currentTime;
    return voices.filter((voice) => voice.endsAt > t).length;
  }

  return {
    play,
    unlock,
    refreshSession,
    dispose,
    activeVoices,
  };
}

/**
 * Calls engine.unlock() on the first user gestures. The context is created inside a real gesture,
 * which is the only moment mobile browsers allow it. Keeps listening afterwards because iOS can
 * interrupt the context (a call, an alarm) and a later gesture must be able to resume it.
 */
export function installGestureUnlock(
  engine: Pick<SoundEngine, "unlock">,
  target: EventTarget = document,
): () => void {
  // iOS Safari grants audio only inside touchend, pointerup or click, never pointerdown or
  // touchstart; Android Chrome counts the same. Listening to all of them covers both.
  const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
  const handler = (): void => engine.unlock();
  for (const type of events)
    target.addEventListener(type, handler, { capture: true, passive: true });
  return () => {
    for (const type of events) target.removeEventListener(type, handler, { capture: true });
  };
}

/**
 * Default for the Sounds setting. Sounds are on, except for people who asked their system for
 * reduced motion: they get silence until they opt in, since the preference often signals
 * sensitivity to stimulation in general.
 */
export function defaultSoundsEnabled(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window !== "undefined"
    ? window.matchMedia?.bind(window)
    : undefined,
): boolean {
  if (!matchMedia) return true;
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
