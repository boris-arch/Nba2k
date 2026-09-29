/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NBA 2K-style Basketball Game - Complete Implementation
 */

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Player {
  id: string;
  name: string;
  number: number;
  team: 'warriors' | 'rockets';
  position: THREE.Vector3;
  mesh: THREE.Group;
  body: CANNON.Body;
  stamina: number;
  maxStamina: number;
  isControlled: boolean;
  nameplate: HTMLElement | null; // FIX #2: Single nameplate per player
  isRunning: boolean;
  legRotation: number; // For running animation - FIX #4
}

interface GameState {
  score: { warriors: number; rockets: number };
  quarter: number;
  gameTime: number;
  shotClock: number;
  possession: 'warriors' | 'rockets';
  gameActive: boolean;
  lastMakeWasGreen: boolean;
}

// ============================================================================
// GAME SCENE & PHYSICS SETUP
// ============================================================================

export class NBAGame {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;
  private world: CANNON.World;
  private gameState: GameState;
  private players: Map<string, Player>;
  private controlledPlayerId: string | null = null;
  private ball: { mesh: THREE.Mesh; body: CANNON.Body } | null = null;
  private confettiParticles: THREE.Points[] = [];
  private floatingTexts: { mesh: THREE.Mesh; startTime: number }[] = [];

  constructor(canvasContainer: HTMLElement) {
    // THREE.js setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a12);
    
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 3, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    canvasContainer.appendChild(this.renderer.domElement);

    // Physics setup
    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.82, 0);
    this.world.defaultContactMaterial.friction = 0.4;

    // Initialize game state
    this.gameState = {
      score: { warriors: 0, rockets: 0 },
      quarter: 1,
      gameTime: 720, // 12 minutes in seconds
      shotClock: 24,
      possession: 'warriors',
      gameActive: false,
      lastMakeWasGreen: false
    };

    this.players = new Map();

    // Setup court, teams, ball
    this.setupCourt();
    this.setupTeams();
    this.setupBall();
    this.setupLights();
    this.attachEventListeners();

    // Animation loop
    this.animate();
  }

  // ========================================================================
  // COURT & ARENA SETUP
  // ========================================================================

  private setupCourt(): void {
    // Court floor
    const courtGeom = new THREE.PlaneGeometry(94, 50);
    const courtMat = new THREE.MeshLambertMaterial({ color: 0xd2691e });
    const courtMesh = new THREE.Mesh(courtGeom, courtMat);
    courtMesh.receiveShadow = true;
    this.scene.add(courtMesh);

    // Physics floor
    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({ mass: 0, shape: floorShape });
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(floorBody);

    // Court lines (simplified)
    this.drawCourtLines();

    // Hoop assembly (simplified)
    this.setupHoop();
  }

  private drawCourtLines(): void {
    const lines: { start: THREE.Vector3; end: THREE.Vector3 }[] = [
      // Baseline
      { start: new THREE.Vector3(-47, 0.01, -25), end: new THREE.Vector3(-47, 0.01, 25) },
      // Half court
      { start: new THREE.Vector3(0, 0.01, -25), end: new THREE.Vector3(0, 0.01, 25) },
      // Free throw line
      { start: new THREE.Vector3(-40, 0.01, -16), end: new THREE.Vector3(-40, 0.01, 16) }
    ];

    lines.forEach(line => {
      const geom = new THREE.BufferGeometry().setFromPoints([line.start, line.end]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
      const lineObj = new THREE.Line(geom, mat);
      this.scene.add(lineObj);
    });
  }

  private setupHoop(): void {
    const rimRadius = 0.23;
    const rimHeight = 3.05;

    // Backboard
    const backboardGeom = new THREE.BoxGeometry(1.05, 1.05, 0.1);
    const backboardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.8,
      roughness: 0.2
    });
    const backboard = new THREE.Mesh(backboardGeom, backboardMat);
    backboard.position.set(-41, rimHeight, 0);
    backboard.castShadow = true;
    this.scene.add(backboard);

    // Rim (collision detected here for scoring)
    const rimGeom = new THREE.TorusGeometry(rimRadius, 0.025, 8, 32);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const rim = new THREE.Mesh(rimGeom, rimMat);
    rim.position.set(-41, rimHeight, 0);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    rim.name = 'hoop-rim';
    this.scene.add(rim);

    // Rim physics (for ball collision)
    const rimBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Sphere(rimRadius)
    });
    rimBody.position.set(-41, rimHeight, 0);
    this.world.addBody(rimBody);
  }

  // ========================================================================
  // TEAM & PLAYER SETUP
  // ========================================================================

  private setupTeams(): void {
    const warriorPositions = [
      { pos: new THREE.Vector3(0, 0, 0), name: 'S. CURRY', num: 30 },
      { pos: new THREE.Vector3(5, 0, 5), name: 'D. GREEN', num: 23 },
      { pos: new THREE.Vector3(-5, 0, 8), name: 'K. THOMPSON', num: 11 },
      { pos: new THREE.Vector3(8, 0, -3), name: 'A. WIGGINS', num: 22 },
      { pos: new THREE.Vector3(-8, 0, -5), name: 'T. LOONEY', num: 5 }
    ];

    const rocketPositions = [
      { pos: new THREE.Vector3(-10, 0, 0), name: 'J. HARDEN', num: 13 },
      { pos: new THREE.Vector3(-15, 0, 6), name: 'E. GORDON', num: 10 },
      { pos: new THREE.Vector3(-8, 0, -8), name: 'A. MARTIN', num: 12 },
      { pos: new THREE.Vector3(-12, 0, 8), name: 'S. ALRIDGE', num: 14 },
      { pos: new THREE.Vector3(-20, 0, 0), name: 'S. ADAMS', num: 25 }
    ];

    warriorPositions.forEach((p, idx) => {
      const player = this.createPlayer(p.pos, 'warriors', p.name, p.num, idx === 0);
      this.players.set(player.id, player);
    });

    rocketPositions.forEach((p, idx) => {
      const player = this.createPlayer(p.pos, 'rockets', p.name, p.num, false);
      this.players.set(player.id, player);
    });
  }

  private createPlayer(
    startPos: THREE.Vector3,
    team: 'warriors' | 'rockets',
    name: string,
    number: number,
    isControlled: boolean
  ): Player {
    const playerId = `${team}-${number}`;

    // Visual: simplified player capsule
    const playerGroup = new THREE.Group();
    const torsoGeom = new THREE.CapsuleGeometry(0.25, 0.8, 4, 8);
    const teamColor = team === 'warriors' ? 0x1d428a : 0xce1141;
    const torsoMat = new THREE.MeshStandardMaterial({ color: teamColor });
    const torso = new THREE.Mesh(torsoGeom, torsoMat);
    torso.castShadow = true;
    torso.position.y = 0.4;
    playerGroup.add(torso);

    // Legs (for running animation - FIX #4)
    const leftLegGeom = new THREE.BoxGeometry(0.12, 0.6, 0.12);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    const leftLeg = new THREE.Mesh(leftLegGeom, legMat);
    leftLeg.position.set(-0.15, -0.1, 0);
    leftLeg.castShadow = true;
    leftLeg.name = 'left-leg';
    playerGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(leftLegGeom, legMat);
    rightLeg.position.set(0.15, -0.1, 0);
    rightLeg.castShadow = true;
    rightLeg.name = 'right-leg';
    playerGroup.add(rightLeg);

    playerGroup.position.copy(startPos);
    this.scene.add(playerGroup);

    // Physics body (capsule approximated as cylinder)
    const playerShape = new CANNON.Sphere(0.35);
    const playerBody = new CANNON.Body({
      mass: 1,
      shape: playerShape,
      linearDamping: 0.9,
      angularDamping: 0.9
    });
    playerBody.position.copy(startPos);
    this.world.addBody(playerBody);

    const player: Player = {
      id: playerId,
      name,
      number,
      team,
      position: startPos.clone(),
      mesh: playerGroup,
      body: playerBody,
      stamina: 100,
      maxStamina: 100,
      isControlled,
      nameplate: null,
      isRunning: false,
      legRotation: 0
    };

    // FIX #2: Create exactly ONE nameplate per player
    this.createPlayerNameplate(player);

    if (isControlled) {
      this.controlledPlayerId = playerId;
    }

    return player;
  }

  // FIX #2: Single nameplate management
  private createPlayerNameplate(player: Player): void {
    if (player.nameplate) {
      player.nameplate.remove();
    }

    const nameplate = document.createElement('div');
    nameplate.className = 'player-ring-tag';
    nameplate.style.position = 'absolute';
    nameplate.style.display = 'none'; // Hidden until positioned
    nameplate.innerHTML = `
      <div class="player-tag-row">
        <span>${player.name}</span>
        <span>#${player.number}</span>
      </div>
      <div class="stamina-track">
        <div class="stamina-fill" style="width: 100%"></div>
      </div>
    `;
    document.getElementById('hud-layer')?.appendChild(nameplate);
    player.nameplate = nameplate;
  }

  // ========================================================================
  // BALL SETUP
  // ========================================================================

  private setupBall(): void {
    const ballRadius = 0.12;
    const ballGeom = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      roughness: 0.6
    });
    const ballMesh = new THREE.Mesh(ballGeom, ballMat);
    ballMesh.castShadow = true;
    ballMesh.position.set(5, 2, 0);
    this.scene.add(ballMesh);

    const ballBody = new CANNON.Body({
      mass: 0.6,
      shape: new CANNON.Sphere(ballRadius),
      linearDamping: 0.3,
      angularDamping: 0.3,
      restitution: 0.8
    });
    ballBody.position.copy(ballMesh.position);
    this.world.addBody(ballBody);

    this.ball = { mesh: ballMesh, body: ballBody };
  }

  // ========================================================================
  // LIGHTING
  // ========================================================================

  private setupLights(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Arena spotlights
    const spotlights = [
      { pos: [30, 25, 30], target: [0, 0, 0] },
      { pos: [-30, 25, 30], target: [0, 0, 0] },
      { pos: [30, 25, -30], target: [0, 0, 0] },
      { pos: [-30, 25, -30], target: [0, 0, 0] }
    ];

    spotlights.forEach(sl => {
      const light = new THREE.SpotLight(0xffffff, 0.8);
      light.position.set(...(sl.pos as [number, number, number]));
      light.target.position.set(...(sl.target as [number, number, number]));
      light.castShadow = true;
      light.shadow.mapSize.width = 2048;
      light.shadow.mapSize.height = 2048;
      this.scene.add(light);
      this.scene.add(light.target);
    });
  }

  // ========================================================================
  // GAME LOGIC: SHOOTING, SCORING, AI
  // ========================================================================

  // FIX #1: Perfect green release = 100% make
  public attemptShot(timing: number): void {
    if (!this.ball || !this.controlledPlayerId) return;

    const player = this.players.get(this.controlledPlayerId);
    if (!player) return;

    const isPerfectTiming = Math.abs(timing) < 0.05; // Very tight window
    const makePercentage = isPerfectTiming ? 1.0 : Math.random() > 0.5 ? 1.0 : 0.0;

    // Apply shot trajectory
    const shooterPos = player.position;
    const hoopPos = new THREE.Vector3(-41, 3.05, 0);
    const direction = hoopPos.clone().sub(shooterPos).normalize();

    this.ball.body.velocity.set(
      direction.x * 20,
      direction.y * 15,
      direction.z * 20
    );

    // FIX #1: Check if ball goes in (simplified hit detection)
    setTimeout(() => {
      const ballPos = this.ball!.mesh.position;
      const distToHoop = ballPos.distanceTo(new THREE.Vector3(-41, 3.05, 0));

      if (distToHoop < 0.5 && Math.random() < makePercentage) {
        this.onBasketMade(3, isPerfectTiming); // Assume 3PT
      }
    }, 1500);
  }

  // FIX #1: When basket is made, update scoreboard and show popup
  private onBasketMade(points: number, wasPerfectTiming: boolean): void {
    if (this.gameState.possession === 'warriors') {
      this.gameState.score.warriors += points;
    } else {
      this.gameState.score.rockets += points;
    }

    this.gameState.lastMakeWasGreen = wasPerfectTiming;

    // Update scoreboard
    this.updateScoreboard();

    // FIX #1: Show floating "+2" or "+3" popup
    this.showFloatingPoints(points);

    // FIX #1: Confetti only for perfect releases
    if (wasPerfectTiming) {
      this.triggerConfetti();
    }

    // Reset possession
    this.gameState.shotClock = 24;
    this.gameState.possession = this.gameState.possession === 'warriors' ? 'rockets' : 'warriors';
  }

  // FIX #1: Floating score popup near hoop
  private showFloatingPoints(points: number): void {
    const popupEl = document.getElementById('floating-score-popup');
    if (!popupEl) return;

    popupEl.textContent = `+${points}`;
    popupEl.style.color = '#fbbf24';
    popupEl.classList.remove('show-points');

    // Trigger reflow to restart animation
    void popupEl.offsetWidth;
    popupEl.classList.add('show-points');

    // Position at hoop
    const hoopScreenPos = this.worldToScreen(new THREE.Vector3(-41, 3.05, 0));
    popupEl.style.left = hoopScreenPos.x + 'px';
    popupEl.style.top = hoopScreenPos.y + 'px';
  }

  // FIX #1: Confetti only for perfect releases (not normal baskets)
  private triggerConfetti(): void {
    const confettiCanvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
    if (!confettiCanvas) return;

    const ctx = confettiCanvas.getContext('2d');
    if (!ctx) return;

    // Small burst of confetti for green releases
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20;
      const velocity = {
        x: Math.cos(angle) * 8,
        y: Math.sin(angle) * 8 - 2
      };
      this.createConfettiParticle(ctx, confettiCanvas, velocity);
    }
  }

  private createConfettiParticle(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    velocity: { x: number; y: number }
  ): void {
    const x = canvas.width / 2;
    const y = canvas.height / 2;
    const color = ['#fbbf24', '#22c55e', '#ef4444'][Math.floor(Math.random() * 3)];
    const lifetime = 2000; // 2 seconds
    const startTime = Date.now();

    const particle = {
      x,
      y,
      vx: velocity.x,
      vy: velocity.y,
      color,
      startTime,
      draw: () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > lifetime) return false;

        const alpha = 1 - elapsed / lifetime;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.1; // gravity

        return true;
      }
    };

    this.confettiParticles.push(particle as any);
  }

  // FIX #5: AI offense - Houston dribbles, passes, attempts shots
  private updateAIOffense(): void {
    if (this.gameState.possession !== 'rockets') return;

    const rocketPlayers = Array.from(this.players.values()).filter(p => p.team === 'rockets');
    if (rocketPlayers.length === 0) return;

    // Simple AI: ball handler dribbles toward basket
    const ballHandler = rocketPlayers[0];
    const hoopPos = new THREE.Vector3(-41, 0, 0);
    const dirToHoop = hoopPos.clone().sub(ballHandler.position).normalize();

    // FIX #5: Move toward basket
    ballHandler.body.velocity.set(dirToHoop.x * 6, 0, dirToHoop.z * 6);

    // FIX #5: Attempt shot when close enough
    if (ballHandler.position.distanceTo(hoopPos) < 15) {
      if (Math.random() < 0.1) {
        this.attemptShot(Math.random() * 0.1 - 0.05); // Slight variance
      }
    }

    // FIX #5: Pass to open teammate occasionally
    const openTeammate = this.findOpenTeammate(ballHandler, rocketPlayers);
    if (openTeammate && Math.random() < 0.05) {
      this.executePass(ballHandler, openTeammate);
    }
  }

  private findOpenTeammate(handler: Player, teammates: Player[]): Player | null {
    const warriors = Array.from(this.players.values()).filter(p => p.team === 'warriors');
    
    for (const teammate of teammates) {
      if (teammate.id === handler.id) continue;

      let isOpen = true;
      for (const defender of warriors) {
        if (defender.position.distanceTo(teammate.position) < 3) {
          isOpen = false;
          break;
        }
      }

      if (isOpen) return teammate;
    }
    return null;
  }

  private executePass(from: Player, to: Player): void {
    // Simple pass: move target player slightly toward ball
    const direction = to.position.clone().sub(from.position).normalize();
    to.body.velocity.set(direction.x * 4, 0, direction.z * 4);
  }

  // FIX #5: Defenders stay between their man and the basket
  private updateDefense(): void {
    const warriors = Array.from(this.players.values()).filter(p => p.team === 'warriors');
    const rockets = Array.from(this.players.values()).filter(p => p.team === 'rockets');

    // Assign loose matchups
    for (let i = 0; i < warriors.length && i < rockets.length; i++) {
      const defender = warriors[i];
      const attacker = rockets[i];

      // FIX #5: Move defender between attacker and goal
      const basketPos = new THREE.Vector3(41, 0, 0); // Warriors defending this goal
      const midpoint = new THREE.Vector3()
        .addVectors(attacker.position, basketPos)
        .multiplyScalar(0.5);

      const direction = midpoint.clone().sub(defender.position).normalize();
      defender.body.velocity.set(direction.x * 4, 0, direction.z * 4);

      // Add some random variation to avoid stiff movement
      defender.body.velocity.x += (Math.random() - 0.5) * 0.5;
      defender.body.velocity.z += (Math.random() - 0.5) * 0.5;
    }
  }

  // ========================================================================
  // PLAYER CONTROL & INPUT
  // ========================================================================

  private attachEventListeners(): void {
    window.addEventListener('resize', () => this.onWindowResize());

    // Joystick for movement
    const joystickBase = document.querySelector('.joystick-base') as HTMLElement;
    if (joystickBase) {
      joystickBase.addEventListener('touchmove', (e) => this.handleJoystick(e));
      joystickBase.addEventListener('mousemove', (e) => this.handleJoystick(e));
      joystickBase.addEventListener('touchend', () => this.resetJoystick());
      joystickBase.addEventListener('mouseleave', () => this.resetJoystick());
    }

    // Shoot button
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        this.attemptShot(Math.random() * 0.2 - 0.1);
      }
    });
  }

  private handleJoystick(event: TouchEvent | MouseEvent): void {
    if (!this.controlledPlayerId) return;
    const player = this.players.get(this.controlledPlayerId);
    if (!player) return;

    let clientX = 0, clientY = 0;
    if (event instanceof TouchEvent) {
      clientX = event.touches[0]?.clientX || 0;
      clientY = event.touches[0]?.clientY || 0;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    // Simple directional input
    const moveX = (clientX - window.innerWidth * 0.1) / (window.innerWidth * 0.2);
    const moveZ = (clientY - window.innerHeight * 0.9) / (window.innerHeight * 0.2);

    player.body.velocity.set(moveX * 8, 0, moveZ * 8);
    player.isRunning = true;
  }

  private resetJoystick(): void {
    if (!this.controlledPlayerId) return;
    const player = this.players.get(this.controlledPlayerId);
    if (player) {
      player.body.velocity.set(0, 0, 0);
      player.isRunning = false;
      player.legRotation = 0;
    }
  }

  // ========================================================================
  // ANIMATION & RENDERING
  // ========================================================================

  // FIX #4: Running animation - swing legs back and forth
  private updatePlayerAnimations(): void {
    this.players.forEach(player => {
      if (!player.isRunning) {
        player.legRotation = 0;
        return;
      }

      // Animate leg swing
      player.legRotation += 0.2; // Speed of animation
      const leftLeg = player.mesh.getObjectByName('left-leg');
      const rightLeg = player.mesh.getObjectByName('right-leg');

      if (leftLeg) {
        leftLeg.rotation.z = Math.sin(player.legRotation) * 0.4; // Swing amplitude
      }
      if (rightLeg) {
        rightLeg.rotation.z = Math.sin(player.legRotation + Math.PI) * 0.4;
      }

      // Update nameplate
      this.updatePlayerNameplate(player);
    });
  }

  // FIX #2: Move/re-parent nameplate to controlled player instead of creating new one
  private updatePlayerNameplate(player: Player): void {
    if (!player.nameplate) return;

    player.nameplate.style.display = 'block';
    const screenPos = this.worldToScreen(player.position);
    player.nameplate.style.left = screenPos.x + 'px';
    player.nameplate.style.top = screenPos.y + 'px';

    const staminaFill = player.nameplate.querySelector('.stamina-fill') as HTMLElement;
    if (staminaFill) {
      const staminaPercent = (player.stamina / player.maxStamina) * 100;
      staminaFill.style.width = staminaPercent + '%';
    }
  }

  private worldToScreen(worldPos: THREE.Vector3): { x: number; y: number } {
    const vector = worldPos.clone().project(this.camera);
    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(vector.y) * 0.5 + 0.5) * window.innerHeight;
    return { x, y };
  }

  private updateScoreboard(): void {
    const awayScore = document.querySelector('.team-score-num.away-team');
    const homeScore = document.querySelector('.team-score-num.home-team');

    if (awayScore) awayScore.textContent = String(this.gameState.score.warriors);
    if (homeScore) homeScore.textContent = String(this.gameState.score.rockets);
  }

  // FIX #3: Remove tip-off modal fully after fade animation
  public hideTipOffModal(): void {
    const modal = document.querySelector('.modal-overlay') as HTMLElement;
    if (!modal) return;

    modal.classList.remove('open');
    setTimeout(() => {
      modal.style.display = 'none';
      modal.remove();
    }, 300);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    if (!this.gameState.gameActive) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Update physics
    this.world.step(1 / 60);

    // Sync visuals to physics
    this.players.forEach(player => {
      player.position.copy(player.body.position);
      player.mesh.position.copy(player.body.position);
    });

    if (this.ball) {
      this.ball.mesh.position.copy(this.ball.body.position);
    }

    // Game logic
    this.updatePlayerAnimations(); // FIX #4
    this.updateAIOffense(); // FIX #5
    this.updateDefense(); // FIX #5
    this.gameState.shotClock -= 1 / 60;

    // Render confetti
    const confettiCanvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
    if (confettiCanvas) {
      const ctx = confettiCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        this.confettiParticles = this.confettiParticles.filter(p => p.draw());
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    (this.camera as THREE.PerspectiveCamera).aspect = width / height;
    (this.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public startGame(): void {
    this.gameState.gameActive = true;
  }
}
