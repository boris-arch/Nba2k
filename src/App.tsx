/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { NBAGame } from './game';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<NBAGame | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize game
    gameRef.current = new NBAGame(containerRef.current);

    // FIX #3: Hide tip-off modal and start game after brief delay
    const tipOffBtn = document.querySelector('.loading-tipoff-btn') as HTMLElement;
    if (tipOffBtn) {
      tipOffBtn.addEventListener('click', () => {
        gameRef.current?.hideTipOffModal();
        // Fade out loading screen
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
          loadingScreen.classList.add('loaded');
        }
        // Start game
        setTimeout(() => {
          gameRef.current?.startGame();
        }, 500);
      });
    }

    // Handle window resize
    const handleResize = () => {
      if (gameRef.current) {
        // Game handles its own resize logic
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0 }}>
      <div
        ref={containerRef}
        id="canvas-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div id="hud-layer" style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
        {/* Scorebug */}
        <div
          className="broadcast-scorebug-container"
          style={{
            position: 'absolute',
            bottom: 'max(16px, env(safe-area-inset-bottom))',
            right: 'max(16px, env(safe-area-inset-right))',
            zIndex: 20
          }}
        >
          <div className="nba-scorebug-card">
            <div className="scorebug-row away-team">
              <div className="team-icon-decal">🔵</div>
              <div className="team-code">GSW</div>
              <div className="team-possession-dot"></div>
              <div className="team-score-num away-team">0</div>
            </div>
            <div className="scorebug-row home-team">
              <div className="team-icon-decal">🔴</div>
              <div className="team-code">HOU</div>
              <div className="team-possession-dot"></div>
              <div className="team-score-num home-team">0</div>
            </div>
            <div className="scorebug-footer">
              <span className="quarter-txt">Q1</span>
              <span className="game-time-txt">12:00</span>
              <span className="shot-clock-tag">24</span>
            </div>
          </div>
        </div>

        {/* Vertical Shot Meter */}
        <div
          id="vertical-shot-meter"
          style={{
            position: 'absolute',
            transform: 'translate(-50%, -100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 35
          }}
        >
          <div className="v-meter-track">
            <div className="v-meter-green-zone"></div>
            <div className="v-meter-fill"></div>
            <div className="v-meter-needle"></div>
          </div>
        </div>

        {/* Floating Score Popup */}
        <div
          id="floating-score-popup"
          style={{
            position: 'absolute',
            transform: 'translate(-50%, -50%)',
            fontSize: '34px',
            fontWeight: 900,
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 40,
            textShadow: '0 0 16px rgba(251, 191, 36, 0.8)',
            color: '#fbbf24'
          }}
        />

        {/* Shot Feedback HUD */}
        <div
          id="shot-feedback-hud"
          style={{
            position: 'absolute',
            top: '18%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 30
          }}
        />

        {/* Referee Banner */}
        <div
          id="referee-banner"
          style={{
            position: 'absolute',
            top: '26%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(0.9)',
            background: 'rgba(220, 38, 38, 0.92)',
            border: '2px solid #ffffff',
            padding: '8px 24px',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 35
          }}
        />
      </div>

      {/* Touch Controls */}
      <div className="touch-controls-container">
        <div className="joystick-base">
          <div className="joystick-thumb"></div>
        </div>
        <div className="action-buttons-group">
          <button className="context-btn btn-shoot-3pt">SHOOT</button>
          <button className="context-btn btn-action-pass">PASS</button>
          <button className="context-btn btn-action-turbo">TURBO</button>
        </div>
      </div>

      {/* Confetti Canvas */}
      <canvas id="confetti-canvas" style={{ position: 'absolute', inset: 0, zIndex: 60, pointerEvents: 'none' }} />

      {/* Loading Screen */}
      <div id="loading-screen" style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
        <div className="loading-card">
          <div className="loading-logo-row">
            <div className="loading-2k-badge">2K</div>
            <div className="loading-game-title">NBA 2K26</div>
          </div>
          <div className="loading-game-sub">Arena Broadcast Showdown</div>

          <div className="loading-matchup">
            <div className="loading-team warriors">
              <div className="loading-team-icon">🔵</div>
              <div className="loading-team-name">WARRIORS</div>
              <div className="loading-star-name">S. Curry</div>
            </div>
            <div className="loading-vs-badge">VS</div>
            <div className="loading-team rockets">
              <div className="loading-team-icon">🔴</div>
              <div className="loading-team-name">ROCKETS</div>
              <div className="loading-star-name">J. Harden</div>
            </div>
          </div>

          <div className="loading-progress-box">
            <div className="loading-status-row">
              <span id="loading-status-text">Initializing arena...</span>
              <span id="loading-percentage">0%</span>
            </div>
            <div className="loading-bar-track">
              <div className="loading-bar-fill" style={{ width: '100%' }}></div>
            </div>
          </div>

          <button className="loading-tipoff-btn">TIP-OFF!</button>
        </div>
      </div>

      {/* Modal Overlay for tip-off (FIX #3) */}
      <div
        className="modal-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 50,
          background: 'rgba(5, 8, 17, 0.88)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          opacity: 0,
          pointerEvents: 'none',
          transition: 'opacity 0.25s ease'
        }}
      />
    </div>
  );
}
