import React, { useEffect, useRef, useState } from 'react';
import { BasketballGame, ShotMeterEvent, FoulEventUI, ViolationEventUI } from './game';
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

  // Mouse support for testing mobile controls on desktop
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
      className={`relative w-28 h-28 rounded-full flex items-center justify-center bg-slate-900/80 backdrop-blur-md border-2 transition-colors select-none cursor-pointer ${
        isActive
          ? 'border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.4)]'
          : 'border-slate-700/80 shadow-2xl'
      }`}
    >
      <div
        style={{
          transform: `translate(${thumbPos.x}px, ${thumbPos.y}px)`,
        }}
        className={`w-14 h-14 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-yellow-400 shadow-xl pointer-events-none flex items-center justify-center transition-transform duration-75 ${
          isActive ? 'scale-105' : ''
        }`}
      >
        <div className="w-5 h-5 rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.85)] flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-white/80" />
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

  // Official NBA Team Fouls & Bonus / Penalty State
  const [gswFouls, setGswFouls] = useState(2);
  const [houFouls, setHouFouls] = useState(3);
  const [gswBonus, setGswBonus] = useState(false);
  const [houBonus, setHouBonus] = useState(false);

  // Official Rule Violation Overlay State
  const [violationEvent, setViolationEvent] = useState<ViolationEventUI | null>(null);
  const violationTimeoutRef = useRef<number | null>(null);

  // Tip-Off Menu Overlay State
  const [tipOffStarted, setTipOffStarted] = useState(false);
  const [tipOffFading, setTipOffFading] = useState(false);
  const [tipOffMounted, setTipOffMounted] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const game = new BasketballGame(containerRef.current);
    gameRef.current = game;

    // Listen to verified scoreboard updates
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
      setTimeout(() => {
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
      game.destroy();
    };
  }, []);

  const handleStartTipOff = () => {
    setTipOffStarted(true);
    setTipOffFading(true);

    setTimeout(() => {
      setTipOffMounted(false);
      setTipOffFading(false);
    }, 600);
  };

  const handleJoystickMove = (x: number, y: number) => {
    gameRef.current?.setJoystickInput(x, y);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none font-sans">
      {/* 3D Canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* TOP SCOREBOARD */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center bg-slate-900/90 border border-slate-700 backdrop-blur-md rounded-2xl px-6 py-3 shadow-2xl text-white z-20">
        <div className="flex flex-col mr-6 items-end">
          <div className="flex items-center space-x-3">
            <div className="w-3.5 h-3.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="font-extrabold tracking-wider text-xl text-yellow-400">GSW</span>
            <span className="text-3xl font-black">{homeScore}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">FOULS: {gswFouls}</span>
            {gswBonus && (
              <span className="text-[9px] font-black px-1.5 py-0.2 bg-amber-400 text-slate-950 rounded font-mono shadow-[0_0_8px_rgba(250,204,21,0.8)] animate-pulse">
                BONUS
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center px-4 border-x border-slate-700">
          <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Shot Clock</span>
          <span className={`text-2xl font-mono font-bold ${shotClock <= 5 ? 'text-red-500 animate-bounce' : 'text-emerald-400'}`}>
            {shotClock}
          </span>
          {/* Turbo / Stamina Bar */}
          <div className="w-16 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden border border-slate-600">
            <div
              className={`h-full transition-all duration-75 ${
                stamina > 0.35 ? 'bg-amber-400' : 'bg-red-500'
              }`}
              style={{ width: `${stamina * 100}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col ml-6 items-start">
          <div className="flex items-center space-x-3">
            <span className="text-3xl font-black">{awayScore}</span>
            <span className="font-extrabold tracking-wider text-xl text-red-500">HOU</span>
            <div className="w-3.5 h-3.5 rounded-full bg-red-600" />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">FOULS: {houFouls}</span>
            {houBonus && (
              <span className="text-[9px] font-black px-1.5 py-0.2 bg-amber-400 text-slate-950 rounded font-mono shadow-[0_0_8px_rgba(250,204,21,0.8)] animate-pulse">
                BONUS
              </span>
            )}
          </div>
        </div>

        {/* Camera View Mode Toggle Button */}
        <button
          type="button"
          onClick={() => {
            const nextMode = gameRef.current?.toggleCameraMode();
            if (nextMode) setCameraMode(nextMode);
          }}
          className="ml-4 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600 active:scale-95 transition-all text-xs font-black text-amber-400 cursor-pointer shadow-md flex items-center gap-1.5"
          title="Toggle Camera View (Side Broadcast, Courtside, 2K Behind)"
        >
          <span className="text-sm">🎥</span>
          <span className="tracking-wider uppercase">
            {cameraMode === 'SIDE' ? 'Side View' : cameraMode === 'COURTSIDE' ? 'Courtside' : '2K Behind'}
          </span>
        </button>

        {/* Sound Audio Mute Toggle Button */}
        <button
          type="button"
          onClick={() => setIsMuted(sounds.toggleMute())}
          className="ml-2.5 p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600 active:scale-90 transition-all text-sm cursor-pointer shadow-md"
          title={isMuted ? 'Unmute Game Sounds' : 'Mute Game Sounds'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* FOUL & FREE THROW BROADCAST RIBBON (NON-INTRUSIVE DOCKED LOWER THIRD) */}
      {foulEvent && (
        <div className="absolute bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 select-none pointer-events-none transition-all duration-300 max-w-[94vw] sm:max-w-2xl w-auto">
          <div className="bg-slate-950/85 border border-amber-500/50 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.85)] px-4 py-2 sm:px-5 sm:py-2.5 backdrop-blur-md flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
            {/* Left: Whistle Badge, Shooter & Fouler Info */}
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-center sm:justify-start">
              <span className="text-amber-400 font-black text-[10px] sm:text-xs uppercase tracking-wider bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/30 whitespace-nowrap">
                ⚡ {foulEvent.foulType}
              </span>
              <div className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm">
                <span className={foulEvent.team === 'GSW' ? 'text-amber-400 font-black' : 'text-red-400 font-black'}>
                  {foulEvent.fouledName}
                </span>
                <span className="text-slate-400 text-xs">
                  ({foulEvent.attemptsTotal} FT{foulEvent.attemptsTotal > 1 ? 's' : ''})
                </span>
              </div>
              <span className="text-slate-400 font-semibold text-[10px] sm:text-[11px] bg-slate-900/90 px-2 py-0.5 rounded-full border border-slate-700/60 whitespace-nowrap">
                Foul on {foulEvent.foulerName} (#{foulEvent.foulerPersonalFouls})
              </span>
            </div>

            {/* Divider on desktop */}
            <div className="hidden sm:block h-6 w-px bg-slate-700/80" />

            {/* Right: Shot Attempts & Live Status */}
            <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
              <div className="flex items-center gap-1.5">
                <div
                  className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 whitespace-nowrap ${
                    foulEvent.shot1Result === 'MADE'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : foulEvent.shot1Result === 'MISSED'
                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                      : 'bg-slate-900/90 text-slate-400 border-slate-700'
                  }`}
                >
                  <span className="text-slate-400 font-bold">1:</span>
                  <span>{foulEvent.shot1Result === 'MADE' ? '✓ MADE (+1)' : foulEvent.shot1Result === 'MISSED' ? '✗ MISSED' : 'WAIT'}</span>
                </div>

                {foulEvent.attemptsTotal >= 2 && (
                  <div
                    className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 whitespace-nowrap ${
                      foulEvent.shot2Result === 'MADE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : foulEvent.shot2Result === 'MISSED'
                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                        : 'bg-slate-900/90 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span className="text-slate-400 font-bold">2:</span>
                    <span>{foulEvent.shot2Result === 'MADE' ? '✓ MADE (+1)' : foulEvent.shot2Result === 'MISSED' ? '✗ MISSED' : 'WAIT'}</span>
                  </div>
                )}

                {foulEvent.attemptsTotal >= 3 && (
                  <div
                    className={`text-[10px] sm:text-[11px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 whitespace-nowrap ${
                      foulEvent.shot3Result === 'MADE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : foulEvent.shot3Result === 'MISSED'
                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                        : 'bg-slate-900/90 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span className="text-slate-400 font-bold">3:</span>
                    <span>{foulEvent.shot3Result === 'MADE' ? '✓ MADE (+1)' : foulEvent.shot3Result === 'MISSED' ? '✗ MISSED' : 'WAIT'}</span>
                  </div>
                )}
              </div>

              {/* Status Ticker */}
              <span className="text-[10px] sm:text-[11px] font-bold text-amber-300 uppercase tracking-wide whitespace-nowrap">
                {foulEvent.statusText}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL NBA REFEREE RULE VIOLATION BANNER (SLIM LOWER-THIRD) */}
      {violationEvent && (
        <div className="absolute bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 select-none pointer-events-none transition-all duration-300 max-w-[94vw] sm:max-w-xl">
          <div className="bg-slate-950/90 border border-red-500/60 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.85)] px-4 py-2.5 backdrop-blur-md flex items-center gap-3">
            <span className="text-red-400 font-black text-xs uppercase tracking-wider bg-red-950/60 px-2.5 py-0.5 rounded-full border border-red-500/40 whitespace-nowrap">
              🛑 {violationEvent.violation}
            </span>
            <div className="text-slate-200 text-xs font-medium truncate">
              {violationEvent.description}
            </div>
            <span className="text-[10px] font-black tracking-wider uppercase text-amber-400 bg-black/60 px-2 py-0.5 rounded border border-slate-700 whitespace-nowrap ml-auto">
              BALL TO {violationEvent.awardedTeam}
            </span>
          </div>
        </div>
      )}

      {/* SHOT RELEASE FEEDBACK */}
      {shotFeedback && (
        <div
          className={`absolute top-28 left-1/2 -translate-x-1/2 px-6 py-2 rounded-xl text-lg font-black tracking-wider uppercase shadow-xl transition-all scale-110 z-20 ${
            shotFeedback.isGreen
              ? 'bg-emerald-500 text-white ring-4 ring-emerald-300 animate-pulse'
              : 'bg-yellow-500 text-slate-950'
          }`}
        >
          {shotFeedback.text}
        </div>
      )}

      {/* 2K SIGNATURE SHOT METER */}
      {meterState && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-72 flex flex-col items-center z-30 pointer-events-none select-none">
          {/* Release Timing Badge (Appears instantly on release freeze) */}
          {meterState.isFrozen && meterState.quality && (
            <div
              className={`mb-2 px-3.5 py-1 rounded-full text-xs font-black uppercase tracking-wider shadow-2xl transition-transform scale-110 ${
                meterState.isGreen
                  ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.9)] animate-pulse'
                  : meterState.quality.includes('EARLY')
                  ? 'bg-amber-400 text-slate-950 shadow-amber-400/50'
                  : 'bg-red-500 text-white shadow-red-500/50'
              }`}
            >
              {meterState.quality}
            </div>
          )}

          {/* Meter Base Track */}
          <div
            className={`relative w-full h-5 rounded-full bg-slate-950/95 border-2 p-0.5 shadow-[0_0_24px_rgba(0,0,0,0.8)] overflow-hidden transition-colors ${
              meterState.isFrozen && meterState.isGreen
                ? 'border-emerald-400 ring-2 ring-emerald-400/60 shadow-[0_0_20px_rgba(52,211,153,0.8)]'
                : meterState.isGreen
                ? 'border-emerald-400'
                : 'border-slate-600/90'
            }`}
          >
            {/* Background Sub-division Ticks */}
            <div className="absolute inset-0 flex justify-between px-4 pointer-events-none opacity-20">
              <div className="w-0.5 h-full bg-white" />
              <div className="w-0.5 h-full bg-white" />
              <div className="w-0.5 h-full bg-white" />
            </div>

            {/* Target Green Window (91% - 100%) */}
            <div className="absolute top-0 bottom-0 right-[3%] w-[12%] bg-emerald-500/80 border-x border-emerald-300 flex items-center justify-center shadow-[0_0_8px_rgba(52,211,153,0.8)]">
              <div className="w-0.5 h-full bg-white shadow-[0_0_4px_#ffffff]" />
            </div>

            {/* Instant Real-Time Fill (Zero CSS transition lag for 1:1 hardware responsiveness) */}
            <div
              className={`h-full rounded-full ${
                meterState.isGreen
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]'
                  : 'bg-gradient-to-r from-amber-500 via-yellow-400 to-yellow-300'
              }`}
              style={{
                width: `${Math.min(100, Math.max(0, meterState.value * 100))}%`,
              }}
            />

            {/* Precision Needle Marker */}
            <div
              className="absolute top-0 bottom-0 w-1.5 -ml-0.5 bg-white shadow-[0_0_8px_#ffffff] rounded-full pointer-events-none"
              style={{
                left: `${Math.min(100, Math.max(0, meterState.value * 100))}%`,
              }}
            />
          </div>

          {/* Subtitle helper during charge */}
          {!meterState.isFrozen && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className={`text-[10px] font-black tracking-widest uppercase ${
                  meterState.isGreen ? 'text-emerald-400 animate-pulse' : 'text-slate-300'
                }`}
              >
                {meterState.isGreen ? '★ GREEN WINDOW — RELEASE NOW! ★' : 'HOLD & RELEASE ON GREEN'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* MOBILE CONTROLS: VIRTUAL JOYSTICK ON BOTTOM LEFT (LEFT KEY GUIDE REMOVED) */}
      <div className="absolute bottom-6 left-6 z-30">
        <VirtualJoystick onMove={handleJoystickMove} />
      </div>

      {/* MOBILE CONTROLS: CONTEXT ACTION BUTTONS ON BOTTOM RIGHT */}
      <div className="absolute bottom-6 right-6 flex items-end gap-2.5 z-30 select-none">
        {/* SPRINT / TURBO BUTTON */}
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
          className="w-13 h-13 rounded-full bg-slate-900/90 hover:bg-slate-800 border-2 border-amber-400 active:scale-90 transition-transform shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
          title="Hold to Sprint / Turbo (Shift on keyboard)"
        >
          <span className="text-base leading-none">⚡</span>
          <span className="text-[8px] font-black uppercase tracking-wider text-amber-400 mt-0.5">Turbo</span>
        </button>

        {/* SWITCH PLAYER BUTTON */}
        <button
          type="button"
          onTouchStart={(e) => {
            e.preventDefault();
            gameRef.current?.cycleControlledPlayer();
          }}
          onClick={() => gameRef.current?.cycleControlledPlayer()}
          className="w-13 h-13 rounded-full bg-slate-900/90 hover:bg-slate-800 border-2 border-slate-600 active:scale-90 transition-transform shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
          title="Switch Player (C or Q on keyboard)"
        >
          <span className="text-base leading-none">👥</span>
          <span className="text-[8px] font-black uppercase tracking-wider text-slate-300 mt-0.5">Switch</span>
        </button>

        {/* SECONDARY ACTION: PASS (Offense) or STEAL (Defense) */}
        {hasBall ? (
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              gameRef.current?.triggerPass();
            }}
            onClick={() => gameRef.current?.triggerPass()}
            className="w-15 h-15 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 hover:from-blue-500 hover:to-indigo-400 border-2 border-blue-300 active:scale-90 transition-transform shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
            title="Pass to open teammate (E or X on keyboard)"
          >
            <span className="text-lg leading-none">🔄</span>
            <span className="text-[9px] font-black uppercase tracking-wider mt-0.5">Pass</span>
          </button>
        ) : (
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              gameRef.current?.triggerSteal();
            }}
            onClick={() => gameRef.current?.triggerSteal()}
            className="w-15 h-15 rounded-full bg-gradient-to-tr from-purple-700 via-violet-600 to-indigo-600 hover:from-purple-600 hover:to-violet-500 border-2 border-violet-300 active:scale-90 transition-transform shadow-xl flex flex-col items-center justify-center text-white cursor-pointer touch-manipulation"
            title="Poke check steal (E or X on keyboard)"
          >
            <span className="text-lg leading-none">🖐️</span>
            <span className="text-[9px] font-black uppercase tracking-wider mt-0.5">Steal</span>
          </button>
        )}

        {/* PRIMARY ACTION: SHOOT / DUNK (Offense) or BLOCK (Defense) */}
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
            className="w-20 h-20 rounded-full bg-gradient-to-tr from-amber-600 via-yellow-500 to-amber-400 hover:from-amber-500 hover:to-yellow-400 border-2 border-yellow-200 active:scale-90 transition-transform shadow-[0_0_24px_rgba(245,158,11,0.5)] flex flex-col items-center justify-center text-slate-950 font-black cursor-pointer touch-manipulation"
            title="Hold to charge jump shot, or release near rim for slam dunk (Spacebar on keyboard)"
          >
            <span className="text-2xl leading-none">🏀</span>
            <span className="text-[10px] font-black uppercase tracking-wider mt-0.5">Shoot</span>
          </button>
        ) : (
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              gameRef.current?.triggerBlock();
            }}
            onClick={() => gameRef.current?.triggerBlock()}
            className="w-20 h-20 rounded-full bg-gradient-to-tr from-cyan-600 via-sky-500 to-blue-600 hover:from-cyan-500 hover:to-sky-400 border-2 border-cyan-200 active:scale-90 transition-transform shadow-[0_0_24px_rgba(6,182,212,0.5)] flex flex-col items-center justify-center text-white font-black cursor-pointer touch-manipulation"
            title="Leap to block or contest shot (Spacebar on keyboard)"
          >
            <span className="text-2xl leading-none">🛡️</span>
            <span className="text-[10px] font-black uppercase tracking-wider mt-0.5">Block</span>
          </button>
        )}
      </div>

      {/* TIP-OFF OVERLAY: FULLY UNMOUNTED AFTER FADE */}
      {tipOffMounted && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md z-50 transition-opacity duration-500 ease-out ${
            tipOffFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          style={tipOffFading ? { display: 'none' } : undefined}
        >
          <div className="bg-slate-900/90 border border-slate-700 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl space-y-6">
            <div className="space-y-2">
              <h1 className="text-4xl font-black text-white tracking-wider">NBA 2K SHOWDOWN</h1>
              <p className="text-sm font-semibold text-slate-400">GOLDEN STATE WARRIORS vs HOUSTON ROCKETS</p>
            </div>

            <div className="flex justify-around items-center py-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
              <div className="text-center">
                <span className="block text-2xl font-black text-yellow-400">GSW</span>
                <span className="text-xs text-slate-400 font-bold">10 PTS</span>
              </div>
              <span className="text-slate-500 font-black text-xl">VS</span>
              <div className="text-center">
                <span className="block text-2xl font-black text-red-500">HOU</span>
                <span className="text-xs text-slate-400 font-bold">8 PTS</span>
              </div>
            </div>

            <button
              onClick={handleStartTipOff}
              className="w-full py-4 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-slate-950 font-black text-lg rounded-2xl shadow-xl transition-transform active:scale-95 cursor-pointer uppercase tracking-wider"
            >
              Start Tip-Off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
