import { memo, useCallback, useEffect, useRef, useState, forwardRef } from "react";
import {
  SIZE,
  type Board,
  type Piece,
  type Shape,
  applyClears,
  canPlace,
  clearScore,
  difficultyFromScore,
  emptyBoard,
  findClears,
  hasAnyMove,
  place,
  randomPieceSet,
} from "@/lib/blast";
import {
  loadSoundPref,
  setSoundOn,
  sfxButton,
  sfxClear,
  sfxCombo,
  sfxGameOver,
  sfxInvalid,
  sfxNewPieces,
  sfxPickup,
  sfxPlace,
  startMenuMusic,
  stopMenuMusic,
  unlockAudio,
  sfxHover,
  sfxClick,
  sfxSuccess,
  sfxSlide,
} from "@/lib/audio";
import {
  getSessionUser,
  logout as authLogout,
  formatPhoneDisplay,
  referralLinkFor,
  type AuthUser,
} from "@/lib/auth-supabase";
import {
  saveGame,
  loadGame,
  clearSave as clearGameSave,
  saveBestScore,
  loadBestScore,
  syncBestScore,
  syncGame,
  getLeaderboard,
  type LeaderboardEntry,
} from "@/lib/storage-supabase";
import {
  initPushNotifications,
  scheduleDailyReminder,
  sendAchievementNotification,
  getTodayTask,
  completeTask,
  getWalletBalance,
  type DailyTask,
} from "@/lib/notifications";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import AuthScreen from "@/components/AuthScreen";
import { prepareStartAd, showStartAd } from "@/lib/ads";

const TUTORIAL_KEY = "blockblast_tutorial";
/** Matches `.board-frame` padding (`p-2` = 8px). */
const BOARD_PAD = 8;

function dailyCountdown() {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setHours(24, 0, 0, 0);
  const secondsLeft = Math.max(0, Math.ceil((nextReset.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function boardMetrics(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const pad = BOARD_PAD;
  const cs = (rect.width - pad * 2) / SIZE;
  return { rect, pad, cs };
}

type Screen = "menu" | "game" | "over" | "profile" | "leaderboard";
type GameTheme = "classic" | "sunset" | "ocean" | "neon";

const GAME_THEME_KEY = "blockblast_game_theme";
const PROFILE_STATS_PREFIX = "blockblast.profile.v1:";
const GAME_THEMES: { id: GameTheme; name: string; description: string; colors: [string, string, string] }[] = [
  { id: "classic", name: "Klassik", description: "Ýagty we tanyş", colors: ["#ff6b5f", "#f7c948", "#34d399"] },
  { id: "sunset", name: "Gün ýaşmagy", description: "Ýyly reňkler", colors: ["#ff8b5e", "#ff4f8b", "#a855f7"] },
  { id: "ocean", name: "Okean", description: "Sowuk tolkunlar", colors: ["#38bdf8", "#2dd4bf", "#6366f1"] },
  { id: "neon", name: "Neon", description: "Gijeki şöhle", colors: ["#d946ef", "#22d3ee", "#a3e635"] },
];

type DragGhost = {
  slot: number;
  piece: Piece;
  target: { row: number; col: number } | null;
  valid: boolean;
};

type DragState = DragGhost;
type TutorialStep = "drag" | "placed" | null;

type ProfileStats = {
  games: number;
  lines: number;
  combos: number;
  best: number;
};

function emptyProfileStats(): ProfileStats {
  return { games: 0, lines: 0, combos: 0, best: 0 };
}

function profileStatsKey(userId: string) {
  return `${PROFILE_STATS_PREFIX}${userId}`;
}

function loadProfileStats(userId: string, best = 0): ProfileStats {
  if (typeof window === "undefined") return { ...emptyProfileStats(), best };
  try {
    const raw = window.localStorage.getItem(profileStatsKey(userId));
    if (!raw) return { ...emptyProfileStats(), best };
    const parsed = JSON.parse(raw) as Partial<ProfileStats>;
    return {
      games: Number.isFinite(parsed.games) && (parsed.games ?? 0) >= 0 ? parsed.games! : 0,
      lines: Number.isFinite(parsed.lines) && (parsed.lines ?? 0) >= 0 ? parsed.lines! : 0,
      combos: Number.isFinite(parsed.combos) && (parsed.combos ?? 0) >= 0 ? parsed.combos! : 0,
      best: Math.max(best, Number.isFinite(parsed.best) && (parsed.best ?? 0) >= 0 ? parsed.best! : 0),
    };
  } catch {
    return { ...emptyProfileStats(), best };
  }
}

function saveProfileStats(userId: string, stats: ProfileStats) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(profileStatsKey(userId), JSON.stringify(stats));
  } catch {
    // Profile statistics remain available for the current session.
  }
}

type FloatPop = {
  id: number;
  amount: number;
  combo: boolean;
  x: number;
  y: number;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  tx: number;
  ty: number;
  duration: number;
};

type BoardCellProps = {
  cell: number | null;
  isClearing: boolean;
  isGhost: boolean;
  isBad: boolean;
};

const BoardCell = memo(function BoardCell({ cell, isClearing, isGhost, isBad }: BoardCellProps) {
  return (
    <div
      className={[
        "relative h-full w-full min-h-0 min-w-0 transition-[box-shadow,background-color,filter] duration-150",
        cell === null ? "cell-empty" : `block-face ${colorClass(cell)}`,
        isGhost ? "cell-ghost" : "",
        isBad ? "cell-bad" : "",
        isClearing ? "animate-cell-pop" : "",
      ].join(" ")}
    />
  );
});

function difficultyLabel(score: number): string | null {
  const d = difficultyFromScore(score);
  if (d < 0.2) return null;
  if (d < 0.45) return "Средний";
  if (d < 0.7) return "Сложный";
  return "Экстрим";
}

type SerializedPiece = {
  id: string;
  color: number;
  shape: {
    cells: [number, number][];
    w: number;
    h: number;
  };
};

type SavedGame = {
  board: Board;
  pieces: (SerializedPiece | null)[];
  score: number;
};

type UndoSnapshot = {
  board: Board;
  pieces: (Piece | null)[];
  score: number;
  profileStats: ProfileStats;
};

function colorClass(i: number) {
  return `block-c${i}`;
}

function serializePiece(p: Piece): SerializedPiece {
  return {
    id: p.id,
    color: p.color,
    shape: {
      cells: p.shape.cells.map(([r, c]) => [r, c] as [number, number]),
      w: p.shape.w,
      h: p.shape.h,
    },
  };
}

function hydratePiece(p: SerializedPiece): Piece {
  return {
    id: p.id,
    color: p.color,
    shape: {
      cells: p.shape.cells.map(([r, c]) => [r, c] as [number, number]),
      w: p.shape.w,
      h: p.shape.h,
    },
  };
}


export default function BlockGame() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("menu");
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [pieces, setPieces] = useState<(Piece | null)[]>([null, null, null]);
  const [score, setScore] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [scoreAnimating, setScoreAnimating] = useState(false);
  const [best, setBest] = useState(0);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
  const [clearing, setClearing] = useState<Set<string>>(new Set());
  const [shake, setShake] = useState(false);
  const [sound, setSound] = useState(true);
  const [paused, setPaused] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(null);
  const [hasSave, setHasSave] = useState(false);
  const [pops, setPops] = useState<FloatPop[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [boardFlash, setBoardFlash] = useState(false);
  const [profileStats, setProfileStats] = useState<ProfileStats>(emptyProfileStats);
  const [profileCopied, setProfileCopied] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardCountdown, setLeaderboardCountdown] = useState(dailyCountdown);
  const [walletPoints, setWalletPoints] = useState(0);
  const [dailyTask, setDailyTask] = useState<DailyTask | null>(null);
  const [themeShopOpen, setThemeShopOpen] = useState(false);
  const [gameTheme, setGameTheme] = useState<GameTheme>(() => {
    if (typeof window === "undefined") return "classic";
    const savedTheme = window.localStorage.getItem(GAME_THEME_KEY);
    return GAME_THEMES.some((item) => item.id === savedTheme) ? savedTheme as GameTheme : "classic";
  });
  const [comboBurst, setComboBurst] = useState<{ id: number; lines: number } | null>(null);
  const { isInstallable, install: installPWA } = usePWAInstall();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragGhost | null>(null);
  const boardLive = useRef(board);
  const metricsCache = useRef<ReturnType<typeof boardMetrics> | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const moveRaf = useRef(0);
  const popId = useRef(0);
  const particleId = useRef(0);
  const particleClearTimer = useRef(0);
  const comboBurstTimer = useRef(0);
  const comboBurstId = useRef(0);
  const pendingMoveTimer = useRef<number | null>(null);
  const gameOverTimer = useRef<number | null>(null);
  const tutorialTimer = useRef(0);
  const userRef = useRef<AuthUser | null>(null);
  const dailyTaskRef = useRef<DailyTask | null>(null);
  const dailyTaskCompletionRequested = useRef(false);
  userRef.current = user;
  boardLive.current = board;

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    metricsCache.current = null;
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    setDragGhost(null);
  }, []);

  const loadUserProgress = useCallback(async (u: AuthUser) => {
    const [bestScore, balance] = await Promise.all([loadBestScore(u.id), getWalletBalance(u.id)]);
    setBest(bestScore);
    setWalletPoints(balance);
    setProfileStats(loadProfileStats(u.id, bestScore));
    const savedGame = await loadGame(u.id);
    setHasSave(!!savedGame);
    setScore(0);
    setUndoSnapshot(null);
    setBoard(emptyBoard());
    setPieces([null, null, null]);
    setScreen("menu");
    setPaused(false);
    setTutorialStep(null);
    clearDrag();
    setPops([]);
    dailyTaskRef.current = null;
    dailyTaskCompletionRequested.current = false;
    setDailyTask(null);
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);

    void (async () => {
      try {
        const todayTask = await getTodayTask();
        dailyTaskRef.current = todayTask;
        setDailyTask(todayTask);
      } catch (error) {
        console.error('Error loading daily task:', error);
      }
    })();
  }, [clearDrag]);

  useEffect(() => {
    const initAuth = async () => {
      const session = await getSessionUser();
      setUser(session);
      setSound(loadSoundPref());
      if (session) {
        await loadUserProgress(session);
        setAuthReady(true);
        void prepareStartAd();
        // Уведомления не должны задерживать или прерывать запуск игры.
        void (async () => {
          try {
            await initPushNotifications();
            await scheduleDailyReminder();
          } catch (error) {
            console.error('Error initializing notifications:', error);
          }
        })();
        return;
      }
      setAuthReady(true);
    };
    initAuth();
  }, [loadUserProgress]);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const syncProgress = () => {
      void Promise.all([syncGame(user.id), syncBestScore(user.id)]);
    };

    if (navigator.onLine) syncProgress();
    window.addEventListener("online", syncProgress);
    return () => window.removeEventListener("online", syncProgress);
  }, [user]);

  useEffect(() => {
    if (screen !== "leaderboard") return;

    const updateCountdown = () => setLeaderboardCountdown(dailyCountdown());
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [screen]);

  const handleAuth = (u: AuthUser) => {
    setUser(u);
    loadUserProgress(u);
  };

  const handleLogout = () => {
    authLogout();
    stopMenuMusic();
    setUser(null);
    setUndoSnapshot(null);
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);
    setPaused(false);
    setTutorialStep(null);
    setScreen("menu");
  };

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    setSoundOn(on);
    unlockAudio();
    if (on && screen === "menu") startMenuMusic();
    if (!on) stopMenuMusic();
  };

  const handleInstallPWA = async () => {
    sfxButton();
    await installPWA();
  };

  const selectGameTheme = (nextTheme: GameTheme) => {
    setGameTheme(nextTheme);
    window.localStorage.setItem(GAME_THEME_KEY, nextTheme);
    sfxSuccess();
    buzz(35);
  };

  const handleButtonHover = () => {
    if (sound) sfxHover();
  };

  useEffect(() => {
    if (screen !== "menu") stopMenuMusic();
    return () => stopMenuMusic();
  }, [screen]);

  const saveBest = useCallback(async (v: number) => {
    const u = userRef.current;
    if (!u) return;
    setBest((prev) => {
      const newBest = Math.max(prev, v);
      saveBestScore(u.id, newBest);
      return newBest;
    });
  }, []);

  const recordProfileMove = useCallback((lines: number, nextScore: number) => {
    const u = userRef.current;
    if (!u) return;
    setProfileStats((prev) => {
      const next = {
        ...prev,
        lines: prev.lines + lines,
        combos: prev.combos + (lines > 1 ? 1 : 0),
        best: Math.max(prev.best, nextScore),
      };
      saveProfileStats(u.id, next);
      return next;
    });
  }, []);

  const spawnPop = useCallback((amount: number, lines: number) => {
    const el = boardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const id = ++popId.current;
    setPops((prev) => [
      ...prev,
      {
        id,
        amount,
        combo: lines > 1,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height * 0.42,
      },
    ]);
    setTimeout(() => {
      setPops((prev) => prev.filter((p) => p.id !== id));
    }, 1100);
  }, []);

  const spawnParticles = useCallback((cells: { row: number; col: number; color: number }[], lines: number) => {
    const el = boardRef.current;
    if (!el) return;
    const { rect, pad, cs } = boardMetrics(el);
    const particleCount = Math.min(7, 3 + Math.max(0, lines - 1) * 2);

    const newParticles: Particle[] = cells.flatMap(({ row, col, color }) => {
      const x = rect.left + pad + col * cs + cs / 2;
      const y = rect.top + pad + row * cs + cs / 2;

      return Array.from({ length: particleCount }, (_, i) => {
        const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.4;
        const distance = 28 + Math.random() * 22;
        const duration = 0.45 + Math.random() * 0.25;
        return {
          id: ++particleId.current,
          x,
          y,
          color: `var(--b${color})`,
          size: 3 + Math.random() * 3,
          tx: Math.cos(angle) * distance,
          ty: Math.sin(angle) * distance,
          duration,
        };
      });
    });

    setParticles((prev) => {
      const merged = [...prev, ...newParticles];
      return merged.length > 72 ? merged.slice(merged.length - 72) : merged;
    });

    window.clearTimeout(particleClearTimer.current);
    particleClearTimer.current = window.setTimeout(() => {
      setParticles([]);
    }, 750);
  }, []);

  const showComboBurst = useCallback((lines: number) => {
    window.clearTimeout(comboBurstTimer.current);
    setComboBurst({ id: ++comboBurstId.current, lines });
    comboBurstTimer.current = window.setTimeout(() => setComboBurst(null), 780);
  }, []);

  const beginFreshGame = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    unlockAudio();
    stopMenuMusic();
    const nextBoard = emptyBoard();
    const nextPieces = randomPieceSet();
    setBoard(nextBoard);
    setPieces(nextPieces);
    setScore(0);
    setProfileStats((prev) => {
      const next = { ...prev, games: prev.games + 1 };
      saveProfileStats(u.id, next);
      return next;
    });
    setClearing(new Set());
    clearDrag();
    setPaused(false);
    setPops([]);
    setParticles([]);
    setUndoSnapshot(null);
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);
    window.clearTimeout(tutorialTimer.current);
    setTutorialStep(null);
    setHasSave(false);
    setScreen("game");
    const serializedPieces = nextPieces.map((p) => (p ? serializePiece(p) : null));
    void saveGame(u.id, { board: nextBoard, pieces: serializedPieces, score: 0 })
      .then((saved) => setHasSave(saved));
  }, [clearDrag]);

  const continueGame = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    const saved = await loadGame(u.id);
    if (!saved) return;
    unlockAudio();
    stopMenuMusic();
    setBoard(saved.board);
    setPieces(saved.pieces.map((p) => (p ? hydratePiece(p) : null)));
    setScore(saved.score);
    setClearing(new Set());
    clearDrag();
    setPaused(false);
    setPops([]);
    setParticles([]);
    setUndoSnapshot(null);
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);
    setScreen("game");
  }, [clearDrag]);

  const startGame = useCallback(async () => {
    await showStartAd();
    const seen = localStorage.getItem(TUTORIAL_KEY) === "1";
    beginFreshGame();
    if (!seen) setTutorialStep("drag");
  }, [beginFreshGame]);

  const pauseGame = () => {
    if (screen !== "game" || dragRef.current) return;
    clearDrag();
    setPaused(true);
  };

  const resumeGame = () => setPaused(false);

  const quitToMenu = async () => {
    const u = userRef.current;
    setPaused(false);
    clearDrag();
    setUndoSnapshot(null);
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);
    if (u) {
      const saved = await loadGame(u.id);
      setHasSave(!!saved);
    } else {
      setHasSave(false);
    }
    setScreen("menu");
  };

  const showLeaderboard = async () => {
    setLeaderboardLoading(true);
    setScreen("leaderboard");
    const data = await getLeaderboard(50);
    setLeaderboard(data);
    setLeaderboardLoading(false);
  };

  const buzz = (ms: number | number[]) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  };

  const buzzPickup = () => {
    buzz(25);
    if (sound) sfxSlide();
  };
  const buzzPlace = () => {
    buzz(35);
    if (sound) sfxClick();
  };
  const buzzClear = (lines: number) => {
    if (lines === 1) {
      buzz(50);
      if (sound) sfxSuccess();
    }
    else if (lines === 2) buzz([45, 25, 55, 25, 70]);
    else if (lines >= 3) buzz([70, 35, 85, 35, 105, 35, 130]);
  };
  const buzzInvalid = () => {
    buzz([20, 20, 20]);
    if (sound) sfxInvalid();
  };
  const buzzGameOver = () => {
    buzz([100, 50, 100, 50, 150]);
    if (sound) sfxGameOver();
  };

  const cellFromPoint = (x: number, y: number, piece: Piece) => {
    const m = metricsCache.current ?? (boardRef.current ? boardMetrics(boardRef.current) : null);
    if (!m) return null;
    metricsCache.current = m;
    const { rect, pad, cs } = m;
    const col = Math.round((x - rect.left - pad - (piece.shape.w * cs) / 2) / cs);
    const row = Math.round((y - rect.top - pad - (piece.shape.h * cs) / 2 - cs * 0.9) / cs);
    if (row < -2 || row > SIZE + 1 || col < -2 || col > SIZE + 1) return null;
    return { row, col };
  };

  const placeFloating = (x: number, y: number, piece: Piece, unit: number) => {
    const el = floatingRef.current;
    if (!el) return;
    const left = x - (piece.shape.w * unit) / 2;
    const top = y - (piece.shape.h * unit) / 2 - unit * 0.9;
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };

  const onPointerDown = (e: React.PointerEvent, slot: number) => {
    if (paused || screen !== "game") return;
    const piece = pieces[slot];
    if (!piece) return;
    unlockAudio();
    sfxPickup();
    buzzPickup();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const metrics = boardRef.current ? boardMetrics(boardRef.current) : null;
    metricsCache.current = metrics;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const t = cellFromPoint(e.clientX, e.clientY, piece);
    const next: DragGhost = {
      slot,
      piece,
      target: t,
      valid: t ? canPlace(boardLive.current, piece.shape, t.row, t.col) : false,
    };
    dragRef.current = next;
    setDragGhost(next);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || paused) return;
    e.preventDefault();
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      const d = dragRef.current;
      if (!d) return;
      const { x, y } = lastPointer.current;
      const unit = metricsCache.current?.cs ?? 40;
      placeFloating(x, y, d.piece, unit);

      const t = cellFromPoint(x, y, d.piece);
      const valid = t ? canPlace(boardLive.current, d.piece.shape, t.row, t.col) : false;
      const sameTarget =
        (t === null && d.target === null) ||
        (t !== null && d.target !== null && t.row === d.target.row && t.col === d.target.col);
      if (sameTarget && d.valid === valid) return;

      const next: DragGhost = { slot: d.slot, piece: d.piece, target: t, valid };
      dragRef.current = next;
      setDragGhost(next);
    });
  };

  const afterMove = async (finalBoard: Board, usedSlot: number, nextScore: number) => {
    const u = userRef.current;
    if (!u) return;
    setPieces((prev) => {
      let rest: (Piece | null)[] = prev.map((p, i) => (i === usedSlot ? null : p));
      if (rest.every((p) => p === null)) {
        rest = randomPieceSet(3, nextScore);
        sfxNewPieces();
      }
      const serializedPieces = rest.map((p) => (p ? serializePiece(p) : null));
      saveGame(u.id, { board: finalBoard, pieces: serializedPieces, score: nextScore });
      setHasSave(true);
      gameOverTimer.current = window.setTimeout(() => {
        gameOverTimer.current = null;
        if (!hasAnyMove(finalBoard, rest)) {
          sfxGameOver();
          buzzGameOver();
          setHasSave(false);
          setScreen("over");
          void clearGameSave(u.id);
        }
      }, 0);
      return rest;
    });

    // Проверяем выполнение ежедневного задания
    const todayTask = dailyTaskRef.current;
    if (todayTask && nextScore >= todayTask.target_score && !dailyTaskCompletionRequested.current) {
      dailyTaskCompletionRequested.current = true;
      try {
        const reward = await completeTask(todayTask.id);
        if (reward === null) {
          dailyTaskCompletionRequested.current = false;
        } else if (reward > 0) {
          setWalletPoints((current) => current + reward);
          await sendAchievementNotification(
            'Задание выполнено!',
            `В кошелёк начислено ${reward} очков!`
          );
        }
      } catch (error) {
        console.error('Error checking task completion:', error);
      }
    }
  };

  const finishDrop = () => {
    const drag = dragRef.current;
    if (!drag || paused) return;
    const { piece, target, valid, slot } = drag;
    clearDrag();
    if (!target || !valid) {
      setShake(true);
      buzzInvalid();
      sfxInvalid();
      setTimeout(() => setShake(false), 320);
      return;
    }
    if (pendingMoveTimer.current !== null) window.clearTimeout(pendingMoveTimer.current);
    if (gameOverTimer.current !== null) window.clearTimeout(gameOverTimer.current);
    setUndoSnapshot({
      board: boardLive.current,
      pieces: pieces.slice(),
      score,
      profileStats,
    });
    let next = place(boardLive.current, piece, target.row, target.col);
    let gained = piece.shape.cells.length;
    const { rows, cols } = findClears(next);
    const lines = rows.length + cols.length;
    sfxPlace();

    if (tutorialStep === "drag") {
      localStorage.setItem(TUTORIAL_KEY, "1");
      setTutorialStep("placed");
      window.clearTimeout(tutorialTimer.current);
      tutorialTimer.current = window.setTimeout(() => setTutorialStep(null), 1800);
    }

    if (lines > 0) {
      const marks = new Set<string>();
      const clearedCells: { row: number; col: number; color: number }[] = [];
      rows.forEach((r) => {
        for (let c = 0; c < SIZE; c++) {
          marks.add(`${r}-${c}`);
          if (next[r][c] !== null) {
            clearedCells.push({ row: r, col: c, color: next[r][c]! });
          }
        }
      });
      cols.forEach((c) => {
        for (let r = 0; r < SIZE; r++) {
          marks.add(`${r}-${c}`);
          if (next[r][c] !== null) {
            clearedCells.push({ row: r, col: c, color: next[r][c]! });
          }
        }
      });
      const bonus = clearScore(lines, score);
      gained += bonus;
      buzzClear(lines);
      sfxClear(lines);
      if (lines > 1) sfxCombo();
      spawnPop(gained, lines);
      spawnParticles(clearedCells, lines);
      if (lines > 1) {
        setBoardFlash(true);
        showComboBurst(lines);
        setTimeout(() => setBoardFlash(false), 450);
      }
      setBoard(next);
      setClearing(marks);
      const cleared = applyClears(next, rows, cols);
      const newScore = score + gained;
      setScore(newScore);
      setScoreAnimating(true);
      setTimeout(() => setScoreAnimating(false), 300);
      saveBest(newScore);
      recordProfileMove(lines, newScore);
      pendingMoveTimer.current = window.setTimeout(() => {
        pendingMoveTimer.current = null;
        setClearing(new Set());
        setBoard(cleared);
        afterMove(cleared, slot, newScore);
      }, 280);
      return;
    }

    setBoard(next);
    const newScore = score + gained;
    setScore(newScore);
    setScoreAnimating(true);
    setTimeout(() => setScoreAnimating(false), 300);
    saveBest(newScore);
    recordProfileMove(0, newScore);
    afterMove(next, slot, newScore);
  };

  const undoLastMove = useCallback(() => {
    const snapshot = undoSnapshot;
    const u = userRef.current;
    if (!snapshot || !u) return;
    if (pendingMoveTimer.current !== null) {
      window.clearTimeout(pendingMoveTimer.current);
      pendingMoveTimer.current = null;
    }
    if (gameOverTimer.current !== null) {
      window.clearTimeout(gameOverTimer.current);
      gameOverTimer.current = null;
    }
    clearDrag();
    setBoard(snapshot.board);
    setPieces(snapshot.pieces);
    setScore(snapshot.score);
    setClearing(new Set());
    setPops([]);
    setParticles([]);
    setBoardFlash(false);
    setPaused(false);
    setHasSave(true);
    setScreen("game");
    setProfileStats(snapshot.profileStats);
    saveProfileStats(u.id, snapshot.profileStats);
    setUndoSnapshot(null);
    void saveGame(u.id, {
      board: snapshot.board,
      pieces: snapshot.pieces.map((p) => (p ? serializePiece(p) : null)),
      score: snapshot.score,
    });
    buzz(35);
    if (sound) sfxClick();
  }, [clearDrag, profileStats, sound, undoSnapshot]);

  const share = async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    const text = `${currentUser.name} ${score} puan jygnady Block Blast-da! Rekord: ${Math.max(best, score)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Block Blast", text });
      else await navigator.clipboard.writeText(text);
    } catch {
      /* отменено пользователем */
    }
  };

  const referralLink = userRef.current ? referralLinkFor(userRef.current.id) : "";

  const openProfile = () => {
    setProfileCopied(false);
    setScreen("profile");
  };

  const copyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setProfileCopied(true);
      sfxSuccess();
      window.setTimeout(() => setProfileCopied(false), 1800);
    } catch {
      setProfileCopied(false);
    }
  };

  const ghost = new Set<string>();
  if (dragGhost?.target && dragGhost.valid) {
    dragGhost.piece.shape.cells.forEach(([r, c]) =>
      ghost.add(`${dragGhost.target!.row + r}-${dragGhost.target!.col + c}`),
    );
  }
  const badGhost = new Set<string>();
  if (dragGhost?.target && !dragGhost.valid) {
    dragGhost.piece.shape.cells.forEach(([r, c]) =>
      badGhost.add(`${dragGhost.target!.row + r}-${dragGhost.target!.col + c}`),
    );
  }

  const diffLabel = screen === "game" ? difficultyLabel(score) : null;
  const dragUnit = metricsCache.current?.cs ?? 40;

  if (!authReady) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  return (
    <div
      className={[
        "game-shell relative mx-auto flex h-dvh max-h-dvh w-full max-w-md touch-none select-none flex-col overflow-hidden px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]",
        dragGhost ? "is-dragging" : "",
        `game-theme-${gameTheme}`,
      ].join(" ")}
      onPointerDown={() => {
        unlockAudio();
        if (screen === "menu" && sound) startMenuMusic();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrop}
      onPointerCancel={finishDrop}
    >
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Hasap</p>
          <p className={`score-hero text-5xl font-semibold leading-none text-foreground tabular-nums ${scoreAnimating ? 'animate-score-pop' : ''}`}>{score}</p>
          {diffLabel && (
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{diffLabel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="best-chip">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Rekord</p>
            <p className="font-display text-lg font-semibold tabular-nums text-foreground">
              {Math.max(best, score)}
            </p>
          </div>
          {screen === "game" && (
            <>
              <button
                type="button"
                aria-label="Soňky ädimi yzyna al"
                title="Soňky ädimi yzyna al"
                disabled={!undoSnapshot}
                onClick={() => { undoLastMove(); sfxButton(); }}
                onMouseEnter={handleButtonHover}
                className={`icon-btn relative z-30 ${!undoSnapshot ? "opacity-35" : ""}`}
              >
                <IconUndo />
              </button>
              <button
                type="button"
                aria-label="Sež"
                onClick={() => { pauseGame(); sfxButton(); }}
                onMouseEnter={handleButtonHover}
                className="icon-btn relative z-30"
              >
                <IconPause />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={sound ? "Sesi öçürmek" : "Ses açmak"}
            onClick={() => { toggleSound(); sfxButton(); }}
            onMouseEnter={handleButtonHover}
            className="icon-btn relative z-30"
          >
            {sound ? <IconSoundOn /> : <IconSoundOff />}
          </button>
        </div>
      </header>

      <div className="board-wrap">
        <div
          ref={boardRef}
          className={[
            "board-frame gap-0 rounded-3xl p-2",
            shake ? "animate-board-shake" : "",
            boardFlash ? "board-flash" : "",
          ].join(" ")}
        >
          {board.map((row, r) =>
            row.map((cell, c) => {
              const key = `${r}-${c}`;
              const isClearing = clearing.has(key);
              const isGhost = ghost.has(key);
              const isBad = badGhost.has(key);
              return <BoardCell key={key} cell={cell} isClearing={isClearing} isGhost={isGhost} isBad={isBad} />;
            }),
          )}
        </div>
      </div>

      <div className="tray-rail mt-auto shrink-0 pt-6">
        {pieces.map((p, i) => (
          <div key={i} className="tray-slot" onPointerDown={(e) => onPointerDown(e, i)}>
            {p && dragGhost?.slot !== i && <PieceView piece={p} unit={20} className="animate-piece-in" />}
          </div>
        ))}
      </div>

      {dragGhost && (
        <FloatingPiece
          ref={floatingRef}
          piece={dragGhost.piece}
          x={lastPointer.current.x}
          y={lastPointer.current.y}
          unit={dragUnit}
        />
      )}

      {pops.map((p) => (
        <div
          key={p.id}
          className="animate-score-float fixed z-40 text-center"
          style={{ left: p.x, top: p.y }}
        >
          {p.combo && (
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Комбо</p>
          )}
          <p className="text-3xl font-semibold tabular-nums text-foreground drop-shadow-[0_2px_10px_oklch(0_0_0_/_45%)]">
            +{p.amount}
          </p>
        </div>
      ))}

      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            background: p.color,
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
            '--duration': `${p.duration}s`,
          } as React.CSSProperties}
        />
      ))}

      {comboBurst && (
        <div key={comboBurst.id} className={`combo-burst combo-burst-${Math.min(comboBurst.lines, 4)}`} aria-live="polite">
          <span>COMBO</span>
          <strong>x{comboBurst.lines}</strong>
        </div>
      )}

      {tutorialStep && screen === "game" && !paused && (
        <TutorialCoach step={tutorialStep} />
      )}

      {screen === "menu" && !themeShopOpen && (
        <Overlay className="animate-screen-transition">
          <p className="brand-title text-[3.35rem] text-foreground sm:text-6xl">
            BLOCK
            <span className="text-primary"> BLAST</span>
          </p>
          <p className="mt-4 text-sm font-semibold text-muted-foreground">Setirleri ýygyn, bloklary partlat</p>
          <p className="mt-6 text-sm font-bold text-foreground">Salam, {user.name}!</p>
          <p className="mt-1 text-xs text-muted-foreground">ID: {user.id.slice(0, 8)}...</p>
          <p className="mt-2 font-display text-base font-semibold tabular-nums text-foreground/80">
            Rekord · {best}
          </p>
          {hasSave ? (
            <>
              <button className="btn-primary btn-pulse mt-8" onClick={() => { continueGame(); sfxButton(); }}>
                Dowam et
              </button>
              <button className="btn-ghost mt-3" onClick={() => { startGame(); sfxButton(); }}>
                Täze oýun
              </button>
            </>
          ) : (
            <button className="btn-primary btn-pulse mt-8" onClick={() => { startGame(); sfxButton(); }}>
              Oýnamak
            </button>
          )}
          <button
            className="mt-5 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => { showLeaderboard(); sfxButton(); }}
          >
            Reýting
          </button>
          <button
            className="mt-3 text-sm font-semibold text-primary underline-offset-4 hover:text-primary/80 hover:underline"
            onClick={() => { openProfile(); sfxButton(); }}
          >
            Profil
          </button>
          <button
            className="mt-3 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => { setThemeShopOpen(true); sfxButton(); }}
          >
            Temalar dükany
          </button>
          <button
            className="mt-3 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={handleLogout}
          >
            Çykmak
          </button>
          {isInstallable && (
            <button
              className="mt-3 text-sm font-semibold text-primary underline-offset-4 hover:text-primary/80 hover:underline"
              onClick={handleInstallPWA}
            >
              Düşürmek
            </button>
          )}
        </Overlay>
      )}

      {themeShopOpen && (
        <Overlay>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Dükän</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">Temalar</h2>
          <p className="mt-2 text-sm text-muted-foreground">Meýdanyň we bloklaryň keşbini saýla.</p>
          <div className="theme-grid mt-6 w-full">
            {GAME_THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`theme-card ${gameTheme === item.id ? "is-selected" : ""}`}
                onClick={() => selectGameTheme(item.id)}
              >
                <span className="theme-preview" aria-hidden>
                  {item.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
                </span>
                <span className="theme-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                {gameTheme === item.id && <span className="theme-check">✓</span>}
              </button>
            ))}
          </div>
          <button className="btn-primary mt-7" onClick={() => { setThemeShopOpen(false); sfxButton(); }}>
            Taýýar
          </button>
        </Overlay>
      )}

      {screen === "over" && (
        <Overlay className="animate-screen-transition">
          <h2 className="font-display text-3xl font-semibold text-foreground">Oýun gutardy</h2>
          <p className="score-hero mt-6 text-6xl font-semibold tabular-nums text-primary">{score}</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            Rekord · {Math.max(best, score)}
          </p>
          <button className="btn-primary btn-pulse mt-8" onClick={() => { startGame(); sfxButton(); }}>
            Gaýtadan oýnamak
          </button>
          {undoSnapshot && (
            <button className="btn-ghost mt-3" onClick={() => { undoLastMove(); sfxButton(); }}>
              Soňky ädimi yzyna al
            </button>
          )}
          <button className="btn-ghost mt-3" onClick={() => { share(); sfxButton(); }}>
            Netijäni paýlaşmak
          </button>
          <button className="btn-ghost mt-3" onClick={() => { quitToMenu(); sfxButton(); }}>
            Menýu
          </button>
        </Overlay>
      )}

      {screen === "profile" && (
        <Overlay>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Oýunçy profili</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">{user.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{formatPhoneDisplay(user.phone)}</p>
          <div className="mt-6 w-full max-w-xs rounded-2xl bg-primary/10 p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Gapjyk</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular-nums text-primary">{walletPoints}</p>
            <p className="mt-1 text-xs font-semibold text-foreground/80">Gapjykdaky oçko</p>
          </div>
          {dailyTask && (
            <div className="mt-3 w-full max-w-xs rounded-2xl bg-card/70 p-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Soňky ýumuş</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{dailyTask.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dailyTask.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-bold text-primary">+{dailyTask.reward_points}</span>
              </div>
            </div>
          )}
          <div className="mt-7 grid w-full max-w-xs grid-cols-2 gap-3">
            <div className="rounded-2xl bg-card/70 p-4 text-center">
              <p className="text-2xl font-display font-semibold tabular-nums text-primary">{profileStats.best}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Rekord</p>
            </div>
            <div className="rounded-2xl bg-card/70 p-4 text-center">
              <p className="text-2xl font-display font-semibold tabular-nums text-primary">{profileStats.games}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Oýunlar</p>
            </div>
            <div className="rounded-2xl bg-card/70 p-4 text-center">
              <p className="text-2xl font-display font-semibold tabular-nums text-primary">{profileStats.lines}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Setirler</p>
            </div>
            <div className="rounded-2xl bg-card/70 p-4 text-center">
              <p className="text-2xl font-display font-semibold tabular-nums text-primary">{profileStats.combos}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Kombo</p>
            </div>
          </div>
          <div className="mt-6 w-full rounded-2xl bg-card/70 p-4 text-left">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Siziň referral linkiňiz</p>
            <p className="mt-2 break-all text-sm font-semibold text-foreground">{referralLink}</p>
            <button className="btn-primary mt-4 w-full" onClick={() => { copyReferralLink(); sfxButton(); }}>
              {profileCopied ? "Göçürildi" : "Linki göçür"}
            </button>
          </div>
          <button className="btn-ghost mt-4" onClick={() => { setScreen("menu"); sfxButton(); }}>
            Menýu
          </button>
        </Overlay>
      )}

      {screen === "leaderboard" && (
        <Overlay className="animate-screen-transition">
          <div className="mb-3 rounded-2xl bg-primary/10 px-5 py-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">24 sagat galýar</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-primary">{leaderboardCountdown}</p>
          </div>
          <h2 className="font-display text-3xl font-semibold text-foreground">Reýting</h2>
          {leaderboardLoading ? (
            <p className="mt-8 text-sm text-muted-foreground">Ýüklenýär...</p>
          ) : (
            <div className="mt-6 w-full max-w-sm max-h-[60vh] overflow-y-auto">
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">Has ýazgy ýok</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={`${entry.name}-${entry.score}-${index}`}
                      className={`flex items-center justify-between rounded-lg p-3 ${
                        index === 0 ? 'bg-primary/10' : 'bg-[oklch(0.18_0.02_240_/_30%)]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold text-lg w-6 text-center">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-foreground">{entry.name}</p>
                        </div>
                      </div>
                      <p className="font-display font-semibold tabular-nums text-primary">
                        {entry.score.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="btn-primary mt-6" onClick={() => { setScreen('menu'); sfxButton(); }}>
            Menýu
          </button>
        </Overlay>
      )}

      {paused && screen === "game" && (
        <Overlay>
          <h2 className="font-display text-3xl font-semibold text-foreground">Sež</h2>
          <button className="btn-primary btn-pulse mt-8" onClick={() => { resumeGame(); sfxButton(); }}>
            Dowam et
          </button>
          <button className="btn-ghost mt-3" onClick={() => { quitToMenu(); sfxButton(); }}>
            Menýu
          </button>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in fixed inset-0 z-20 flex flex-col items-center justify-center bg-[var(--overlay)] px-8 text-center">
      <div className="overlay-panel flex w-full max-w-sm flex-col items-center">{children}</div>
    </div>
  );
}

function TutorialCoach({ step }: { step: Exclude<TutorialStep, null> }) {
  const placed = step === "placed";

  return (
    <aside className={`tutorial-coach ${placed ? "tutorial-coach-success" : ""}`} aria-live="polite">
      <span className="tutorial-coach-icon" aria-hidden>{placed ? "✓" : "↓"}</span>
      <div>
        <p className="tutorial-coach-title">{placed ? "Отлично!" : "Ваш первый ход"}</p>
        <p className="tutorial-coach-text">
          {placed ? "Продолжайте заполнять ряды и столбцы." : "Перетащите любую фигуру из нижней панели на поле."}
        </p>
      </div>
    </aside>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" role="status" aria-live="polite">
      <div className="loading-orb loading-orb-left" aria-hidden />
      <div className="loading-orb loading-orb-right" aria-hidden />
      <div className="loading-card">
        <div className="loading-mark" aria-hidden>
          <span className="loading-block loading-block-c1" />
          <span className="loading-block loading-block-c2" />
          <span className="loading-block loading-block-c3" />
          <span className="loading-block loading-block-c4" />
          <span className="loading-block loading-block-c5" />
          <span className="loading-block loading-block-c6" />
        </div>
        <p className="loading-kicker">BLOCK BLAST</p>
        <h1 className="loading-title">Ready for a<br /><span>bright move?</span></h1>
        <div className="loading-progress" aria-hidden><span /></div>
        <p className="loading-label">Loading game</p>
      </div>
    </main>
  );
}

function IconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 8 4 12l5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12h8a5 5 0 1 1 0 10h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconSoundOn() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10v4a1 1 0 0 0 1 1h2.4l3.3 2.6a1 1 0 0 0 1.6-.8V7.2a1 1 0 0 0-1.6-.8L7.4 9H5a1 1 0 0 0-1 1Z"
        fill="currentColor"
      />
      <path
        d="M16.2 8.2a4.5 4.5 0 0 1 0 7.6M18.5 6a7.5 7.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSoundOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10v4a1 1 0 0 0 1 1h2.4l3.3 2.6a1 1 0 0 0 1.6-.8V7.2a1 1 0 0 0-1.6-.8L7.4 9H5a1 1 0 0 0-1 1Z"
        fill="currentColor"
      />
      <path d="M16 9.5 20.5 14M20.5 9.5 16 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const PieceView = memo(function PieceView({ piece, unit, className = "" }: { piece: Piece; unit: number; className?: string }) {
  return (
    <div
      className={`relative ${className}`}
      style={{ width: piece.shape.w * unit, height: piece.shape.h * unit }}
    >
      {piece.shape.cells.map(([r, c]) => (
        <div
          key={`${r}-${c}`}
          className={`block-face absolute ${colorClass(piece.color)}`}
          style={{
            position: "absolute",
            left: c * unit,
            top: r * unit,
            width: unit - 2,
            height: unit - 2,
          }}
        />
      ))}
    </div>
  );
});

const FloatingPiece = forwardRef<
  HTMLDivElement,
  { piece: Piece; x: number; y: number; unit: number }
>(function FloatingPiece({ piece, x, y, unit }, ref) {
  const left = x - (piece.shape.w * unit) / 2;
  const top = y - (piece.shape.h * unit) / 2 - unit * 0.9;
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-30 opacity-95"
      style={{
        left: 0,
        top: 0,
        width: piece.shape.w * unit,
        height: piece.shape.h * unit,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        willChange: "transform",
        boxShadow: "0 10px 22px oklch(0 0 0 / 35%)",
      }}
    >
      <PieceView piece={piece} unit={unit} />
    </div>
  );
});
