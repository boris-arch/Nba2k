import * as THREE from 'three';

export interface PlayerData {
  id: string;
  name: string;
  number: string;
  team: 'GSW' | 'HOU';
  position: 'PG' | 'SG' | 'SF' | 'PF' | 'C';
  threePointRating: number;
  midRangeRating: number;
  speed: number;
}

export interface ShotResult {
  isGreen: boolean;
  points: number;
  quality: string;
  team: 'GSW' | 'HOU';
}

export class BasketballGame {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Game state
  private homeScore = 10;
  private awayScore = 8;
  private shotClock = 24.0;
  private gameClock = 720.0;
  private isGameOver = false;

  // Ball & Shooting
  private ball!: THREE.Mesh;
  private ballVelocity = new THREE.Vector3();
  private ballHolder: PlayerMesh | null = null;
  private isBallInFlight = false;
  private activeShot: {
    startPos: THREE.Vector3;
    targetHoop: THREE.Vector3;
    progress: number;
    duration: number;
    peakHeight: number;
    isGreen: boolean;
    points: number;
    shooterTeam: 'GSW' | 'HOU';
    willMake: boolean;
  } | null = null;

  // Teams & Players
  private players: PlayerMesh[] = [];
  private controlledPlayer!: PlayerMesh;

  // Single Nameplate instance (Fix for duplicate labels)
  private nameplateSprite!: THREE.Sprite;
  private nameplateCanvas!: HTMLCanvasElement;
  private nameplateContext!: CanvasRenderingContext2D;

  // Hoops
  private gswHoopPos = new THREE.Vector3(0, 3.05, -13.0); // Houston defends this
  private houHoopPos = new THREE.Vector3(0, 3.05, 13.0);  // GSW defends this

  // Visual FX
  private floatingTexts: { sprite: THREE.Sprite; lifetime: number; maxLife: number }[] = [];
  private confettiParticles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  // AI timers
  private aiDecisionTimer = 0;
  private aiPassTimer = 0;

  // Callbacks to UI
  public onScoreUpdate?: (home: number, away: number, points: number, team: string) => void;
  public onShotMeterUpdate?: (value: number, isOpen: boolean) => void;
  public onShotReleased?: (quality: string, isGreen: boolean) => void;
  public onShotClockUpdate?: (seconds: number) => void;

  // Keys
  private keys: { [key: string]: boolean } = {};
  private shotHoldTime = 0;
  private isChargingShot = false;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111622);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 16, 22);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Init components
    this.setupLighting();
    this.createCourt();
    this.createHoops();
    this.createBall();
    this.createSingleNameplate();
    this.spawnTeams();

    // Default possession: Curry has the ball
    this.ballHolder = this.controlledPlayer;

    // Listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Start loop
    this.animate(0);
  }

  // ----------------------------------------------------
  // COURT & ENVIRONMENT
  // ----------------------------------------------------
  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    dirLight.position.set(15, 30, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x88bbff, 0.4);
    rimLight.position.set(-15, 20, -15);
    this.scene.add(rimLight);
  }

  private createCourt() {
    // Floor
    const courtGeo = new THREE.PlaneGeometry(15.24, 28.65);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0xcca066,
      roughness: 0.35,
      metalness: 0.1,
    });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    this.scene.add(court);

    // Lines & Keys
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    
    // Half court line
    const halfLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-7.62, 0.01, 0),
      new THREE.Vector3(7.62, 0.01, 0)
    ]);
    this.scene.add(new THREE.Line(halfLineGeo, lineMat));

    // Center circle
    const circleGeo = new THREE.BufferGeometry().setFromPoints(
      new THREE.Path().absarc(0, 0, 1.8, 0, Math.PI * 2, true).getPoints(32).map(p => new THREE.Vector3(p.x, 0.01, p.y))
    );
    this.scene.add(new THREE.Line(circleGeo, lineMat));
  }

  private createHoops() {
    const createHoop = (zPos: number, isAway: boolean) => {
      const hoopGroup = new THREE.Group();
      hoopGroup.position.set(0, 0, zPos);
      if (isAway) hoopGroup.rotation.y = Math.PI;

      // Pole
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 1.9, 1.2);
      hoopGroup.add(pole);

      // Backboard
      const bbGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
      const bbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const bb = new THREE.Mesh(bbGeo, bbMat);
      bb.position.set(0, 3.3, 0.4);
      hoopGroup.add(bb);

      // Rim
      const rimGeo = new THREE.TorusGeometry(0.3, 0.02, 8, 24);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xe65100, roughness: 0.3 });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, 3.05, 0.05);
      hoopGroup.add(rim);

      this.scene.add(hoopGroup);
    };

    createHoop(-13.0, false); // GSW attacks this rim
    createHoop(13.0, true);   // HOU attacks this rim
  }

  private createBall() {
    const ballGeo = new THREE.SphereGeometry(0.24, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xdf5b12,
      roughness: 0.5,
    });
    this.ball = new THREE.Mesh(ballGeo, ballMat);
    this.ball.castShadow = true;
    this.ball.position.set(0, 1.2, 0);
    this.scene.add(this.ball);
  }

  // ----------------------------------------------------
  // (2) SINGLE NAMEPLATE (NO DUPLICATES)
  // ----------------------------------------------------
  private createSingleNameplate() {
    this.nameplateCanvas = document.createElement('canvas');
    this.nameplateCanvas.width = 256;
    this.nameplateCanvas.height = 64;
    this.nameplateContext = this.nameplateCanvas.getContext('2d')!;

    const texture = new THREE.CanvasTexture(this.nameplateCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.scale.set(2.2, 0.55, 1);
    this.nameplateSprite.renderOrder = 999;
    this.scene.add(this.nameplateSprite);
  }

  private updateControlledNameplate(player: PlayerMesh) {
    const ctx = this.nameplateContext;
    ctx.clearRect(0, 0, 256, 64);

    // Background pill
    ctx.fillStyle = player.data.team === 'GSW' ? 'rgba(0, 83, 188, 0.85)' : 'rgba(206, 17, 65, 0.85)';
    ctx.beginPath();
    ctx.roundRect(10, 8, 236, 48, 12);
    ctx.fill();

    // Border
    ctx.lineWidth = 3;
    ctx.strokeStyle = player.data.team === 'GSW' ? '#fdb927' : '#ffffff';
    ctx.stroke();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${player.data.name} #${player.data.number}`, 128, 32);

    (this.nameplateSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    this.nameplateSprite.visible = true;
  }

  // ----------------------------------------------------
  // PLAYER GENERATION (WITH SWINGING LEGS & ARMS)
  // ----------------------------------------------------
  private createPlayerMesh(data: PlayerData): PlayerMesh {
    const group = new THREE.Group() as unknown as PlayerMesh;
    group.data = data;
    group.runCycle = Math.random() * Math.PI;

    const jerseyColor = data.team === 'GSW' ? 0x0053bc : 0xce1141;
    const skinColor = 0xc68642;

    // Torso / Jersey
    const torsoGeo = new THREE.BoxGeometry(0.65, 0.85, 0.35);
    const torsoMat = new THREE.MeshStandardMaterial({ color: jerseyColor });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.35;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.0;
    head.castShadow = true;
    group.add(head);

    // Legs with Hip Pivots for Running Animation
    const legGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.85, 12);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.2, 0.9, 0);
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.y = -0.42;
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.2, 0.9, 0);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.y = -0.42;
    rightLeg.castShadow = true;
    rightLegPivot.add(rightLeg);
    group.add(rightLegPivot);

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.7, 12);
    const armMat = new THREE.MeshStandardMaterial({ color: skinColor });

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.42, 1.7, 0);
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.y = -0.35;
    leftArmPivot.add(leftArm);
    group.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.42, 1.7, 0);
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.y = -0.35;
    rightArmPivot.add(rightArm);
    group.add(rightArmPivot);

    // Save limbs for animation
    group.leftLegPivot = leftLegPivot;
    group.rightLegPivot = rightLegPivot;
    group.leftArmPivot = leftArmPivot;
    group.rightArmPivot = rightArmPivot;
    group.lastPos = group.position.clone();

    this.scene.add(group as unknown as THREE.Object3D);
    return group;
  }

  private spawnTeams() {
    const gswRoster: PlayerData[] = [
      { id: 'curry', name: 'S. CURRY', number: '30', team: 'GSW', position: 'PG', threePointRating: 99, midRangeRating: 96, speed: 4.8 },
      { id: 'thompson', name: 'K. THOMPSON', number: '11', team: 'GSW', position: 'SG', threePointRating: 92, midRangeRating: 90, speed: 4.4 },
      { id: 'wiggins', name: 'A. WIGGINS', number: '22', team: 'GSW', position: 'SF', threePointRating: 84, midRangeRating: 85, speed: 4.6 },
      { id: 'green', name: 'D. GREEN', number: '23', team: 'GSW', position: 'PF', threePointRating: 75, midRangeRating: 78, speed: 4.2 },
      { id: 'looney', name: 'K. LOONEY', number: '5', team: 'GSW', position: 'C', threePointRating: 60, midRangeRating: 72, speed: 3.8 },
    ];

    const houRoster: PlayerData[] = [
      { id: 'vanvleet', name: 'F. VANVLEET', number: '5', team: 'HOU', position: 'PG', threePointRating: 88, midRangeRating: 86, speed: 4.5 },
      { id: 'green_j', name: 'J. GREEN', number: '4', team: 'HOU', position: 'SG', threePointRating: 85, midRangeRating: 84, speed: 4.9 },
      { id: 'brooks', name: 'D. BROOKS', number: '9', team: 'HOU', position: 'SF', threePointRating: 82, midRangeRating: 81, speed: 4.4 },
      { id: 'smith', name: 'J. SMITH JR.', number: '10', team: 'HOU', position: 'PF', threePointRating: 84, midRangeRating: 82, speed: 4.3 },
      { id: 'sengun', name: 'A. SENGUN', number: '28', team: 'HOU', position: 'C', threePointRating: 70, midRangeRating: 85, speed: 3.9 },
    ];

    // Spawn GSW
    const gswStarts = [
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(-4.5, 0, -3),
      new THREE.Vector3(4.5, 0, -3),
      new THREE.Vector3(-2.5, 0, -7),
      new THREE.Vector3(2.5, 0, -8),
    ];
    gswRoster.forEach((data, i) => {
      const p = this.createPlayerMesh(data);
      p.position.copy(gswStarts[i]);
      this.players.push(p);
    });

    // Spawn HOU
    const houStarts = [
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-4.0, 0, -4.5),
      new THREE.Vector3(4.0, 0, -4.5),
      new THREE.Vector3(-2.2, 0, -8),
      new THREE.Vector3(2.2, 0, -9),
    ];
    houRoster.forEach((data, i) => {
      const p = this.createPlayerMesh(data);
      p.position.copy(houStarts[i]);
      this.players.push(p);
    });

    this.controlledPlayer = this.players[0]; // Curry
    this.updateControlledNameplate(this.controlledPlayer);
  }

  // ----------------------------------------------------
  // INPUT & CONTROLS
  // ----------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = true;

    // Shot meter charge
    if (e.key === ' ' && this.ballHolder === this.controlledPlayer && !this.isBallInFlight) {
      if (!this.isChargingShot) {
        this.isChargingShot = true;
        this.shotHoldTime = 0;
      }
    }

    // Pass
    if ((e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'e') && this.ballHolder === this.controlledPlayer) {
      this.passToBestTeammate(this.controlledPlayer);
    }

    // Switch controlled player on defense or when off-ball
    if (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'q') {
      this.cycleControlledPlayer();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;

    // Release shot
    if (e.key === ' ' && this.isChargingShot) {
      this.isChargingShot = false;
      this.releaseShot(this.controlledPlayer, this.shotHoldTime);
    }
  };

  private cycleControlledPlayer() {
    const teammates = this.players.filter(p => p.data.team === 'GSW' && p !== this.controlledPlayer);
    if (teammates.length > 0) {
      this.controlledPlayer = teammates[0];
      this.updateControlledNameplate(this.controlledPlayer);
    }
  }

  // ----------------------------------------------------
  // (1) SHOOTING & 100% GREEN RELEASE LOGIC
  // ----------------------------------------------------
  private releaseShot(shooter: PlayerMesh, holdDuration: number) {
    if (this.ballHolder !== shooter) return;

    this.ballHolder = null;
    this.isBallInFlight = true;

    // Target rim
    const targetHoop = shooter.data.team === 'GSW' ? this.gswHoopPos : this.houHoopPos;
    const distToHoop = new THREE.Vector2(shooter.position.x - targetHoop.x, shooter.position.z - targetHoop.z).length();
    const isThree = distToHoop > 7.0;
    const points = isThree ? 3 : 2;

    // Timing evaluation (ideal release is ~0.65s)
    const ideal = 0.65;
    const diff = Math.abs(holdDuration - ideal);
    const isGreen = diff < 0.05; // Perfect release

    let quality = 'LATE';
    if (isGreen) {
      quality = 'GREEN RELEASE! PERFECT';
    } else if (diff < 0.14) {
      quality = 'SLIGHTLY EARLY / LATE';
    } else {
      quality = holdDuration < ideal ? 'VERY EARLY' : 'VERY LATE';
    }

    // Contest check
    const nearestOpponent = this.getNearestDefender(shooter);
    const defenderDist = nearestOpponent ? nearestOpponent.position.distanceTo(shooter.position) : 99;
    const isContested = defenderDist < 2.0;

    // (1) CRITICAL FIX: Green Release MUST be 100% make probability
    let willMake = false;
    if (isGreen) {
      willMake = true; // 100% ALWAYS GOES IN
    } else {
      const baseRating = isThree ? shooter.data.threePointRating : shooter.data.midRangeRating;
      let makeProb = (baseRating / 100) * 0.75 - diff * 2.0;
      if (isContested) makeProb -= 0.35;
      willMake = Math.random() < Math.max(0.08, makeProb);
    }

    // Visual / UI callback
    if (shooter === this.controlledPlayer) {
      this.onShotReleased?.(quality, isGreen);
    }

    // Arc trajectory
    this.activeShot = {
      startPos: this.ball.position.clone(),
      targetHoop: targetHoop.clone(),
      progress: 0,
      duration: 1.15,
      peakHeight: Math.max(5.2, targetHoop.y + 2.5),
      isGreen,
      points,
      shooterTeam: shooter.data.team,
      willMake,
    };
  }

  // ----------------------------------------------------
  // (1) FLOATING TEXT POPUP (+2 / +3) & CONFETTI
  // ----------------------------------------------------
  private spawnFloatingScore(points: number, hoopPos: THREE.Vector3) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffeb3b';
    ctx.font = 'bold 44px Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(`+${points}`, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.6, 0.8, 1);
    sprite.position.set(hoopPos.x, hoopPos.y + 1.2, hoopPos.z);
    this.scene.add(sprite);

    this.floatingTexts.push({ sprite, lifetime: 0, maxLife: 1.2 });
  }

  private spawnGreenConfetti(pos: THREE.Vector3) {
    const colors = [0x00ff66, 0x39ff14, 0xffeb3b, 0xffffff];
    for (let i = 0; i < 35; i++) {
      const geo = new THREE.PlaneGeometry(0.12, 0.12);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        Math.random() * 4.0 + 2.0,
        (Math.random() - 0.5) * 4.5
      );
      this.scene.add(mesh);
      this.confettiParticles.push({ mesh, vel, life: 1.0 });
    }
  }

  // ----------------------------------------------------
  // (5) ACTIVE AI OFFENSE & MAN-TO-MAN DEFENSE
  // ----------------------------------------------------
  private updateHoustonAI(dt: number) {
    const houPlayers = this.players.filter(p => p.data.team === 'HOU');
    const gswPlayers = this.players.filter(p => p.data.team === 'GSW');
    const isHouOffense = this.ballHolder && this.ballHolder.data.team === 'HOU';

    this.aiDecisionTimer += dt;
    this.aiPassTimer += dt;

    if (isHouOffense && this.ballHolder) {
      const carrier = this.ballHolder;
      const targetRim = this.houHoopPos;

      // 1. Dribble toward scoring range
      const toRim = new THREE.Vector3().subVectors(targetRim, carrier.position);
      toRim.y = 0;
      const distToRim = toRim.length();

      if (distToRim > 5.5) {
        toRim.normalize();
        carrier.position.addScaledVector(toRim, carrier.data.speed * 0.75 * dt);
        carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
      }

      // Check contest
      const defender = this.getNearestDefender(carrier);
      const defDist = defender ? defender.position.distanceTo(carrier.position) : 99;

      // 2. Pass between teammates if contested or possession flows
      if (this.aiPassTimer > 3.0 || (defDist < 1.8 && this.aiDecisionTimer > 1.2)) {
        this.aiPassTimer = 0;
        this.passToBestTeammate(carrier);
      }

      // 3. Attempt shots within shot clock or when in sweet spot
      const inGoodRange = distToRim <= 6.5;
      const openShot = defDist > 2.3 && inGoodRange;
      const clockExpiring = this.shotClock < 3.5;

      if ((openShot || clockExpiring || (inGoodRange && this.aiDecisionTimer > 4.5)) && !this.isBallInFlight) {
        this.aiDecisionTimer = 0;
        // AI executes a timed release
        const simHold = 0.65 + (Math.random() - 0.5) * 0.12;
        this.releaseShot(carrier, simHold);
      }
    }

    // (5) Defenders stay between their man and the basket
    this.players.forEach(p => {
      if (p === this.ballHolder) return;

      const isDefense = this.ballHolder ? p.data.team !== this.ballHolder.data.team : p.data.team === 'HOU';
      if (isDefense) {
        // Find assigned offensive matchup
        const opponents = p.data.team === 'HOU' ? gswPlayers : houPlayers;
        const myMatchup = opponents.find(opp => opp.data.position === p.data.position) || opponents[0];
        const rimToDefend = p.data.team === 'HOU' ? this.gswHoopPos : this.houHoopPos;

        // Position strictly between matchup and basket
        const dirToHoop = new THREE.Vector3().subVectors(rimToDefend, myMatchup.position).normalize();
        const idealGuardPos = myMatchup.position.clone().addScaledVector(dirToHoop, 1.8);

        const moveDir = new THREE.Vector3().subVectors(idealGuardPos, p.position);
        moveDir.y = 0;
        if (moveDir.length() > 0.2) {
          moveDir.normalize();
          p.position.addScaledVector(moveDir, p.data.speed * 0.8 * dt);
          p.lookAt(myMatchup.position.x, p.position.y, myMatchup.position.z);
        }
      }
    });
  }

  private passToBestTeammate(passer: PlayerMesh) {
    const teammates = this.players.filter(p => p.data.team === passer.data.team && p !== passer);
    if (teammates.length === 0) return;

    // Pick open teammate
    let best = teammates[0];
    let maxDistToOpp = -1;

    teammates.forEach(tm => {
      const opp = this.getNearestDefender(tm);
      const d = opp ? opp.position.distanceTo(tm.position) : 99;
      if (d > maxDistToOpp) {
        maxDistToOpp = d;
        best = tm;
      }
    });

    this.ballHolder = best;
    if (passer.data.team === 'GSW') {
      this.controlledPlayer = best;
      this.updateControlledNameplate(this.controlledPlayer);
    }
  }

  private getNearestDefender(player: PlayerMesh): PlayerMesh | null {
    const opponents = this.players.filter(p => p.data.team !== player.data.team);
    let nearest: PlayerMesh | null = null;
    let minDist = 999;
    opponents.forEach(opp => {
      const d = opp.position.distanceTo(player.position);
      if (d < minDist) {
        minDist = d;
        nearest = opp;
      }
    });
    return nearest;
  }

  // ----------------------------------------------------
  // (4) RUNNING ANIMATION & GAME LOOP
  // ----------------------------------------------------
  private updatePlayerMovement(dt: number) {
    // User movement
    if (this.controlledPlayer) {
      const move = new THREE.Vector3();
      if (this.keys['w'] || this.keys['arrowup']) move.z -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) move.z += 1;
      if (this.keys['a'] || this.keys['arrowleft']) move.x -= 1;
      if (this.keys['d'] || this.keys['arrowright']) move.x += 1;

      if (move.lengthSq() > 0) {
        move.normalize();
        this.controlledPlayer.position.addScaledVector(move, this.controlledPlayer.data.speed * dt);
        this.controlledPlayer.lookAt(
          this.controlledPlayer.position.x + move.x,
          this.controlledPlayer.position.y,
          this.controlledPlayer.position.z + move.z
        );
      }
    }

    // Swing player legs back and forth when moving
    this.players.forEach(p => {
      const vel = new THREE.Vector3().subVectors(p.position, p.lastPos);
      vel.y = 0;
      const speed = vel.length() / Math.max(dt, 0.001);

      if (speed > 0.25) {
        p.runCycle += dt * speed * 4.5;
        const swing = Math.sin(p.runCycle) * 0.65;
        p.leftLegPivot.rotation.x = swing;
        p.rightLegPivot.rotation.x = -swing;
        p.leftArmPivot.rotation.x = -swing * 0.75;
        p.rightArmPivot.rotation.x = swing * 0.75;
      } else {
        // Return smoothly to idle stance
        p.leftLegPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.rightLegPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.leftArmPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.rightArmPivot.rotation.x *= Math.max(0, 1 - dt * 10);
      }

      p.lastPos.copy(p.position);
    });

    // Update single active nameplate position
    if (this.controlledPlayer && this.nameplateSprite) {
      this.nameplateSprite.position.set(
        this.controlledPlayer.position.x,
        this.controlledPlayer.position.y + 2.55,
        this.controlledPlayer.position.z
      );
    }
  }

  private updateShotPhysics(dt: number) {
    if (!this.isBallInFlight || !this.activeShot) {
      if (this.ballHolder) {
        // Dribble bounce
        const t = performance.now() * 0.008;
        const bounce = Math.abs(Math.sin(t)) * 0.45;
        const offset = new THREE.Vector3(0.35, 0.6 + bounce, 0.25);
        this.ball.position.copy(this.ballHolder.position).add(offset);
      }
      return;
    }

    const shot = this.activeShot;
    shot.progress += dt / shot.duration;

    if (shot.progress < 1.0) {
      // Parabolic arc toward rim
      const currentPos = new THREE.Vector3().lerpVectors(shot.startPos, shot.targetHoop, shot.progress);
      const arc = Math.sin(shot.progress * Math.PI) * (shot.peakHeight - shot.startPos.y);
      currentPos.y += arc;
      this.ball.position.copy(currentPos);
    } else {
      // Shot arrives at basket
      this.isBallInFlight = false;
      this.activeShot = null;

      if (shot.willMake) {
        // (1) MAKE BASKET -> Update Score & trigger floating popup
        if (shot.shooterTeam === 'GSW') {
          this.homeScore += shot.points;
        } else {
          this.awayScore += shot.points;
        }

        // Scoreboard callback guaranteed
        this.onScoreUpdate?.(this.homeScore, this.awayScore, shot.points, shot.shooterTeam);

        // Floating popup near hoop
        this.spawnFloatingScore(shot.points, shot.targetHoop);

        // (1) Confetti burst ONLY for green releases
        if (shot.isGreen) {
          this.spawnGreenConfetti(shot.targetHoop);
        }

        // Inbound / switch ball possession
        this.resetPossessionAfterScore(shot.shooterTeam === 'GSW' ? 'HOU' : 'GSW');
      } else {
        // Missed shot rebound
        this.ballVelocity.set((Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3);
        this.resetPossessionAfterScore('HOU');
      }

      this.shotClock = 24.0;
    }
  }

  private resetPossessionAfterScore(nextTeam: 'GSW' | 'HOU') {
    const nextHolder = this.players.find(p => p.data.team === nextTeam);
    if (nextHolder) {
      this.ballHolder = nextHolder;
      if (nextTeam === 'GSW') {
        this.controlledPlayer = nextHolder;
        this.updateControlledNameplate(this.controlledPlayer);
      }
    }
  }

  private updateVFX(dt: number) {
    // Floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.lifetime += dt;
      ft.sprite.position.y += dt * 1.5;
      const mat = ft.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0, 1 - ft.lifetime / ft.maxLife);

      if (ft.lifetime >= ft.maxLife) {
        this.scene.remove(ft.sprite);
        this.floatingTexts.splice(i, 1);
      }
    }

    // Confetti particles
    for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
      const c = this.confettiParticles[i];
      c.life -= dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.vel.y -= 9.8 * dt; // gravity
      c.mesh.rotation.x += dt * 5;
      c.mesh.rotation.y += dt * 7;

      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.confettiParticles.splice(i, 1);
      }
    }
  }

  private animate = (timestamp: number) => {
    requestAnimationFrame(this.animate);
    const dt = 0.016; // 60 FPS

    if (!this.isGameOver) {
      // Clocks
      this.shotClock = Math.max(0, this.shotClock - dt);
      this.gameClock = Math.max(0, this.gameClock - dt);
      this.onShotClockUpdate?.(Math.ceil(this.shotClock));

      // Charge meter
      if (this.isChargingShot) {
        this.shotHoldTime += dt;
        this.onShotMeterUpdate?.(Math.min(1.0, this.shotHoldTime / 0.65), true);
      } else {
        this.onShotMeterUpdate?.(0, false);
      }

      this.updatePlayerMovement(dt);
      this.updateHoustonAI(dt);
      this.updateShotPhysics(dt);
      this.updateVFX(dt);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  public destroy() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.dispose();
  }
}

// Player Mesh Interface Extension
interface PlayerMesh extends THREE.Group {
  data: PlayerData;
  runCycle: number;
  lastPos: THREE.Vector3;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
}
