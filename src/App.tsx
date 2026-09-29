import React, { useEffect, useRef, useState } from 'react';
import { BasketballGame } from './game';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<BasketballGame | null>(null);

  // Scoreboard
  const [homeScore, setHomeScore] = useState(10);
  const [awayScore, setAwayScore] = useState(8);
  const [shotClock, setShotClock] = useState(24);

  // Shot Meter & Feedback
  const [meterValue, setMeterValue] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [shotFeedback, setShotFeedback] = useState<{ text: string; isGreen: boolean } | null>(null);

  // (3) Tip-Off Menu Overlay State
  const [tipOffStarted, setTipOffStarted] = useState(false);
  const [tipOffFading, setTipOffFading] = useState(false);
  const [tipOffMounted, setTipOffMounted] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const game = new BasketballGame(containerRef.current);
    gameRef.current = game;

    // (1) Listen to verified scoreboard updates
    game.onScoreUpdate = (home, away, points, team) => {
      setHomeScore(home);
      setAwayScore(away);
    };

    game.onShotMeterUpdate = (val, charging) => {
      setMeterValue(val);
      setIsCharging(charging);
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

    return () => {
      game.destroy();
    };
  }, []);

  // (3) Fix for Tip-Off Menu overlay bleed-through
  const handleStartTipOff = () => {
    setTipOffStarted(true);
    setTipOffFading(true);

    // After animation completes, completely unmount from DOM
    setTimeout(() => {
      setTipOffMounted(false);
      setTipOffFading(false);
    }, 600);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none font-sans">
      {/* 3D Canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* TOP SCOREBOARD */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center bg-slate-900/90 border border-slate-700 backdrop-blur-md rounded-2xl px-6 py-3 shadow-2xl text-white z-20">
        <div className="flex items-center space-x-3 mr-6">
          <div className="w-3.5 h-3.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="font-extrabold tracking-wider text-xl text-yellow-400">GSW</span>
          <span className="text-3xl font-black">{homeScore}</span>
        </div>

        <div className="flex flex-col items-center px-4 border-x border-slate-700">
          <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Shot Clock</span>
          <span className={`text-2xl font-mono font-bold ${shotClock <= 5 ? 'text-red-500 animate-bounce' : 'text-emerald-400'}`}>
            {shotClock}
          </span>
        </div>

        <div className="flex items-center space-x-3 ml-6">
          <span className="text-3xl font-black">{awayScore}</span>
          <span className="font-extrabold tracking-wider text-xl text-red-500">HOU</span>
          <div className="w-3.5 h-3.5 rounded-full bg-red-600" />
        </div>
      </div>

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

      {/* 2K SHOT METER */}
      {isCharging && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-48 flex flex-col items-center z-20">
          <div className="w-full bg-slate-800/90 h-4 rounded-full border border-slate-600 overflow-hidden relative shadow-lg">
            <div
              className={`h-full transition-all duration-75 ${
                meterValue > 0.92 ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-yellow-400'
              }`}
              style={{ width: `${meterValue * 100}%` }}
            />
            {/* Green Perfect Notch */}
            <div className="absolute top-0 right-[4%] w-2 h-full bg-emerald-300" />
          </div>
          <span className="text-xs text-slate-300 mt-1.5 font-bold tracking-wider uppercase">
            Release on Green
          </span>
        </div>
      )}

      {/* CONTROLS GUIDE */}
      <div className="absolute bottom-5 left-5 bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-xl p-3 text-xs text-slate-300 space-y-1 z-10 hidden sm:block">
        <p><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white font-mono">WASD / Arrows</kbd> Move</p>
        <p><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white font-mono">SPACE</kbd> Shoot (Hold & Time Release)</p>
        <p><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white font-mono">X / E</kbd> Pass</p>
        <p><kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white font-mono">C / Q</kbd> Switch Player</p>
      </div>

      {/* (3) TIP-OFF OVERLAY: FULLY UNMOUNTED AFTER FADE */}
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
