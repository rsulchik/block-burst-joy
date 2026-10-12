// Лёгкий синтезированный звук на Web Audio API — без загрузки файлов.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let enabled = true;

const KEY = "blockblast_sound";

export function isSoundOn() {
  return enabled;
}

export function loadSoundPref() {
  if (typeof localStorage === "undefined") return true;
  enabled = localStorage.getItem(KEY) !== "off";
  return enabled;
}

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = on ? 0.9 : 0;
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ac();
}

type ToneOpts = {
  freq: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  slideTo?: number;
  dest?: AudioNode;
};

function tone({ freq, dur = 0.12, type = "sine", gain = 0.2, delay = 0, slideTo, dest }: ToneOpts) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(dest ?? master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur = 0.25, gain = 0.18) {
  const c = ac();
  if (!c || !master) return;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
}

export function sfxPickup() {
  tone({ freq: 440, dur: 0.07, type: "triangle", gain: 0.12 });
}

export function sfxPlace() {
  tone({ freq: 220, dur: 0.09, type: "square", gain: 0.14, slideTo: 320 });
}

export function sfxInvalid() {
  tone({ freq: 180, dur: 0.16, type: "sawtooth", gain: 0.1, slideTo: 90 });
}

export function sfxClear(lines: number) {
  const base = [523.25, 659.25, 783.99, 1046.5];
  const n = Math.min(lines + 2, 4);
  for (let i = 0; i < n; i++) {
    tone({ freq: base[i]!, dur: 0.18, type: "triangle", gain: 0.18, delay: i * 0.055 });
  }
  noise(0.3, 0.12 + lines * 0.03);
}

export function sfxCombo() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  notes.forEach((f, i) => {
    tone({ freq: f, dur: 0.12, type: "sine", gain: 0.15, delay: i * 0.04 });
  });
}

export function sfxNewPieces() {
  tone({ freq: 392, dur: 0.08, type: "triangle", gain: 0.1 });
  setTimeout(() => {
    tone({ freq: 523.25, dur: 0.1, type: "triangle", gain: 0.12 });
  }, 60);
}

export function sfxButton() {
  tone({ freq: 600, dur: 0.05, type: "sine", gain: 0.08 });
}

export function sfxLevelUp() {
  const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  arpeggio.forEach((f, i) => {
    tone({ freq: f, dur: 0.1, type: "triangle", gain: 0.14, delay: i * 0.06 });
  });
  noise(0.25, 0.15);
}

export function sfxGameOver() {
  [440, 349.23, 261.63].forEach((f, i) =>
    tone({ freq: f, dur: 0.35, type: "sine", gain: 0.18, delay: i * 0.18 }),
  );
}

// Новые звуковые эффекты для микро-взаимодействий
export function sfxHover() {
  tone({ freq: 880, dur: 0.03, type: "sine", gain: 0.06 });
}

export function sfxClick() {
  tone({ freq: 1200, dur: 0.05, type: "triangle", gain: 0.08 });
}

export function sfxSuccess() {
  const arpeggio = [523.25, 659.25, 783.99];
  arpeggio.forEach((f, i) => {
    tone({ freq: f, dur: 0.1, type: "sine", gain: 0.12, delay: i * 0.08 });
  });
}

export function sfxSlide() {
  tone({ freq: 300, dur: 0.08, type: "sine", gain: 0.04, slideTo: 400 });
}

// Простая зацикленная мелодия для меню.
const MELODY = [
  [523.25, 0.5],
  [659.25, 0.5],
  [783.99, 0.5],
  [659.25, 0.5],
  [587.33, 0.5],
  [783.99, 0.5],
  [880.0, 1.0],
  [0, 0.5],
] as const;
const BASS = [130.81, 164.81, 146.83, 196.0] as const;

export function startMenuMusic() {
  const c = ac();
  if (!c || !master || musicTimer !== null) return;
  musicGain = c.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(master);

  const beat = 0.34;
  const loopLen = MELODY.reduce((s, [, d]) => s + d, 0) * beat;

  const playLoop = () => {
    let t = 0;
    MELODY.forEach(([f, d]) => {
      if (f) tone({ freq: f, dur: d * beat * 0.85, type: "triangle", gain: 0.07, delay: t, dest: musicGain! });
      t += d * beat;
    });
    BASS.forEach((f, i) =>
      tone({ freq: f, dur: beat * 0.9, type: "sine", gain: 0.06, delay: i * beat, dest: musicGain! }),
    );
    BASS.forEach((f, i) =>
      tone({
        freq: f,
        dur: beat * 0.9,
        type: "sine",
        gain: 0.06,
        delay: (i + BASS.length) * beat,
        dest: musicGain!,
      }),
    );
  };

  playLoop();
  musicTimer = window.setInterval(playLoop, loopLen * 1000);
}

export function stopMenuMusic() {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (musicGain) {
    try {
      musicGain.gain.setTargetAtTime(0, ac()?.currentTime ?? 0, 0.1);
    } catch {
      /* ignore */
    }
    const g = musicGain;
    musicGain = null;
    setTimeout(() => g.disconnect(), 600);
  }
}
