import React, { useEffect, useRef, useState } from 'react';
import { BasketballGame, ShotMeterEvent, FoulEventUI, ViolationEventUI, InjuryEventUI } from './game';
import { sounds } from './audio';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
}

function VirtualJoystick({ onMove }: JoystickProps) {
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const baseRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);

  const handlePointer = (clientX: number, clientY: number) => {
    if (!baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 38;
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;

    setThumbPos({ x: clampedX, y: clampedY });
    onMove(clampedX / maxRadius, clampedY / maxRadius);
  };

  const reset = () => {
    setIsActive(false);
    touchIdRef.current = null;
    setThumbPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    if (touchIdRef.current === null && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      touchIdRef.current = touch.identifier;
      setIsActive(true);
      handlePointer(touch.clientX, touch.clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (touchIdRef.current !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          handlePointer(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
          break;
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchIdRef.current !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
          reset();
          break;
        }
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsActive(true);
    handlePointer(e.clientX, e.clientY);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      handlePointer(moveEvent.clientX, moveEvent.clientY);
    };

    const handleMouseUp = () => {
      reset();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      ref={baseRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={reset}
      onMouseDown={handleMouseDown}
      style={{ touchAction: 'none' }}
      className={`relative w-28 h-28 rounded-full flex items-center justify-center bg-slate-950/75 backdrop-blur-xl border transition-all duration-200 select-none cursor-pointer ${
        isActive
          ? 'border-amber-400/90 shadow-[0_0_24px_rgba(251,191,36,0.4)]'
          : 'border-white/20 shadow-2xl hover:border-white/30'
      }`}
    >
      {/* Outer subtle direction crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-25">
        <div className="w-16 h-px bg-white" />
        <div className="h-16 w-px bg-white absolute" />
      </div>

      <div
        style={{
          transform: `translate(${thumbPos.x}px, ${thumbPos.y}px)`,
        }}
        className={`w-12 h-12 rounded-full bg-gradient-to-b from-slate-700/90 to-slate-900/95 border border-amber-400/80 shadow-lg pointer-events-none flex items-center justify-center transition-transform duration-75 ${
          isActive ? 'scale-105 shadow-[0_0_14px_rgba(251,191,36,0.6)]' : ''
        }`}
      >
        <div className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center shadow-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<BasketballGame | null>(null);

  // Scoreboard
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [shotClock, setShotClock] = useState(24);
  const [hasBall, setHasBall] = useState(true);
  const [stamina, setStamina] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);

  // Shot Meter & Feedback
  const [meterState, setMeterState] = useState<ShotMeterEvent | null>(null);
  const meterTimeoutRef = useRef<number | null>(null);
  const [shotFeedback, setShotFeedback] = useState<{ text: string; isGreen: boolean } | null>(null);

  // Camera View Mode
  const [cameraMode, setCameraMode] = useState<'SIDE' | 'COURTSIDE' | 'BEHIND'>('SIDE');

  // Foul & Free Throw System Overlay State
  const [foulEvent, setFoulEvent] = useState<FoulEventUI | null>(null);

  // Injury & Tactical Substitution Overlay State
  const [injuryEvent, setInjuryEvent] = useState<InjuryEventUI | null>(null);

  // Official NBA Team Fouls & Bonus / Penalty State
  const [gswFouls, setGswFouls] = useState(0);
  const [houFouls, setHouFouls] = useState(0);
  const [gswBonus, setGswBonus] = useState(false);
  const [houBonus, setHouBonus] = useState(false);

  // Official Rule Violation Overlay State
  const [violationEvent, setViolationEvent] = useState<ViolationEventUI | null>(null);
  const violationTimeoutRef = useRef<number | null>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);

  // Tip-Off Menu Overlay State
  const [tipOffStarted, setTipOffStarted] = useState(false);
  const [tipOffFading, setTipOffFading] = useState(false);
  const [tipOffMounted, setTipOffMounted] = useState(true);

  // Controls Modal / Helper
  const [showControlsGuide, setShowControlsGuide] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const game = new BasketballGame(containerRef.current);
    gameRef.current = game;

    game.onScoreUpdate = (home, away) => {
      setHomeScore(home);
      setAwayScore(away);
    };

    game.onPossessionChange = (possession) => {
      setHasBall(possession);
    };

    game.onStaminaUpdate = (val) => {
      setStamina(val);
    };

    game.onInjuryEvent = (event) => {
      setInjuryEvent(event);
    };

    game.onShotMeterUpdate = (event) => {
      if (event.isFrozen) {
        setMeterState(event);
        if (meterTimeoutRef.current) clearTimeout(meterTimeoutRef.current);
        meterTimeoutRef.current = window.setTimeout(() => {
          setMeterState(null);
        }, 550);
      } else if (event.isCharging) {
        if (meterTimeoutRef.current) clearTimeout(meterTimeoutRef.current);
        setMeterState(event);
      } else {
        setMeterState(null);
      }
    };

    game.onShotReleased = (quality, isGreen) => {
      setShotFeedback({ text: quality, isGreen });
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = window.setTimeout(() => {
        setShotFeedback(null);
      }, 1500);
    };

    game.onShotClockUpdate = (sec) => {
      setShotClock(sec);
    };

    game.onFoulEvent = (event) => {
      setFoulEvent(event);
    };

    game.onTeamFoulsUpdate = (gsw, hou, gBonus, hBonus) => {
      setGswFouls(gsw);
      setHouFouls(hou);
      setGswBonus(gBonus);
      setHouBonus(hBonus);
    };

    game.onRuleViolation = (violation) => {
      setViolationEvent(violation);
      if (violationTimeoutRef.current) clearTimeout(violationTimeoutRef.current);
      violationTimeoutRef.current = window.setTimeout(() => {
        setViolationEvent(null);
      }, 2600);
    };

    return () => {
      if (meterTimeoutRef.current) clearTimeout(meterTimeoutRef.current);
      if (violationTimeoutRef.current) clearTimeout(violationTimeoutRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      game.destroy();
    };
  }, []);

  const handleStartTipOff = () => {
    setTipOffStarted(true);
    setTipOffFading(true);

    setTimeout(() => {
      setTipOffMounted(false);
      setTipOffFading(false);
    }, 500);
  };

  const handleJoystickMove = (x: number, y: number) => {
    gameRef.current?.setJoystickInput(x, y);
  };

  return (
    <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden bg-[#0a0e17] select-none font-sans text-slate-100 touch-none">
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ========================================================================= */}
      {/* 1. TOP BROADCAST SCOREBUG (SLEEK, CLEAN & INTENTIONAL) */}
      {/* ========================================================================= */}
      <header className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div className="flex items-stretch bg-slate-950/85 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_12px_36px_rgba(0,0,0,0.65)] overflow-hidden pointer-events-auto">
          {/* GSW Team Pod */}
          <div className="flex items-center px-4 py-2 bg-gradient-to-r from-[#0053bc]/30 to-transparent border-r border-white/5 gap-3">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#fdb927]" />
                <span className="font-black text-sm tracking-wider text-[#fdb927]">GSW</span>
                {hasBall && (
                  <span className="text-[10px] text-amber-400 font-bold leading-none animate-pulse">◀</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold tracking-wider">
                <span>F:{gswFouls}</span>
                {gswBonus && (
                  <span className="text-[9px] font-black px-1 rounded bg-amber-400 text-slate-950 leading-tight">
                    BONUS
                  </span>
                )}
              </div>
            </div>
            <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white min-w-[28px] text-right">
              {homeScore}
            </span>
          </div>

          {/* Center Clock & Shot Clock Column */}
          <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-slate-900/60 min-w-[76px]">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">SHOT</span>
            <span
              className={`text-xl font-mono font-black leading-none ${
                shotClock <= 5
                  ? 'text-red-400 animate-pulse drop-shadow-[0_0_8px_rgba(248,113,113,0.8)]'
                  : 'text-emerald-400'
              }`}
            >
              {shotClock}
            </span>
            {/* Player Stamina Bar with Fatigue Warning */}
            <div className="flex flex-col items-center mt-1">
              <div className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/10">
                <div
                  className={`h-full transition-all duration-100 ${
                    stamina > 0.4
                      ? 'bg-amber-400'
                      : stamina > 0.15
                      ? 'bg-orange-500'
                      : 'bg-red-500 animate-pulse'
                  }`}
                  style={{ width: `${Math.max(0, stamina * 100)}%` }}
                />
              </div>
              {stamina < 0.20 && (
                <span className="text-[7px] font-black uppercase tracking-wider text-red-400 animate-pulse leading-none mt-0.5">
                  Fatigue
                </span>
              )}
            </div>
          </div>

          {/* HOU Team Pod */}
          <div className="flex items-center px-4 py-2 bg-gradient-to-l from-[#ce1141]/30 to-transparent border-l border-white/5 gap-3">
            <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white min-w-[28px] text-left">
              {awayScore}
            </span>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1.5">
                {!hasBall && (
                  <span className="text-[10px] text-red-400 font-bold leading-none animate-pulse">▶</span>
                )}
                <span className="font-black text-sm tracking-wider text-red-500">HOU</span>
                <span className="w-2 h-2 rounded-full bg-[#ce1141]" />
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold tracking-wider">
                {houBonus && (
                  <span className="text-[9px] font-black px-1 rounded bg-amber-400 text-slate-950 leading-tight">
                    BONUS
                  </span>
                )}
                <span>F:{houFouls}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. TOP-RIGHT UTILITY DOCK (CAMERA, AUDIO, CONTROLS GUIDE) */}
      {/* ========================================================================= */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5">
        {/* Tactical Bench Substitution Button */}
        <button
          type="button"
          onClick={() => gameRef.current?.triggerManualTacticalSubstitution()}
          className="px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200 backdrop-blur-xl shadow-lg hover:border-white/20 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
          title="Call Tactical Bench Substitution (B)"
        >
          <span className="text-xs">🔄</span>
          <span className="text-[11px] font-bold tracking-wide uppercase">Sub</span>
        </button>

        {/* Camera Toggle */}
        <button
          type="button"
          onClick={() => {
            const nextMode = gameRef.current?.toggleCameraMode();
            if (nextMode) setCameraMode(nextMode);
          }}
          className="px-3 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-white/10 text-xs font-semibold text-slate-200 backdrop-blur-xl shadow-lg hover:border-white/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          title="Switch Camera Perspective"
        >
          <span className="text-xs">🎥</span>
          <span className="text-[11px] font-bold tracking-wide uppercase">
            {cameraMode === 'SIDE' ? 'Broadcast' : cameraMode === 'COURTSIDE' ? 'Courtside' : '2K Drive'}
          </span>
        </button>

        {/* Audio Mute */}
        <button
          type="button"
          onClick={() => setIsMuted(sounds.toggleMute())}
          className="p-1.5 w-8 h-8 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-white/10 text-xs text-slate-200 backdrop-blur-xl shadow-lg hover:border-white/20 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>

        {/* Controls Guide Modal Toggle */}
        <button
          type="button"
          onClick={() => setShowControlsGuide(!showControlsGuide)}
          className="p-1.5 w-8 h-8 rounded-xl bg-slate-950/80 hover:bg-slate-900 border border-white/10 text-xs font-bold text-slate-300 backdrop-blur-xl shadow-lg hover:border-white/20 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
          title="View Controls & Tips"
        >
          ?
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. CLEAN SHOT TIMING FEEDBACK TOAST */}
      {/* ========================================================================= */}
      {shotFeedback && (
        <div className="absolute top-22 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-all duration-200 animate-in fade-in zoom-in-95">
          <div
            className={`px-5 py-1.5 rounded-full text-xs sm:text-sm font-black tracking-wider uppercase shadow-2xl backdrop-blur-md border ${
              shotFeedback.isGreen
                ? 'bg-emerald-500/90 text-white border-emerald-300/80 shadow-[0_0_24px_rgba(52,211,153,0.7)]'
                : 'bg-amber-400/95 text-slate-950 border-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.5)]'
            }`}
          >
            {shotFeedback.text}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. SIGNATURE 2K SHOT METER (HIGH PRECISION, SLEEK LINEAR HUD) */}
      {/* ========================================================================= */}
      {meterState && !foulEvent && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-64 sm:w-72 flex flex-col items-center z-30 pointer-events-none select-none">
          {/* Release Timing Callout */}
          {meterState.isFrozen && meterState.quality && (
            <div
              className={`mb-1.5 px-3 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg ${
                meterState.isGreen
                  ? 'bg-emerald-500 text-white border border-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                  : 'bg-amber-400 text-slate-950 border border-amber-200'
              }`}
            >
              {meterState.quality}
            </div>
          )}

          {/* Meter Housing Track */}
          <div
            className={`relative w-full h-4 rounded-full bg-slate-950/90 border p-0.5 backdrop-blur-md overflow-hidden transition-colors ${
              meterState.isGreen ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-white/20'
            }`}
          >
            {/* Target Green Window */}
            <div className="absolute top-0 bottom-0 right-[4%] w-[12%] bg-emerald-500/80 border-x border-emerald-300/90 flex items-center justify-center shadow-[0_0_10px_rgba(52,211,153,0.7)]">
              <div className="w-0.5 h-full bg-white shadow-sm" />
            </div>

            {/* Instant Real-Time Responsive Fill */}
            <div
              className={`h-full rounded-full ${
                meterState.isGreen
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300'
                  : 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300'
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, meterState.value * 100))}%`,
              }}
            />

            {/* Needle Line Marker */}
            <div
              className="absolute top-0 bottom-0 w-1 -ml-0.5 bg-white rounded-full shadow-[0_0_6px_#ffffff]"
              style={{
                left: `${Math.min(100, Math.max(0, meterState.value * 100))}%`,
              }}
            />
          </div>

          {!meterState.isFrozen && (
            <span
              className={`text-[9px] font-extrabold uppercase tracking-widest mt-1 ${
                meterState.isGreen ? 'text-emerald-400 animate-pulse' : 'text-slate-400'
              }`}
            >
              {meterState.isGreen ? 'PERFECT RELEASE' : 'HOLD & RELEASE IN GREEN'}
            </span>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. UNIFIED FREE THROW BROADCAST CONTROL CENTER (CLEAN SINGLE CARD) */}
      {/* ========================================================================= */}
      {foulEvent && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 select-none max-w-lg w-[88vw] sm:w-[480px] pointer-events-auto"
          style={{
            bottom: 'max(1.75rem, env(safe-area-inset-bottom, 1.75rem))',
          }}
        >
          <div className="bg-slate-950/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] p-3 sm:p-4 flex flex-col gap-2.5">
            {/* Header: Foul Context & Attempts */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-black tracking-wider uppercase text-[10px] bg-amber-500/15 px-2 py-0.5 rounded border border-amber-400/20">
                  {foulEvent.foulType}
                </span>
                <span className="font-bold text-white">
                  {foulEvent.fouledName}
                </span>
              </div>

              {/* Attempt Pips */}
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
                <span
                  className={`px-2 py-0.5 rounded border ${
                    foulEvent.shot1Result === 'MADE'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                      : foulEvent.shot1Result === 'MISSED'
                      ? 'bg-red-500/20 text-red-300 border-red-400/30'
                      : 'bg-slate-900 text-slate-400 border-white/5'
                  }`}
                >
                  1: {foulEvent.shot1Result === 'MADE' ? '✓' : foulEvent.shot1Result === 'MISSED' ? '✗' : '—'}
                </span>

                {foulEvent.attemptsTotal >= 2 && (
                  <span
                    className={`px-2 py-0.5 rounded border ${
                      foulEvent.shot2Result === 'MADE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                        : foulEvent.shot2Result === 'MISSED'
                        ? 'bg-red-500/20 text-red-300 border-red-400/30'
                        : 'bg-slate-900 text-slate-400 border-white/5'
                    }`}
                  >
                    2: {foulEvent.shot2Result === 'MADE' ? '✓' : foulEvent.shot2Result === 'MISSED' ? '✗' : '—'}
                  </span>
                )}

                {foulEvent.attemptsTotal >= 3 && (
                  <span
                    className={`px-2 py-0.5 rounded border ${
                      foulEvent.shot3Result === 'MADE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                        : foulEvent.shot3Result === 'MISSED'
                        ? 'bg-red-500/20 text-red-300 border-red-400/30'
                        : 'bg-slate-900 text-slate-400 border-white/5'
                    }`}
                  >
                    3: {foulEvent.shot3Result === 'MADE' ? '✓' : foulEvent.shot3Result === 'MISSED' ? '✗' : '—'}
                  </span>
                )}
              </div>
            </div>

            {/* Shooter Live Feedback or Meter (If User is Shooting) */}
            {foulEvent.isUserShooting ? (
              <div className="flex flex-col gap-2.5">
                {/* Meter Housing */}
                <div className="relative w-full h-5 rounded-full bg-slate-900 border border-white/10 p-0.5 overflow-hidden">
                  <div
                    className={`absolute top-0 bottom-0 bg-emerald-500/80 border-x border-emerald-300 flex items-center justify-center transition-all ${
                      foulEvent.hasFocused ? 'left-[76%] w-[20%]' : 'left-[82%] w-[12%]'
                    }`}
                  >
                    <div className="w-0.5 h-full bg-white shadow-sm" />
                  </div>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, (foulEvent.ftMeterValue ?? 0) * 100))}%`,
                    }}
                  />
                </div>

                {/* Primary Touch / Click Shoot Button */}
                <button
                  type="button"
                  onMouseDown={() => gameRef.current?.startFreeThrowShot()}
                  onMouseUp={() => gameRef.current?.releaseFreeThrowShot()}
                  onMouseLeave={() => gameRef.current?.releaseFreeThrowShot()}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.startFreeThrowShot();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseFreeThrowShot();
                  }}
                  onTouchCancel={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseFreeThrowShot();
                  }}
                  className={`w-full py-3 px-4 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer select-none touch-manipulation shadow-lg ${
                    foulEvent.isCharging
                      ? 'bg-emerald-400 text-slate-950 ring-4 ring-emerald-300/60 shadow-[0_0_24px_rgba(52,211,153,0.8)] animate-pulse'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-110 text-slate-950 border border-amber-200'
                  }`}
                >
                  <span className="text-base sm:text-lg">🏀</span>
                  <span>{foulEvent.isCharging ? 'RELEASE IN GREEN!' : 'TOUCH & HOLD TO SHOOT'}</span>
                </button>

                {/* Free Throw Routine Actions Row (Touch-Friendly) */}
                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => gameRef.current?.triggerFreeThrowDribble()}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      gameRef.current?.triggerFreeThrowDribble();
                    }}
                    className="flex-1 py-2 px-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-white/15 text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1 touch-manipulation"
                  >
                    <span>🏀</span>
                    <span>Dribble</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => gameRef.current?.triggerFreeThrowSpin()}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      gameRef.current?.triggerFreeThrowSpin();
                    }}
                    className="flex-1 py-2 px-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-white/15 text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1 touch-manipulation"
                  >
                    <span>🌀</span>
                    <span>Spin</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => gameRef.current?.triggerFreeThrowFocus()}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      gameRef.current?.triggerFreeThrowFocus();
                    }}
                    className={`flex-1 py-2 px-2 rounded-xl border text-xs font-bold active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1 touch-manipulation ${
                      foulEvent.hasFocused
                        ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 ring-1 ring-emerald-400/50'
                        : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-white/15'
                    }`}
                  >
                    <span>🎯</span>
                    <span>Focus</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>AI Free Throw in progress...</span>
                <span className="font-bold text-amber-400 uppercase tracking-wider">{foulEvent.statusText}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. REFEREE RULE VIOLATION BANNER (SLIM BROADCAST LOWER THIRD) */}
      {/* ========================================================================= */}
      {violationEvent && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 select-none pointer-events-none max-w-lg w-[90vw]">
          <div className="bg-slate-950/90 backdrop-blur-xl border-l-4 border-l-red-500 border-y border-r border-white/10 rounded-xl px-4 py-2.5 shadow-2xl flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-red-400 tracking-wider uppercase">
                {violationEvent.violation}
              </span>
              <span className="text-xs text-slate-300 font-medium">
                {violationEvent.description}
              </span>
            </div>
            <span className="text-[10px] font-black text-amber-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded whitespace-nowrap">
              TO {violationEvent.awardedTeam}
            </span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6B. NBA INJURY & TACTICAL SUBSTITUTION BROADCAST OVERLAY */}
      {/* ========================================================================= */}
      {injuryEvent && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 select-none">
          <div className="bg-slate-950/95 border-2 border-red-500/50 rounded-3xl shadow-[0_0_60px_rgba(239,68,68,0.35)] p-5 sm:p-7 max-w-xl w-full flex flex-col gap-5 text-white">
            {/* Header: Alert Bar */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl animate-pulse">🚨</span>
                <div className="flex flex-col">
                  <span className="text-xs sm:text-sm font-black text-red-400 uppercase tracking-widest">
                    NBA Injury Timeout
                  </span>
                  <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    Tactical Bench Substitution In Progress
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider border ${
                injuryEvent.injuredPlayer.team === 'GSW'
                  ? 'bg-blue-600/20 text-blue-300 border-blue-400/30'
                  : 'bg-red-600/20 text-red-300 border-red-400/30'
              }`}>
                {injuryEvent.injuredPlayer.team === 'GSW' ? 'GOLDEN STATE' : 'HOUSTON'}
              </span>
            </div>

            {/* Substitution Matchup Cards: Injured Out vs Substitute In */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-stretch">
              {/* Injured / Outgoing Card */}
              <div className="bg-red-950/30 border border-red-500/30 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-red-400 bg-red-500/15 px-2 py-0.5 rounded border border-red-500/20">
                    OUTGOING
                  </span>
                  <span className="font-mono text-xs text-red-400 font-bold">
                    #{injuryEvent.injuredPlayer.number}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-white leading-tight">
                    {injuryEvent.injuredPlayer.name}
                  </h3>
                  <span className="text-xs text-slate-400 font-semibold">
                    Position: {injuryEvent.injuredPlayer.position}
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-red-500/20">
                  <span className="text-[10px] font-extrabold text-red-300 uppercase tracking-wide block">
                    {injuryEvent.injuryType}
                  </span>
                  <span className="text-[11px] text-slate-300 leading-snug line-clamp-2 mt-0.5">
                    {injuryEvent.injuryDescription}
                  </span>
                </div>
              </div>

              {/* Incoming Substitute Card */}
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-[0_0_25px_rgba(16,185,129,0.15)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/20">
                    INCOMING SUB
                  </span>
                  <span className="font-mono text-xs text-emerald-400 font-bold">
                    #{injuryEvent.substitutePlayer.number}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-white leading-tight">
                    {injuryEvent.substitutePlayer.name}
                  </h3>
                  <span className="text-xs text-emerald-300 font-semibold">
                    Position: {injuryEvent.substitutePlayer.position} • Fresh Legs (100% Stamina)
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-emerald-500/20 flex items-center justify-between text-xs">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-400 uppercase font-bold">3-Point</span>
                    <span className="font-mono font-bold text-amber-300">{injuryEvent.substitutePlayer.threePointRating}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-400 uppercase font-bold">Mid-Range</span>
                    <span className="font-mono font-bold text-amber-300">{injuryEvent.substitutePlayer.midRangeRating}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-400 uppercase font-bold">Speed</span>
                    <span className="font-mono font-bold text-emerald-400">{Math.round(injuryEvent.substitutePlayer.speed * 18)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sequence Stage Timeline */}
            <div className="bg-slate-900/80 rounded-xl p-3 border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                <span className={injuryEvent.stage === 'COLLAPSE' ? 'text-red-400' : 'text-slate-500'}>
                  1. Medical Timeout
                </span>
                <span>→</span>
                <span className={injuryEvent.stage === 'SUB_ENTRY' ? 'text-amber-400' : 'text-slate-500'}>
                  2. Sub Jogs In
                </span>
                <span>→</span>
                <span className={injuryEvent.stage === 'TAG_OUT' ? 'text-blue-400' : 'text-slate-500'}>
                  3. Sideline Tag
                </span>
                <span>→</span>
                <span className={injuryEvent.stage === 'RESUME' ? 'text-emerald-400' : 'text-slate-500'}>
                  4. Inbound Play
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-300"
                  style={{
                    width:
                      injuryEvent.stage === 'COLLAPSE'
                        ? '25%'
                        : injuryEvent.stage === 'SUB_ENTRY'
                        ? '60%'
                        : injuryEvent.stage === 'TAG_OUT'
                        ? '85%'
                        : '100%',
                  }}
                />
              </div>
            </div>

            {/* Skip / Fast Forward Button */}
            <button
              type="button"
              onClick={() => gameRef.current?.skipInjurySequence()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-slate-800 to-slate-700 hover:from-slate-700 hover:to-slate-600 border border-white/10 active:scale-98 transition-all font-bold text-xs uppercase tracking-wider text-slate-200 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>⏩</span>
              <span>Fast-Forward Substitution & Resume Play</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. DESKTOP KEYBOARD HINTS BAR (SUBTLE AT BOTTOM CENTER WHEN NO OVERLAY) */}
      {/* ========================================================================= */}
      {!foulEvent && !violationEvent && !injuryEvent && (
        <div className="hidden lg:flex absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none items-center gap-3 text-[11px] text-slate-400 bg-slate-950/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/5">
          <span><strong className="text-white font-semibold">WASD</strong> Move</span>
          <span>·</span>
          <span><strong className="text-white font-semibold">Shift</strong> Turbo</span>
          <span>·</span>
          <span><strong className="text-amber-300 font-semibold">Space</strong> {hasBall ? 'Shoot / Dunk' : 'Contest / Block'}</span>
          <span>·</span>
          <span><strong className="text-white font-semibold">E / X</strong> {hasBall ? 'Pass' : 'Steal'}</span>
          <span>·</span>
          <span><strong className="text-white font-semibold">C / Q</strong> Switch</span>
          <span>·</span>
          <span><strong className="text-white font-semibold">B</strong> Sub</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. MOBILE ON-SCREEN CONTROLS (NBA 2K SIGNATURE MOBILE ACTION PAD) */}
      {/* ========================================================================= */}
      {/* Virtual Joystick (Left Hand - Hidden during Free Throws since player is stationary at line) */}
      {!foulEvent && (
        <div
          className="absolute z-30 select-none touch-none"
          style={{
            left: 'max(1rem, env(safe-area-inset-left, 1rem))',
            bottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))',
          }}
        >
          <VirtualJoystick onMove={handleJoystickMove} />
        </div>
      )}

      {/* Action Buttons Cluster (Right Hand - Ergonomic 2x2 Thumb Arc, ALWAYS VISIBLE & CONTEXT-AWARE) */}
      <div
        className="absolute z-30 select-none flex flex-col items-end gap-2 touch-manipulation"
        style={{
          right: 'max(1rem, env(safe-area-inset-right, 1rem))',
          bottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))',
        }}
      >
        {foulEvent ? (
          /* FREE THROW MODE THUMB CONTROLS */
          foulEvent.isUserShooting ? (
            <>
              {/* Top Row: Routine Utility Actions */}
              <div className="flex items-center gap-2.5">
                {/* Spin Ball Routine */}
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerFreeThrowSpin();
                  }}
                  onClick={() => gameRef.current?.triggerFreeThrowSpin()}
                  className="w-12 h-12 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-white/20 active:scale-90 transition-transform backdrop-blur-xl shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                  title="Spin Ball Routine"
                >
                  <span className="text-sm">🌀</span>
                  <span className="text-[7px] font-black uppercase tracking-wider text-slate-300 -mt-0.5">Spin</span>
                </button>

                {/* Dribble Routine */}
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerFreeThrowDribble();
                  }}
                  onClick={() => gameRef.current?.triggerFreeThrowDribble()}
                  className="w-12 h-12 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-amber-400/70 active:scale-90 transition-transform backdrop-blur-xl shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                  title="Rhythm Dribble Routine"
                >
                  <span className="text-sm">🏀</span>
                  <span className="text-[7px] font-black uppercase tracking-wider text-amber-400 -mt-0.5">Dribble</span>
                </button>
              </div>

              {/* Bottom Row: Focus and Big Shoot Button */}
              <div className="flex items-end gap-3">
                {/* Focus Button (Widens green release window) */}
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerFreeThrowFocus();
                  }}
                  onClick={() => gameRef.current?.triggerFreeThrowFocus()}
                  className={`w-14 h-14 rounded-full border active:scale-90 transition-transform backdrop-blur-xl shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation ${
                    foulEvent.hasFocused
                      ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300 ring-2 ring-emerald-400/60 shadow-[0_0_16px_rgba(52,211,153,0.5)]'
                      : 'bg-gradient-to-tr from-slate-900/90 to-slate-800/95 border-white/20'
                  }`}
                  title="Focus (Widens Green Window)"
                >
                  <span className="text-base">🎯</span>
                  <span className="text-[8px] font-black uppercase tracking-wider -mt-0.5">Focus</span>
                </button>

                {/* Primary Free Throw Shoot Button (Under Right Thumb) */}
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.startFreeThrowShot();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseFreeThrowShot();
                  }}
                  onTouchCancel={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseFreeThrowShot();
                  }}
                  onMouseDown={() => gameRef.current?.startFreeThrowShot()}
                  onMouseUp={() => gameRef.current?.releaseFreeThrowShot()}
                  onMouseLeave={() => gameRef.current?.releaseFreeThrowShot()}
                  className={`w-[76px] h-[76px] rounded-full active:scale-90 transition-all shadow-[0_0_28px_rgba(245,158,11,0.65)] flex flex-col items-center justify-center font-black cursor-pointer touch-manipulation border-2 ${
                    foulEvent.isCharging
                      ? 'bg-emerald-400 text-slate-950 border-white ring-4 ring-emerald-300/80 shadow-[0_0_32px_rgba(52,211,153,0.9)] animate-pulse'
                      : 'bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-300 text-slate-950 border-amber-100 hover:brightness-110'
                  }`}
                  title="Hold & Release Free Throw"
                >
                  <span className="text-2xl">{foulEvent.isCharging ? '🟢' : '🏀'}</span>
                  <span className="text-[10px] font-black uppercase tracking-wider -mt-0.5">
                    {foulEvent.isCharging ? 'RELEASE!' : 'SHOOT'}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <div className="bg-slate-950/80 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
              AI SHOOTING...
            </div>
          )
        ) : (
          /* REGULAR 5v5 GAMEPLAY THUMB CONTROLS */
          <>
            {/* Top Row: Quick Utility Buttons (Switch Player & Turbo Sprint) */}
            <div className="flex items-center gap-2.5">
              {/* Switch Player Button */}
              <button
                type="button"
                onTouchStart={(e) => {
                  e.preventDefault();
                  gameRef.current?.cycleControlledPlayer();
                }}
                onClick={() => gameRef.current?.cycleControlledPlayer()}
                className="w-12 h-12 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-white/20 active:scale-90 transition-transform backdrop-blur-xl shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                title="Switch Player (C or Q)"
              >
                <span className="text-sm">👥</span>
                <span className="text-[7px] font-black uppercase tracking-wider text-slate-300 -mt-0.5">Switch</span>
              </button>

              {/* Sprint / Turbo Button */}
              <button
                type="button"
                onTouchStart={(e) => {
                  e.preventDefault();
                  gameRef.current?.setSprint(true);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  gameRef.current?.setSprint(false);
                }}
                onTouchCancel={(e) => {
                  e.preventDefault();
                  gameRef.current?.setSprint(false);
                }}
                onMouseDown={() => gameRef.current?.setSprint(true)}
                onMouseUp={() => gameRef.current?.setSprint(false)}
                onMouseLeave={() => gameRef.current?.setSprint(false)}
                className="w-12 h-12 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-amber-400/70 active:scale-90 transition-transform backdrop-blur-xl shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                title="Sprint Turbo (Shift)"
              >
                <span className="text-sm">⚡</span>
                <span className="text-[7px] font-black uppercase tracking-wider text-amber-400 -mt-0.5">Turbo</span>
              </button>
            </div>

            {/* Bottom Row: Primary Gameplay Buttons (Pass/Steal and Shoot/Block) */}
            <div className="flex items-end gap-3">
              {/* Secondary Context Button: Pass (Offense) or Steal (Defense) */}
              {hasBall ? (
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerPass();
                  }}
                  onClick={() => gameRef.current?.triggerPass()}
                  className="w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600/90 to-indigo-600/95 hover:from-blue-500 hover:to-indigo-500 border border-blue-300/60 active:scale-90 transition-transform backdrop-blur-xl shadow-[0_4px_16px_rgba(37,99,235,0.4)] flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                  title="Pass (E or X)"
                >
                  <span className="text-base">🔄</span>
                  <span className="text-[8px] font-black uppercase tracking-wider -mt-0.5">Pass</span>
                </button>
              ) : (
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerSteal();
                  }}
                  onClick={() => gameRef.current?.triggerSteal()}
                  className="w-14 h-14 rounded-full bg-gradient-to-tr from-violet-600/90 to-purple-700/95 hover:from-violet-500 hover:to-purple-600 border border-violet-300/60 active:scale-90 transition-transform backdrop-blur-xl shadow-[0_4px_16px_rgba(139,92,246,0.4)] flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
                  title="Steal (E or X)"
                >
                  <span className="text-base">🖐️</span>
                  <span className="text-[8px] font-black uppercase tracking-wider -mt-0.5">Steal</span>
                </button>
              )}

              {/* Primary Signature Button: Shoot / Dunk (Offense) or Block (Defense) */}
              {hasBall ? (
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.startShooting();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseShooting();
                  }}
                  onTouchCancel={(e) => {
                    e.preventDefault();
                    gameRef.current?.releaseShooting();
                  }}
                  onMouseDown={() => gameRef.current?.startShooting()}
                  onMouseUp={() => gameRef.current?.releaseShooting()}
                  onMouseLeave={() => gameRef.current?.releaseShooting()}
                  className="w-[72px] h-[72px] rounded-full bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-300 hover:brightness-110 active:scale-90 transition-transform shadow-[0_0_24px_rgba(245,158,11,0.55)] flex flex-col items-center justify-center text-slate-950 font-black cursor-pointer touch-manipulation border-2 border-amber-100"
                  title="Shoot / Dunk (Space)"
                >
                  <span className="text-2xl">🏀</span>
                  <span className="text-[10px] font-black uppercase tracking-wider -mt-0.5">Shoot</span>
                </button>
              ) : (
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.preventDefault();
                    gameRef.current?.triggerBlock();
                  }}
                  onClick={() => gameRef.current?.triggerBlock()}
                  className="w-[72px] h-[72px] rounded-full bg-gradient-to-tr from-cyan-600 via-sky-500 to-blue-600 hover:brightness-110 active:scale-90 transition-transform shadow-[0_0_24px_rgba(6,182,212,0.55)] flex flex-col items-center justify-center text-white font-black cursor-pointer touch-manipulation border-2 border-cyan-200"
                  title="Block / Contest (Space)"
                >
                  <span className="text-2xl">🛡️</span>
                  <span className="text-[10px] font-black uppercase tracking-wider -mt-0.5">Block</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 9. CONTROLS GUIDE MODAL DIALOG */}
      {/* ========================================================================= */}
      {showControlsGuide && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md z-50 p-4">
          <div className="bg-slate-950 border border-white/10 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h2 className="text-base font-black tracking-wide text-white uppercase flex items-center gap-2">
                <span>🎮</span> Controls & Guide
              </h2>
              <button
                type="button"
                onClick={() => setShowControlsGuide(false)}
                className="text-slate-400 hover:text-white text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Move Player</span>
                <span className="font-mono font-bold text-amber-300">W, A, S, D / Arrows</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Sprint / Turbo</span>
                <span className="font-mono font-bold text-amber-300">Hold Shift</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Jump Shot / Slam Dunk</span>
                <span className="font-mono font-bold text-amber-300">Hold & Release Space</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Pass (Offense)</span>
                <span className="font-mono font-bold text-amber-300">E or X</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Contest / Block (Defense)</span>
                <span className="font-mono font-bold text-amber-300">Space</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Poke Check Steal (Defense)</span>
                <span className="font-mono font-bold text-amber-300">E or X</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-slate-400">Switch Player</span>
                <span className="font-mono font-bold text-amber-300">C or Q</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowControlsGuide(false)}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Back to Game
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 10. TIP-OFF MATCHUP PREVIEW MODAL */}
      {/* ========================================================================= */}
      {tipOffMounted && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl z-50 transition-opacity duration-300 ease-out ${
            tipOffFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          style={tipOffFading ? { display: 'none' } : undefined}
        >
          <div className="bg-slate-950/95 border border-white/10 p-5 sm:p-7 rounded-3xl max-w-sm sm:max-w-md w-full text-center shadow-[0_24px_64px_rgba(0,0,0,0.85)] space-y-4 sm:space-y-6 max-h-[90dvh] overflow-y-auto">
            <div className="space-y-1">
              <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-amber-400">
                NBA ARENA SHOWDOWN
              </span>
              <h1 className="text-xl sm:text-3xl font-black text-white tracking-wide">
                WARRIORS vs ROCKETS
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
                Chase Center · San Francisco, CA
              </p>
            </div>

            {/* Matchup Head-to-Head Card */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 py-1">
              <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-b from-[#0053bc]/25 to-slate-900/60 border border-[#0053bc]/30 flex flex-col items-center">
                <span className="text-[11px] sm:text-xs font-bold text-slate-400">GOLDEN STATE</span>
                <span className="text-xl sm:text-2xl font-black text-[#fdb927]">GSW</span>
                <span className="text-[10px] text-slate-300 mt-1 font-semibold">S. Curry #30</span>
              </div>
              <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-b from-[#ce1141]/25 to-slate-900/60 border border-[#ce1141]/30 flex flex-col items-center">
                <span className="text-[11px] sm:text-xs font-bold text-slate-400">HOUSTON</span>
                <span className="text-xl sm:text-2xl font-black text-red-500">HOU</span>
                <span className="text-[10px] text-slate-300 mt-1 font-semibold">J. Green #4</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartTipOff}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleStartTipOff();
              }}
              className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-110 active:scale-95 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-lg transition-transform cursor-pointer uppercase tracking-wider touch-manipulation"
            >
              Start Tip-Off 🏀
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

