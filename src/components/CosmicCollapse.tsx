import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Engine, type HudState } from "@/game/engine";
import { ACHIEVEMENTS, CATALOG_SIZE, PLAYER, SKINS, kindAt } from "@/game/data";
import {
  defaultSave, formatMass, loadSave, nextAchievement, recordAbsorb, skinOwned, storageAvailable,
  unlockAchievements, writeSave, type SaveData,
} from "@/game/logic";
import { sfx } from "@/game/audio";
import { drawBlackHole } from "@/game/blackhole";
import { BOT_COUNT_OPTIONS, type LeaderEntry } from "@/game/arena";
import { Button } from "@/components/ui/button";

type Screen = "menu" | "arena-setup" | "eliminated" | "play" | "achievements" | "stats" | "hangar" | "settings";
interface Confirm { title: string; body: string; yes: string; onYes: () => void; }

const TUTORIAL = [
  "Steer with your mouse or WASD. Hold click or Space to boost. Press E to core-strike bigger rivals.",
  "Look for objects small enough to absorb — they glow with a ring.",
  "Nearby objects are pulled toward your event horizon.",
  "Every absorption adds mass. Locked objects show a padlock.",
  "Grow forever — bigger objects appear as you grow.",
];
const fmtTime = (s: number) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? h + "h " : ""}${m}m ${Math.floor(s % 60)}s`; };

export default function CosmicCollapse() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const saveRef = useRef(save);
  const [screen, setScreen] = useState<Screen>("menu");
  const screenRef = useRef(screen); screenRef.current = screen;
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const [settingsFrom, setSettingsFrom] = useState<"menu" | "pause">("menu");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [hud, setHud] = useState<HudState>({ mass: 0, time: 0, strikeReady: 1, strikePhase: "ready" });
  const [toasts, setToasts] = useState<{ id: number; msg: string; ach?: boolean }[]>([]);
  const [tut, setTut] = useState<number | null>(null);
  const tutRef = useRef<{ step: number | null; since: number; flags: Set<string> }>({ step: null, since: 0, flags: new Set() });
  const toastId = useRef(0);
  const lastTime = useRef(0);
  const dirty = useRef(false);
  const [arenaMode, setArenaMode] = useState(false);
  const [arenaState, setArenaState] = useState<{ leaders: LeaderEntry[]; rank: number; alive: number }>({ leaders: [], rank: 101, alive: 101 });
  const [killer, setKiller] = useState("");
  const [feed, setFeed] = useState<string[]>([]);

  const commit = useCallback((s: SaveData) => { saveRef.current = s; setSave(s); writeSave(s); dirty.current = false; }, []);
  const toast = useCallback((msg: string, ach = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, msg, ach }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  /** Persist run mass + play time from the engine. */
  const flush = useCallback(() => {
    const e = engineRef.current; if (!e || e.mode !== "play" || e.arena) return;
    const dtp = Math.max(0, e.runTime - lastTime.current); lastTime.current = e.runTime;
    const s = saveRef.current;
    commit({ ...s, runMass: e.player.mass, bestMass: Math.max(s.bestMass, e.player.mass), stats: { ...s.stats, playTime: s.stats.playTime + dtp } });
  }, [commit]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const e = new Engine(canvas, {
      onHud: setHud,
      onArena: setArenaState,
      onKill: (message) => setFeed((old) => [...old.slice(-2), message]),
      onEliminated: (name) => { setKiller(name); setPaused(false); setScreen("eliminated"); },
      onPauseRequest: () => { if (!pausedRef.current) doPause(); else if (screenRef.current === "play") doResume(); },
      onBlur: () => doPause(),
      onToast: (m) => toast(m),
      onTutorial: (ev) => { tutRef.current.flags.add(ev); },
      onAbsorb: (kind, _gain, mass) => {
        if (engineRef.current?.arena) return;
        let s = { ...saveRef.current, stats: recordAbsorb(saveRef.current.stats, kind) };
        const r = unlockAchievements(s, mass); s = r.save;
        saveRef.current = s; dirty.current = true;
        if (r.unlocked.length) {
          for (const a of r.unlocked) {
            toast(`Achievement unlocked · ${a.icon} ${a.name}`, true);
            const sk = SKINS.find((k) => k.achievement === a.id); if (sk) toast(`New skin: ${sk.name}`);
          }
          sfx.complete(); commit(s);
        }
      },
    });
    engineRef.current = e;
    sfx.music(true);
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const iv = setInterval(() => { if (screenRef.current === "play") flush(); else if (dirty.current) commit(saveRef.current); }, 3000);
    const unload = () => flush();
    window.addEventListener("beforeunload", unload);
    return () => { clearInterval(iv); e.destroy(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); window.removeEventListener("beforeunload", unload); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setConfig({ skin: save.skin, settings: save.settings });
    sfx.set(save.settings);
  }, [save]);

  useEffect(() => {
    const id = setInterval(() => {
      const T = tutRef.current; if (T.step === null || pausedRef.current) return;
      const el = (performance.now() - T.since) / 1000;
      const need = [() => T.flags.has("moved"), () => el > 2.5 && T.flags.has("pulled"), () => el > 2 && T.flags.has("absorbed"), () => el > 3, () => el > 4][T.step];
      if (need()) advanceTut();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTutStep = (s: number | null) => {
    tutRef.current.step = s; tutRef.current.since = performance.now(); setTut(s);
    if (engineRef.current) engineRef.current.highlight = s === 1;
  };
  const advanceTut = () => { const s = tutRef.current.step; if (s === null) return; if (s >= TUTORIAL.length - 1) { endTut(); return; } setTutStep(s + 1); };
  const endTut = () => { setTutStep(null); if (!saveRef.current.tutorialDone) commit({ ...saveRef.current, tutorialDone: true }); };

  const click = () => sfx.click();
  const doPause = () => { if (screenRef.current !== "play") return; engineRef.current?.pause(); flush(); setPaused(true); };
  const doResume = () => { engineRef.current?.resume(); setPaused(false); };

  const startRun = (mass: number) => {
    setArenaMode(false); setPaused(false); setConfirm(null);
    engineRef.current?.startRun(mass); lastTime.current = 0;
    commit({ ...saveRef.current, runMass: Math.max(PLAYER.startMass, mass) });
    tutRef.current.flags = new Set();
    setTutStep(!saveRef.current.tutorialDone ? 0 : null);
    setScreen("play");
  };
  const startArena = () => {
    flush(); setArenaMode(true); setPaused(false); setConfirm(null); setFeed([]); setTutStep(null);
    engineRef.current?.startArena(saveRef.current.settings.botCount); setScreen("play");
  };
  const moveJoystick = useCallback((x: number, y: number) => engineRef.current?.setJoystick(x, y), []);
  const toMenu = () => { flush(); engineRef.current?.startDemo(); setPaused(false); setTutStep(null); setConfirm(null); setScreen("menu"); };
  const newGame = () => {
    if (saveRef.current.runMass > PLAYER.startMass + 5) setConfirm({ title: "Start a new black hole?", body: "Your current run's mass resets to 10. Personal best, achievements and stats are kept.", yes: "Start over", onYes: () => startRun(PLAYER.startMass) });
    else startRun(PLAYER.startMass);
  };

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const next = nextAchievement(save, hud.mass);
  const best = Math.max(save.bestMass, hud.mass);

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground" style={{ touchAction: "none" }}>
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-label="Game view" />

      <div className="pointer-events-none absolute left-1/2 top-28 z-40 flex -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={`cc-toast cc-panel px-4 py-2 text-center text-sm font-semibold ${t.ach ? "cc-highlight text-gold" : ""}`}>{t.msg}</div>
        ))}
      </div>

      {screen === "menu" && (
        <div className="cc-screen absolute inset-0 z-20 flex flex-col items-center justify-between gap-4 overflow-y-auto p-4 sm:p-6">
          <div className="flex w-full justify-end"><span className="cc-chip">Best {formatMass(save.bestMass)} mass</span></div>
          <div className="text-center">
            <h1 className="cc-title text-4xl leading-none sm:text-6xl md:text-7xl">COSMIC<br />COLLAPSE</h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">Begin as a speck. Never stop growing.</p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2">
            <Button variant="secondary" className="cc-btn cc-btn-primary py-4 text-base" onClick={() => { click(); startArena(); }}>Play</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="cc-btn" onClick={() => { click(); setScreen("achievements"); }}>Achievements</Button>
              <Button variant="secondary" className="cc-btn" onClick={() => { click(); setScreen("stats"); }}>Statistics</Button>
              <Button variant="secondary" className="cc-btn" onClick={() => { click(); setScreen("hangar"); }}>Skins</Button>
              <Button variant="secondary" className="cc-btn" onClick={() => { click(); setSettingsFrom("menu"); setScreen("settings"); }}>Settings</Button>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">Steer with your mouse or WASD · Hold click or Space to boost · E to strike · Esc to pause</p>
          </div>
        </div>
      )}

      {screen === "arena-setup" && (
        <Overlay>
          <h2 className="cc-title mb-2 text-3xl">Arena</h2>
          <p className="mb-5 text-sm text-muted-foreground">Compete against 100 rivals</p>
          <fieldset className="mb-6 w-full"><legend className="mb-2 text-sm">Opponents</legend>
            <div className="grid grid-cols-4 gap-2">{BOT_COUNT_OPTIONS.map((count) => (
              <Button key={count} variant={save.settings.botCount === count ? "default" : "secondary"} aria-pressed={save.settings.botCount === count}
                onClick={() => commit({ ...saveRef.current, settings: { ...saveRef.current.settings, botCount: count } })}>{count}</Button>
            ))}</div>
          </fieldset>
          <Button className="cc-btn cc-btn-primary mb-2 h-auto w-full" onClick={() => { click(); startArena(); }}>Enter Arena</Button>
          <Button variant="ghost" onClick={() => setScreen("menu")}>Back</Button>
        </Overlay>
      )}
      {screen === "eliminated" && (
        <Overlay>
          <h2 className="cc-title mb-2 text-3xl">Absorbed</h2>
          <p className="mb-1 text-sm">{killer} claimed your black hole.</p>
          <p className="mb-6 text-sm text-muted-foreground">{formatMass(hud.mass)} mass · {fmtTime(hud.time)}</p>
          <Button className="cc-btn cc-btn-primary mb-2 h-auto w-full" onClick={startArena}>Play Again</Button>
          <Button variant="ghost" onClick={toMenu}>Main Menu</Button>
        </Overlay>
      )}
      {screen === "achievements" && (
        <Page title="Achievements" onBack={() => { click(); setScreen("menu"); }}>
          <p className="mb-4 text-center text-sm text-muted-foreground">{save.achievements.length} / {ACHIEVEMENTS.length} unlocked</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACHIEVEMENTS.map((a) => {
              const got = save.achievements.includes(a.id);
              return (
                <div key={a.id} className={`cc-panel flex items-center gap-4 p-4 ${got ? "" : "opacity-50"}`}>
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-2xl ${got ? "border-primary text-gold" : "border-border grayscale"}`}>{got ? a.icon : "🔒"}</div>
                  <div className="text-left">
                    <div className="font-display">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.desc}</div>
                    <div className="text-[11px] text-muted-foreground">{got ? "✓ Unlocked" : a.id === "first" ? "Locked" : `Requires ${formatMass(a.mass)} mass`}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Page>
      )}

      {screen === "stats" && (
        <Page title="Statistics" onBack={() => { click(); setScreen("menu"); }}>
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
            <Stat label="Current run mass" value={formatMass(save.runMass)} />
            <Stat label="Highest mass" value={formatMass(save.bestMass)} />
            <Stat label="Objects absorbed" value={formatMass(save.stats.absorbed)} />
            <Stat label="Planets absorbed" value={formatMass(save.stats.planets)} />
            <Stat label="Stars absorbed" value={formatMass(save.stats.stars)} />
            <Stat label="Galaxies absorbed" value={formatMass(save.stats.galaxies)} />
            <Stat label="Play time" value={fmtTime(save.stats.playTime)} />
            <Stat label="Achievements" value={`${save.achievements.length}/${ACHIEVEMENTS.length}`} />
          </div>
        </Page>
      )}

      {screen === "hangar" && <Hangar save={save} onBack={() => { click(); setScreen("menu"); }}
        onEquip={(id) => { if (skinOwned(saveRef.current, id)) { commit({ ...saveRef.current, skin: id }); click(); } }} />}
      {screen === "settings" && (
        <SettingsScreen save={save} onChange={(st) => commit({ ...saveRef.current, settings: st })}
          onBack={() => { click(); setScreen(settingsFrom === "pause" ? "play" : "menu"); }}
          onReset={() => setConfirm({ title: "Reset all progress?", body: "This deletes your best mass, achievements, stats and skins. This cannot be undone.", yes: "Reset everything", onYes: () => { const d = defaultSave(); d.settings = saveRef.current.settings; commit(d); toast("Progress reset"); } })} />
      )}

      {screen === "play" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
            <div className="cc-panel px-4 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Mass</div>
              <div className="font-display text-2xl text-primary sm:text-3xl">{formatMass(hud.mass)}</div>
              <div className="text-[11px] text-muted-foreground">{arenaMode ? `${arenaState.alive} in arena` : `Best ${formatMass(best)}`}</div>
              {arenaMode && <div className="mt-1.5" aria-label="Core strike cooldown">
                <div className="mb-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{hud.strikePhase === "ready" ? "Strike ready" : hud.strikePhase === "charge" ? "Charging…" : hud.strikePhase === "active" ? "Striking!" : "Recharging"}</div>
                <div className="cc-progress-track"><div className="cc-progress-fill" style={{ width: `${hud.strikeReady * 100}%` }} /></div>
              </div>}
            </div>
            {!arenaMode && <div className="cc-panel order-3 w-full px-3 py-2 sm:order-none sm:w-auto sm:min-w-[300px]">
              {next ? (<>
                <div className="mb-1 flex justify-between gap-4 text-xs"><span className="text-muted-foreground">Next: {next.achievement.icon} {next.achievement.name}</span><span>{formatMass(next.achievement.mass)}</span></div>
                <div className="cc-progress-track"><div className="cc-progress-fill" style={{ width: `${next.progress * 100}%` }} /></div>
              </>) : <div className="text-xs text-gold">All achievements unlocked — keep growing!</div>}
            </div>}
            <div className="pointer-events-auto flex items-center gap-2">
              <Button variant="secondary" className="cc-btn cc-icon-btn" aria-label={save.settings.audio ? "Mute sound" : "Unmute sound"} onClick={() => commit({ ...saveRef.current, settings: { ...saveRef.current.settings, audio: !saveRef.current.settings.audio } })}>{save.settings.audio ? "♪" : "✕"}</Button>
              <Button variant="secondary" className="cc-btn cc-icon-btn" aria-label="Pause" onClick={() => { click(); doPause(); }}>❚❚</Button>
            </div>
          </div>

          {arenaMode && <div className="cc-panel absolute right-3 top-24 z-20 w-44 px-3 py-2 sm:right-4 sm:w-56">
            <div className="mb-2 flex justify-between text-xs font-semibold"><span>Leaderboard</span><span className="text-primary">#{arenaState.rank}</span></div>
            <ol className="space-y-1 text-[10px] sm:text-xs">{arenaState.leaders.map((entry, i) => (
              <li key={entry.name} className={`flex items-center gap-1 ${entry.isPlayer ? "font-bold text-primary" : "text-muted-foreground"}`}>
                <span className="w-4 shrink-0">{i + 1}</span><span className="min-w-0 flex-1 truncate">{entry.name}</span><span>{formatMass(entry.mass)}</span>
              </li>
            ))}</ol>
            <div className="mt-2 border-t border-border pt-2 text-xs text-primary">{arenaState.rank === 1 ? "♛ Arena leader" : `You · rank ${arenaState.rank}`}</div>
          </div>}
          {arenaMode && <div className="pointer-events-none absolute bottom-4 right-3 z-20 max-w-[55%] text-right text-[10px] text-muted-foreground">{feed.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}</div>}
          {tut !== null && !paused && (
            <div className="absolute inset-x-0 bottom-36 z-20 flex justify-center px-4 sm:bottom-10">
              <div className="cc-panel cc-screen flex max-w-md items-center gap-3 px-4 py-3" key={tut}>
                <span className="font-display text-xs text-primary">{tut + 1}/5</span>
                <p className="text-sm">{tut === 0 && coarse ? "Move with the joystick." : TUTORIAL[tut]}</p>
                <Button variant="secondary" className="cc-btn cc-btn-ghost px-3 py-1 text-xs" onClick={endTut}>Skip</Button>
              </div>
            </div>
          )}

          {coarse && !paused && <Joystick onMove={moveJoystick} />}
          {coarse && !paused && (<>
            <button type="button" aria-label="Boost" className="cc-joy-base absolute bottom-10 right-8 z-20 flex h-24 w-24 items-center justify-center text-xs font-semibold text-foreground" style={{ touchAction: "none" }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engineRef.current?.setBoost(true); }}
              onPointerUp={() => engineRef.current?.setBoost(false)} onPointerCancel={() => engineRef.current?.setBoost(false)} onLostPointerCapture={() => engineRef.current?.setBoost(false)}>BOOST</button>
            <button type="button" aria-label="Strike" className="cc-joy-base absolute bottom-40 right-10 z-20 flex h-20 w-20 items-center justify-center text-xs font-semibold text-foreground" style={{ touchAction: "none" }}
              onPointerDown={(e) => { e.preventDefault(); engineRef.current?.strike(); }}><span style={{ opacity: hud.strikeReady >= 1 ? 1 : 0.45 }}>{hud.strikeReady >= 1 ? "STRIKE" : `${Math.round(hud.strikeReady * 100)}%`}</span></button>
          </>)}

          {paused && !confirm && (
            <Overlay>
              <h2 className="cc-title mb-1 text-3xl">Paused</h2>
              <p className="mb-6 text-sm text-muted-foreground">{formatMass(hud.mass)} mass · best {formatMass(best)}</p>
              <div className="flex w-full flex-col gap-2">
                <Button variant="secondary" className="cc-btn cc-btn-primary" onClick={() => { click(); doResume(); }} autoFocus>Resume</Button>
                <Button variant="secondary" className="cc-btn" onClick={() => { click(); setConfirm({ title: "Restart from 10 mass?", body: "Your current mass resets. Personal best, achievements and stats are kept.", yes: "Restart", onYes: () => arenaMode ? startArena() : startRun(PLAYER.startMass) }); }}>Restart</Button>
                <Button variant="secondary" className="cc-btn" onClick={() => { click(); setSettingsFrom("pause"); setScreen("settings"); }}>Settings</Button>
                <Button variant="secondary" className="cc-btn cc-btn-ghost" onClick={() => { click(); toMenu(); }}>{arenaMode ? "Main Menu" : "Save & Main Menu"}</Button>
              </div>
            </Overlay>
          )}
        </>
      )}

      {confirm && (
        <Overlay z="z-50">
          <h2 className="font-display mb-2 text-xl font-semibold">{confirm.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{confirm.body}</p>
          <div className="flex w-full gap-2">
            <Button variant="secondary" className="cc-btn flex-1" autoFocus onClick={() => { click(); setConfirm(null); }}>Cancel</Button>
            <Button variant="secondary" className="cc-btn cc-btn-danger flex-1" onClick={() => { click(); const f = confirm.onYes; setConfirm(null); f(); }}>{confirm.yes}</Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children, wide, z = "z-30" }: { children: ReactNode; wide?: boolean; z?: string }) {
  return (
    <div className={`absolute inset-0 ${z} flex items-center justify-center bg-background/60 p-4`}>
      <div className={`cc-panel cc-screen flex max-h-full w-full flex-col items-center overflow-y-auto p-6 text-center ${wide ? "max-w-lg" : "max-w-sm"}`}>{children}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className="font-display text-xl">{value}</div></div>;
}
function Page({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-background/70" style={{ touchAction: "pan-y" }}>
      <div className="cc-screen mx-auto max-w-5xl p-4 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Button variant="secondary" className="cc-btn" onClick={onBack}>← Back</Button>
          <h2 className="cc-title text-2xl sm:text-3xl">{title}</h2>
          <span className="w-16" />
        </div>
        {children}
      </div>
    </div>
  );
}

function SkinPreview({ skinId, size }: { skinId: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    const ctx = c.getContext("2d"); const skin = SKINS.find((s) => s.id === skinId); if (!ctx || !skin) return;
    let raf = 0; const t0 = performance.now();
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
      drawBlackHole(ctx, size / 2, size / 2, size * 0.14, (now - t0) / 1000, skin, false);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [skinId, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-label="Skin preview" />;
}

function Hangar({ save, onBack, onEquip }: { save: SaveData; onBack: () => void; onEquip: (id: string) => void }) {
  const [sel, setSel] = useState(save.skin);
  const skin = SKINS.find((s) => s.id === sel) ?? SKINS[0];
  const owned = skinOwned(save, sel); const equipped = save.skin === sel;
  const ach = ACHIEVEMENTS.find((a) => a.id === skin.achievement);
  return (
    <Page title="Skins" onBack={onBack}>
      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <div className="cc-panel flex flex-col items-center p-4">
          <SkinPreview skinId={sel} size={280} />
          <h3 className="font-display text-xl">{skin.name}</h3>
          <p className="mb-3 text-xs text-muted-foreground">{equipped ? "Equipped" : owned ? "Unlocked" : `Unlock with achievement: ${ach?.name}`}</p>
          <Button variant="secondary" className="cc-btn cc-btn-primary w-full" disabled={!owned || equipped} onClick={() => onEquip(sel)}>{equipped ? "Equipped" : owned ? "Equip" : "Locked"}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SKINS.map((s) => {
            const o = skinOwned(save, s.id);
            return (
              <Button variant="secondary" key={s.id} onClick={() => setSel(s.id)} className={`cc-panel cc-btn h-auto flex-col items-start gap-2 p-3 text-left ${sel === s.id ? "border-primary" : ""}`}>
                <div className="h-6 w-full rounded-md" style={{ background: `linear-gradient(90deg, ${s.hot}, ${s.mid}, ${s.outer})` }} />
                <span className="text-sm">{s.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{save.skin === s.id ? "★ Equipped" : o ? "✓ Owned" : "🔒 Achievement"}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </Page>
  );
}

function SettingsScreen({ save, onChange, onBack, onReset }: { save: SaveData; onChange: (s: SaveData["settings"]) => void; onBack: () => void; onReset: () => void }) {
  const s = save.settings;
  const Toggle = ({ label, k, hint }: { label: string; k: "audio" | "shake" | "reduced"; hint?: string }) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span><span className="block text-sm font-semibold">{label}</span>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={s[k]} onChange={(e) => onChange({ ...s, [k]: e.target.checked })} />
    </label>
  );
  const Slider = ({ label, k }: { label: string; k: "sfx" | "music" }) => (
    <label className="block py-3">
      <span className="mb-1 flex justify-between text-sm font-semibold"><span>{label}</span><span className="text-muted-foreground">{Math.round(s[k] * 100)}%</span></span>
      <input type="range" min={0} max={1} step={0.05} value={s[k]} className="cc-range" disabled={!s.audio} onChange={(e) => onChange({ ...s, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <Page title="Settings" onBack={onBack}>
      <div className="cc-panel mx-auto max-w-lg divide-y divide-border px-5">
        <Toggle label="Sound" k="audio" />
        <Slider label="Sound effects" k="sfx" />
        <Slider label="Ambient music" k="music" />
        <Toggle label="Screen shake" k="shake" />
        <Toggle label="Reduced effects" k="reduced" hint="Fewer particles and softer flashes" />
        <div className="py-4">
          <Button variant="secondary" className="cc-btn cc-btn-danger w-full" onClick={onReset}>Reset saved progress</Button>
          {!storageAvailable && <p className="mt-2 text-xs text-destructive">Your browser is blocking local storage, so progress will only last for this session.</p>}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">Progress is saved in this browser only. No account needed.</p>
      <div className="mx-auto mt-4 max-w-lg text-xs text-muted-foreground">
        <div className="mb-1 font-semibold text-foreground">Absorption guide</div>
        {Array.from({ length: CATALOG_SIZE + 3 }, (_, i) => kindAt(i)).map((o) => <div key={o.idx} className="flex justify-between"><span>{o.name}</span><span>needs {formatMass(o.minMass)} mass</span></div>)}
      </div>
    </Page>
  );
}

function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const center = useRef({ x: 0, y: 0 }); const active = useRef<number | null>(null);
  const R = 50;
  const update = (e: React.PointerEvent) => {
    let dx = e.clientX - center.current.x, dy = e.clientY - center.current.y;
    const d = Math.hypot(dx, dy); if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    setKnob({ x: dx, y: dy }); onMove(dx / R, dy / R);
  };
  const end = () => { active.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  useEffect(() => () => onMove(0, 0), [onMove]);
  return (
    <div className="cc-joy-base absolute bottom-8 left-8 z-20 flex h-32 w-32 items-center justify-center" style={{ touchAction: "none" }}
      onPointerDown={(e) => { if (active.current !== null) return; const r = e.currentTarget.getBoundingClientRect(); center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) update(e); }}
      onPointerUp={(e) => { if (active.current === e.pointerId) end(); }} onPointerCancel={(e) => { if (active.current === e.pointerId) end(); }} onLostPointerCapture={(e) => { if (active.current === e.pointerId) end(); }}>
      <div className="cc-joy-knob h-14 w-14" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
