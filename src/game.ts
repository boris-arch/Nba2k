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

export type BallState = 'DRIBBLE' | 'SHOT' | 'REBOUND' | 'PASS' | 'BOUNCE_PASS' | 'MADE_DROP';

export class BasketballGame {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Real-world scale parameters (Meters)
  private readonly GRAVITY = -18.5; // Tuned for authentic ~1s high-arc medium/3pt shots
  private readonly RIM_HEIGHT = 3.05; // 10 feet
  private readonly RIM_RADIUS = 0.23; // ~0.75 ft
  private readonly RIM_TUBE_RADIUS = 0.018; // Thin tube
  private readonly BALL_RADIUS = 0.12; // ~0.39 ft
  private readonly COURT_WIDTH = 15.24;
  private readonly COURT_LENGTH = 28.65;

  // Game Score & Clocks
  private homeScore = 10;
  private awayScore = 8;
  private shotClock = 24.0;
  private gameClock = 720.0;
  private isGameOver = false;

  // Ball physics state (Continuous integration, never teleports)
  private ball!: THREE.Mesh;
  private ballPos = new THREE.Vector3(0, 0.95, 0);
  private ballPrevPos = new THREE.Vector3(0, 0.95, 0);
  private ballVel = new THREE.Vector3(0, 0, 0);
  private ballState: BallState = 'DRIBBLE';
  private floorBounceCount = 0;
  private isBallRolling = false;

  // Anti-stuck & Rim rattle tracking
  private rimNearTimer = 0;
  private rimBounceCount = 0;

  // Possession & Pass Tracking
  private ballHolder: PlayerMesh | null = null;
  private passTargetPlayer: PlayerMesh | null = null;
  private passReceiverPosLead = new THREE.Vector3();
  private postScoreTimer = 0;
  private nextPossessionTeam: 'GSW' | 'HOU' | null = null;

  // Active Shot Metadata & Pre-roll
  private activeShot: {
    isGreen: boolean;
    willMake: boolean;
    points: number;
    shooterTeam: 'GSW' | 'HOU';
    hoopPos: THREE.Vector3;
    backboardZ: number;
    hasScored: boolean;
    rattlePhase: number;
  } | null = null;

  // Hoops & Nets
  // GSW attacks negative Z (Hoop at -13.0, Backboard at -13.38)
  // HOU attacks positive Z (Hoop at +13.0, Backboard at +13.38)
  private gswHoopPos = new THREE.Vector3(0, 3.05, -13.0);
  private houHoopPos = new THREE.Vector3(0, 3.05, 13.0);
  private gswNetMesh!: THREE.Mesh;
  private houNetMesh!: THREE.Mesh;
  private gswNetWobble = 0;
  private houNetWobble = 0;

  // Teams & Players
  private players: PlayerMesh[] = [];
  private controlledPlayer!: PlayerMesh;

  // Single Global Nameplate (No duplicates)
  private nameplateSprite!: THREE.Sprite;
  private nameplateCanvas!: HTMLCanvasElement;
  private nameplateContext!: CanvasRenderingContext2D;

  // Visual Effects
  private floatingTexts: { sprite: THREE.Sprite; lifetime: number; maxLife: number }[] = [];
  private confettiParticles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  // Dribbling & AI Timers
  private dribbleCycle = 0;
  private aiDecisionTimer = 0;
  private aiPassTimer = 0;

  // Controls & Meter
  private keys: { [key: string]: boolean } = {};
  private shotHoldTime = 0;
  private isChargingShot = false;

  // Callbacks
  public onScoreUpdate?: (home: number, away: number, points: number, team: string) => void;
  public onShotMeterUpdate?: (value: number, isOpen: boolean) => void;
  public onShotReleased?: (quality: string, isGreen: boolean) => void;
  public onShotClockUpdate?: (seconds: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene & Camera setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e131d);

    this.camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 16.5, 22.5);
    this.camera.lookAt(0, 0, 0);

    // 2. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 3. World Setup
    this.setupLighting();
    this.createCourt();
    this.createHoopsAndNets();
    this.createBall();
    this.createSingleNameplate();
    this.spawnTeams();

    // Default possession: Curry has the ball
    this.ballHolder = this.controlledPlayer;
    this.ballState = 'DRIBBLE';

    // 4. Input Listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // 5. Main Loop
    this.animate(0);
  }

  // --------------------------------------------------------------------------
  // COURT, HOOPS, & LIGHTING
  // --------------------------------------------------------------------------
  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.3);
    dirLight.position.set(16, 32, 16);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -18;
    dirLight.shadow.camera.right = 18;
    dirLight.shadow.camera.top = 18;
    dirLight.shadow.camera.bottom = -18;
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x7fb2ff, 0.35);
    rimLight.position.set(-16, 20, -16);
    this.scene.add(rimLight);
  }

  private createCourt() {
    const courtGeo = new THREE.PlaneGeometry(this.COURT_WIDTH, this.COURT_LENGTH);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0xc8965a,
      roughness: 0.36,
      metalness: 0.08,
    });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    this.scene.add(court);

    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });

    // Half court line
    const halfLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-7.62, 0.01, 0),
      new THREE.Vector3(7.62, 0.01, 0),
    ]);
    this.scene.add(new THREE.Line(halfLineGeo, lineMat));

    // Center circle
    const circlePoints = new THREE.Path().absarc(0, 0, 1.8, 0, Math.PI * 2, true).getPoints(36);
    const circleGeo = new THREE.BufferGeometry().setFromPoints(
      circlePoints.map(p => new THREE.Vector3(p.x, 0.01, p.y))
    );
    this.scene.add(new THREE.Line(circleGeo, lineMat));

    // 3-point arcs
    [-13.0, 13.0].forEach(zCenter => {
      const isPositive = zCenter > 0;
      const arcPoints = new THREE.Path().absarc(0, 0, 6.75, 0, Math.PI, isPositive).getPoints(36);
      const threePtGeo = new THREE.BufferGeometry().setFromPoints(
        arcPoints.map(p => new THREE.Vector3(p.x, 0.01, zCenter + (isPositive ? -p.y : p.y)))
      );
      this.scene.add(new THREE.Line(threePtGeo, lineMat));
    });
  }

  private createHoopsAndNets() {
    const buildHoop = (zPos: number, isHoustonHoop: boolean) => {
      const hoopGroup = new THREE.Group();
      const bbZRel = isHoustonHoop ? 0.38 : -0.38;
      const poleZRel = isHoustonHoop ? 1.15 : -1.15;

      // Pole
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e2430 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 1.9, zPos + poleZRel);
      this.scene.add(pole);

      // Backboard (1.8m x 1.05m at bbZ)
      const bbGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
      const bbMat = new THREE.MeshStandardMaterial({
        color: 0xf3f6fa,
        roughness: 0.15,
        metalness: 0.1,
      });
      const bb = new THREE.Mesh(bbGeo, bbMat);
      bb.position.set(0, 3.3, zPos + bbZRel);
      bb.castShadow = true;
      this.scene.add(bb);

      // Inner Target Box on Backboard
      const boxZ = zPos + bbZRel + (isHoustonHoop ? -0.027 : 0.027);
      const targetBoxGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.29, 3.1, boxZ),
        new THREE.Vector3(0.29, 3.1, boxZ),
        new THREE.Vector3(0.29, 3.55, boxZ),
        new THREE.Vector3(-0.29, 3.55, boxZ),
        new THREE.Vector3(-0.29, 3.1, boxZ),
      ]);
      const targetBox = new THREE.Line(
        targetBoxGeo,
        new THREE.LineBasicMaterial({ color: 0xce1141, linewidth: 2 })
      );
      this.scene.add(targetBox);

      // Torus Rim (Ring at rim height, radius 0.23m with thin tube 0.018m)
      const rimGeo = new THREE.TorusGeometry(this.RIM_RADIUS, this.RIM_TUBE_RADIUS, 12, 32);
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0xee4b2b,
        roughness: 0.3,
        metalness: 0.2,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, this.RIM_HEIGHT, zPos);
      rim.castShadow = true;
      this.scene.add(rim);

      // Net Mesh
      const netGeo = new THREE.CylinderGeometry(
        this.RIM_RADIUS * 0.95,
        this.RIM_RADIUS * 0.58,
        0.48,
        16,
        3,
        true
      );
      const netMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        wireframe: true,
        roughness: 0.8,
        transparent: true,
        opacity: 0.85,
      });
      const net = new THREE.Mesh(netGeo, netMat);
      net.position.set(0, this.RIM_HEIGHT - 0.24, zPos);
      this.scene.add(net);

      return net;
    };

    this.gswNetMesh = buildHoop(-13.0, false);
    this.houNetMesh = buildHoop(13.0, true);
  }

  // --------------------------------------------------------------------------
  // BALL CREATION
  // --------------------------------------------------------------------------
  private createBall() {
    const ballGeo = new THREE.SphereGeometry(this.BALL_RADIUS, 28, 28);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#df5b12';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#181818';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 256, 128);
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(256, 64);
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 128);
    ctx.stroke();

    const ballTex = new THREE.CanvasTexture(canvas);
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      roughness: 0.48,
      metalness: 0.05,
    });
    this.ball = new THREE.Mesh(ballGeo, ballMat);
    this.ball.castShadow = true;
    this.ball.position.copy(this.ballPos);
    this.ballPrevPos.copy(this.ballPos);
    this.scene.add(this.ball);
  }

  // --------------------------------------------------------------------------
  // SINGLE NAMEPLATE (NO DUPLICATE OVERLAYS)
  // --------------------------------------------------------------------------
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

    ctx.fillStyle =
      player.data.team === 'GSW' ? 'rgba(0, 83, 188, 0.88)' : 'rgba(206, 17, 65, 0.88)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 12);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = player.data.team === 'GSW' ? '#fdb927' : '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${player.data.name} #${player.data.number}`, 128, 32);

    (this.nameplateSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    this.nameplateSprite.visible = true;
  }

  // --------------------------------------------------------------------------
  // TEAMS & PLAYER SETUP
  // --------------------------------------------------------------------------
  private createPlayerMesh(data: PlayerData): PlayerMesh {
    const group = new THREE.Group() as unknown as PlayerMesh;
    group.data = data;
    group.runCycle = Math.random() * Math.PI;

    const jerseyColor = data.team === 'GSW' ? 0x0053bc : 0xce1141;
    const skinColor = 0xc68642;

    // Torso
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

    // Legs with Hip Pivots (Running animation)
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

  // --------------------------------------------------------------------------
  // CONTROLS & INPUT
  // --------------------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = true;

    if (e.key === ' ' && this.ballHolder === this.controlledPlayer && this.ballState === 'DRIBBLE') {
      if (!this.isChargingShot) {
        this.isChargingShot = true;
        this.shotHoldTime = 0;
      }
    }

    if ((e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'e') && this.ballHolder === this.controlledPlayer) {
      this.initiatePass(this.controlledPlayer);
    }

    if (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'q') {
      this.cycleControlledPlayer();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.key.toLowerCase()] = false;

    if (e.key === ' ' && this.isChargingShot) {
      this.isChargingShot = false;
      this.executeShot(this.controlledPlayer, this.shotHoldTime);
    }
  };

  private cycleControlledPlayer() {
    const teammates = this.players.filter(p => p.data.team === 'GSW' && p !== this.controlledPlayer);
    if (teammates.length > 0) {
      this.controlledPlayer = teammates[0];
      this.updateControlledNameplate(this.controlledPlayer);
    }
  }

  // --------------------------------------------------------------------------
  // (3) SHOT TRAJECTORIES, PRE-ROLL & BALLISTIC INTEGRATION
  // --------------------------------------------------------------------------
  private executeShot(shooter: PlayerMesh, holdDuration: number) {
    if (this.ballHolder !== shooter) return;

    this.ballHolder = null;
    this.ballState = 'SHOT';
    this.floorBounceCount = 0;
    this.isBallRolling = false;
    this.rimNearTimer = 0;
    this.rimBounceCount = 0;

    const isGSW = shooter.data.team === 'GSW';
    const targetHoop = isGSW ? this.gswHoopPos : this.houHoopPos;
    const backboardZ = isGSW ? -13.38 : 13.38;

    const distToHoop = new THREE.Vector2(
      targetHoop.x - shooter.position.x,
      targetHoop.z - shooter.position.z
    ).length();
    const isThree = distToHoop > 6.75;
    const points = isThree ? 3 : 2;

    // Shot timing evaluation (Ideal: 0.65s)
    const ideal = 0.65;
    const diff = Math.abs(holdDuration - ideal);
    const isGreen = diff < 0.05; // Perfect green release

    const defender = this.getNearestDefender(shooter);
    const defDist = defender ? defender.position.distanceTo(shooter.position) : 99;
    const isContested = defDist < 1.8;

    // Pre-roll shot outcome based on rating & contest
    let willMake = false;
    let quality = 'LATE';

    if (isGreen) {
      willMake = true; // 100% Guaranteed Make, clean swish, no rim contact
      quality = 'GREEN RELEASE! PERFECT';
    } else {
      const baseRating = isThree ? shooter.data.threePointRating : shooter.data.midRangeRating;
      let makeChance = (baseRating / 100) * 0.82 - diff * 2.2;
      if (isContested) makeChance -= 0.35;
      makeChance = THREE.MathUtils.clamp(makeChance, 0.06, 0.88);
      willMake = Math.random() < makeChance;

      if (diff < 0.12) {
        quality = holdDuration < ideal ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE';
      } else {
        quality = holdDuration < ideal ? 'VERY EARLY' : 'VERY LATE';
      }
    }

    if (shooter === this.controlledPlayer) {
      this.onShotReleased?.(quality, isGreen);
    }

    // Determine initial target coordinates for launch physics
    const shotDir = new THREE.Vector3(
      targetHoop.x - shooter.position.x,
      0,
      targetHoop.z - shooter.position.z
    ).normalize();
    const sideDir = new THREE.Vector3(-shotDir.z, 0, shotDir.x);

    const targetPoint = targetHoop.clone();

    if (isGreen) {
      // Swish directly through center
      targetPoint.set(targetHoop.x, this.RIM_HEIGHT, targetHoop.z);
    } else if (willMake) {
      // Rattle-in: aim slightly off-center (clips the rim or backboard)
      if (Math.random() < 0.28 && !isThree) {
        // Bank shot make: target backboard inner square first
        targetPoint.set(
          targetHoop.x + (Math.random() - 0.5) * 0.12,
          this.RIM_HEIGHT + 0.32,
          backboardZ + (isGSW ? 0.08 : -0.08)
        );
      } else {
        // Clip front or back rim slightly
        const rimOffset = (Math.random() > 0.5 ? 1 : -1) * (this.RIM_RADIUS * 0.82);
        targetPoint.addScaledVector(shotDir, rimOffset);
        targetPoint.addScaledVector(sideDir, (Math.random() - 0.5) * 0.06);
      }
    } else {
      // Miss: scaled to timing error and contest
      if (isContested) {
        // Clank off side rim
        const sideOffset = (Math.random() > 0.5 ? 1 : -1) * (this.RIM_RADIUS * 0.98);
        targetPoint.addScaledVector(sideDir, sideOffset);
        targetPoint.addScaledVector(shotDir, -this.RIM_RADIUS * 0.4);
      } else if (holdDuration < ideal) {
        // Slightly early: short miss off front rim
        targetPoint.addScaledVector(shotDir, -this.RIM_RADIUS * 1.05);
      } else {
        // Slightly late: long miss off back rim or hard off backboard
        if (Math.random() < 0.4) {
          targetPoint.set(
            targetHoop.x + (Math.random() - 0.5) * 0.25,
            this.RIM_HEIGHT + 0.25,
            backboardZ + (isGSW ? 0.05 : -0.05)
          );
        } else {
          targetPoint.addScaledVector(shotDir, this.RIM_RADIUS * 1.05);
        }
      }
    }

    // Set launch point from shooter's hands (y = 2.05m)
    this.ballPos.set(shooter.position.x, 2.05, shooter.position.z).addScaledVector(shotDir, 0.28);
    this.ballPrevPos.copy(this.ballPos);
    this.ball.position.copy(this.ballPos);

    // Calculate exact ballistic flight trajectory
    const flightDuration = THREE.MathUtils.clamp(0.88 + distToHoop * 0.035, 0.95, 1.18);
    this.ballVel.x = (targetPoint.x - this.ballPos.x) / flightDuration;
    this.ballVel.z = (targetPoint.z - this.ballPos.z) / flightDuration;
    const deltaY = targetPoint.y - this.ballPos.y;
    this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * flightDuration * flightDuration) / flightDuration;

    this.activeShot = {
      isGreen,
      willMake,
      points,
      shooterTeam: shooter.data.team,
      hoopPos: targetHoop.clone(),
      backboardZ,
      hasScored: false,
      rattlePhase: 0,
    };
  }

  // --------------------------------------------------------------------------
  // (7) PASSES & BOUNCE-PASS VARIANT
  // --------------------------------------------------------------------------
  private initiatePass(passer: PlayerMesh) {
    const teammates = this.players.filter(p => p.data.team === passer.data.team && p !== passer);
    if (teammates.length === 0) return;

    let receiver = teammates[0];
    let maxDistToOpp = -1;
    teammates.forEach(tm => {
      const opp = this.getNearestDefender(tm);
      const d = opp ? opp.position.distanceTo(tm.position) : 99;
      if (d > maxDistToOpp) {
        maxDistToOpp = d;
        receiver = tm;
      }
    });

    this.ballHolder = null;
    this.passTargetPlayer = receiver;
    this.floorBounceCount = 0;
    this.isBallRolling = false;
    this.activeShot = null;

    const passDist = passer.position.distanceTo(receiver.position);
    const passTime = THREE.MathUtils.clamp(0.38 + passDist * 0.032, 0.42, 0.65);

    const recvVel = new THREE.Vector3().subVectors(receiver.position, receiver.lastPos).multiplyScalar(60);
    this.passReceiverPosLead.copy(receiver.position).addScaledVector(recvVel, passTime * 0.4);

    const isBouncePass = passDist > 4.0 && Math.random() < 0.35;
    this.ballState = isBouncePass ? 'BOUNCE_PASS' : 'PASS';

    const forward = new THREE.Vector3().subVectors(this.passReceiverPosLead, passer.position).normalize();
    this.ballPos.set(passer.position.x, 1.25, passer.position.z).addScaledVector(forward, 0.35);
    this.ballPrevPos.copy(this.ballPos);
    this.ball.position.copy(this.ballPos);

    if (!isBouncePass) {
      const targetPos = this.passReceiverPosLead.clone().setY(1.2);
      this.ballVel.x = (targetPos.x - this.ballPos.x) / passTime;
      this.ballVel.z = (targetPos.z - this.ballPos.z) / passTime;
      const deltaY = targetPos.y - this.ballPos.y;
      this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * passTime * passTime) / passTime;
    } else {
      const bounceSpot = new THREE.Vector3().lerpVectors(this.ballPos, this.passReceiverPosLead, 0.55);
      bounceSpot.y = this.BALL_RADIUS;
      const firstLegTime = passTime * 0.55;

      this.ballVel.x = (bounceSpot.x - this.ballPos.x) / firstLegTime;
      this.ballVel.z = (bounceSpot.z - this.ballPos.z) / firstLegTime;
      const deltaY = bounceSpot.y - this.ballPos.y;
      this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * firstLegTime * firstLegTime) / firstLegTime;
    }
  }

  // --------------------------------------------------------------------------
  // (1), (2), (4), (5), (6) MAIN BALLISTIC PHYSICS & RESOLUTION
  // --------------------------------------------------------------------------
  private updateBallPhysics(dt: number) {
    // 1. (8) DRIBBLE STATE
    if (this.ballState === 'DRIBBLE' && this.ballHolder) {
      const holder = this.ballHolder;
      this.dribbleCycle += dt * 14.0; // ~2.2 bounces per sec

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(holder.quaternion);

      const bounceNorm = Math.abs(Math.sin(this.dribbleCycle));
      const handY = 0.95;
      const dribbleY = this.BALL_RADIUS + (handY - this.BALL_RADIUS) * Math.pow(bounceNorm, 1.4);

      const offset = right.clone().multiplyScalar(0.38).add(forward.clone().multiplyScalar(0.22));
      this.ballPos.copy(holder.position).add(offset);
      this.ballPos.y = dribbleY;
      this.ballPrevPos.copy(this.ballPos);
      this.ball.position.copy(this.ballPos);
      this.ball.rotation.x += dt * 8;
      return;
    }

    // Save previous position for continuous plane crossing checks
    this.ballPrevPos.copy(this.ballPos);

    // 2. Continuous Ballistic flight: Integrate velocity & gravity
    if (!this.isBallRolling) {
      this.ballVel.y += this.GRAVITY * dt;
    }

    this.ballPos.addScaledVector(this.ballVel, dt);

    // 3. (5) SPIN DYNAMICS
    if (this.ballState === 'SHOT') {
      // Backspin: ~2 rotations per second around horizontal transverse axis
      this.ball.rotation.x -= dt * (Math.PI * 4);
    } else if (this.isBallRolling) {
      // True roll forward on hardwood
      const speed = new THREE.Vector2(this.ballVel.x, this.ballVel.z).length();
      if (speed > 0.01) {
        this.ball.rotation.x += (speed / this.BALL_RADIUS) * dt;
      }
    }

    // 4. (4) BACKBOARD COLLISION
    this.checkBackboardCollisions();

    // 5. (1) RIM TORUS COLLISION WITH RATTLE & NUDGES
    this.checkRimCollisions(dt);

    // 6. (2) STRICT SCORING DETECTION (Downwards crossing of rim plane inside circle)
    this.checkScoringPlaneCrossing();

    // 7. (5) ANTI-STUCK RULE
    this.checkAntiStuckRule(dt);

    // 8. (4) FLOOR BOUNCING & ROLLING
    this.checkFloorCollision(dt);

    // 9. (7) PASS ARRIVAL CHECK
    if ((this.ballState === 'PASS' || this.ballState === 'BOUNCE_PASS') && this.passTargetPlayer) {
      const distToReceiver = this.ballPos.distanceTo(this.passTargetPlayer.position);
      if (distToReceiver < 0.85 && this.ballPos.y > 0.35) {
        this.ballHolder = this.passTargetPlayer;
        this.ballState = 'DRIBBLE';
        this.passTargetPlayer = null;
        if (this.ballHolder.data.team === 'GSW') {
          this.controlledPlayer = this.ballHolder;
          this.updateControlledNameplate(this.controlledPlayer);
        }
      }
    }

    // 10. (6) REBOUND PURSUIT & TURNOVER RESOLUTION
    if (this.ballState === 'REBOUND') {
      this.updateReboundPursuit(dt);
    }

    // 11. MADE BASKET POST-DROP DELAY & INBOUND
    if (this.ballState === 'MADE_DROP') {
      this.postScoreTimer += dt;
      if (this.postScoreTimer > 1.2 && this.floorBounceCount >= 1 && this.nextPossessionTeam) {
        this.executeInbound(this.nextPossessionTeam);
        this.nextPossessionTeam = null;
        this.postScoreTimer = 0;
      }
    }

    // Update 3D visual position
    this.ball.position.copy(this.ballPos);
  }

  // --------------------------------------------------------------------------
  // (4) BACKBOARD COLLISION (Restitution ~0.65)
  // --------------------------------------------------------------------------
  private checkBackboardCollisions() {
    const hoops = [
      { zRim: -13.0, zBB: -13.38, isGSW: true },
      { zRim: 13.0, zBB: 13.38, isGSW: false },
    ];

    hoops.forEach(h => {
      const nearZ = Math.abs(this.ballPos.z - h.zBB) <= this.BALL_RADIUS + 0.02;
      const withinX = Math.abs(this.ballPos.x) <= 0.9;
      const withinY = this.ballPos.y >= 2.75 && this.ballPos.y <= 3.82;

      if (nearZ && withinX && withinY) {
        const headingIntoBB = h.isGSW ? this.ballVel.z < 0 : this.ballVel.z > 0;
        if (headingIntoBB) {
          // Restitution ~0.65
          this.ballVel.z = -this.ballVel.z * 0.65;
          this.ballVel.x *= 0.85;
          this.ballVel.y *= 0.85;

          // Prevent clipping through backboard
          this.ballPos.z = h.zBB + (h.isGSW ? (this.BALL_RADIUS + 0.025) : -(this.BALL_RADIUS + 0.025));
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // (1) RIM TORUS COLLISION WITH 1–3 HOP RATTLE & PRE-ROLLED STEERING
  // --------------------------------------------------------------------------
  private checkRimCollisions(dt: number) {
    // Green releases are clean swishes: no rim collisions
    if (this.activeShot?.isGreen && !this.activeShot.hasScored) return;

    const hoops = [this.gswHoopPos, this.houHoopPos];

    hoops.forEach(hoop => {
      const dx = this.ballPos.x - hoop.x;
      const dz = this.ballPos.z - hoop.z;
      const distXZ = Math.sqrt(dx * dx + dz * dz);

      // Track time near rim for anti-stuck
      if (Math.abs(this.ballPos.y - this.RIM_HEIGHT) < 0.4 && distXZ < 0.45) {
        this.rimNearTimer += dt;
      }

      if (distXZ < 0.001) return;

      // Closest point on the rim circle torus
      const ringX = hoop.x + (dx / distXZ) * this.RIM_RADIUS;
      const ringY = this.RIM_HEIGHT;
      const ringZ = hoop.z + (dz / distXZ) * this.RIM_RADIUS;

      const distToRing = Math.hypot(this.ballPos.x - ringX, this.ballPos.y - ringY, this.ballPos.z - ringZ);
      const contactDist = this.BALL_RADIUS + this.RIM_TUBE_RADIUS;

      if (distToRing < contactDist) {
        // Collision normal from ring tube toward ball center
        const nx = (this.ballPos.x - ringX) / distToRing;
        const ny = (this.ballPos.y - ringY) / distToRing;
        const nz = (this.ballPos.z - ringZ) / distToRing;

        const vDotN = this.ballVel.x * nx + this.ballVel.y * ny + this.ballVel.z * nz;

        if (vDotN < 0) {
          this.rimBounceCount++;

          // (1) Restitution ~0.6 vertical, ~0.5 horizontal
          this.ballVel.y = Math.abs(this.ballVel.y) * 0.6 + 0.8; // Pop up for rattle
          this.ballVel.x = (this.ballVel.x - 1.5 * vDotN * nx) * 0.5;
          this.ballVel.z = (this.ballVel.z - 1.5 * vDotN * nz) * 0.5;

          // Small random horizontal impulse so no two bounces look identical
          this.ballVel.x += (Math.random() - 0.5) * 0.35;
          this.ballVel.z += (Math.random() - 0.5) * 0.35;

          // Push ball outside ring boundary
          this.ballPos.set(
            ringX + nx * (contactDist + 0.004),
            ringY + ny * (contactDist + 0.004),
            ringZ + nz * (contactDist + 0.004)
          );

          // (3) Natural steering toward pre-rolled result
          if (this.activeShot && !this.activeShot.hasScored) {
            const toCenter = new THREE.Vector2(hoop.x - this.ballPos.x, hoop.z - this.ballPos.z);

            if (this.activeShot.willMake) {
              // MAKE roll: rattle 1-2 times, steer ball slightly inward toward center
              this.activeShot.rattlePhase++;
              if (this.activeShot.rattlePhase >= 2 || distXZ < this.RIM_RADIUS) {
                toCenter.normalize();
                this.ballVel.x += toCenter.x * 0.65;
                this.ballVel.z += toCenter.y * 0.65;
                this.ballVel.y = THREE.MathUtils.clamp(this.ballVel.y, -0.6, 0.8);
              }
            } else {
              // MISS roll: steer ball up and outward away from the hoop
              toCenter.normalize();
              this.ballVel.x -= toCenter.x * 0.95;
              this.ballVel.z -= toCenter.y * 0.95;
              this.ballVel.y += 0.5;
              this.ballState = 'REBOUND'; // Miss is now a live loose ball
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // (2) EXACT SCORING DETECTION
  // --------------------------------------------------------------------------
  private checkScoringPlaneCrossing() {
    if (!this.activeShot || this.activeShot.hasScored) return;

    const hoop = this.activeShot.hoopPos;
    const dx = this.ballPos.x - hoop.x;
    const dz = this.ballPos.z - hoop.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);

    // Rule: Center must cross the rim height plane moving DOWNWARD while strictly inside rim circle
    const crossedRimDownwards =
      this.ballPrevPos.y >= this.RIM_HEIGHT &&
      this.ballPos.y < this.RIM_HEIGHT &&
      this.ballVel.y < -0.1;
    const strictlyInsideRim = distXZ < (this.RIM_RADIUS - 0.035);

    if (crossedRimDownwards && strictlyInsideRim) {
      // Award score
      this.activeShot.hasScored = true;
      this.ballState = 'MADE_DROP';
      this.floorBounceCount = 0;
      this.postScoreTimer = 0;

      // Score update
      if (this.activeShot.shooterTeam === 'GSW') {
        this.homeScore += this.activeShot.points;
      } else {
        this.awayScore += this.activeShot.points;
      }
      this.onScoreUpdate?.(
        this.homeScore,
        this.awayScore,
        this.activeShot.points,
        this.activeShot.shooterTeam
      );

      // Floating +2 / +3
      this.spawnFloatingScore(this.activeShot.points, hoop);

      // Green release confetti burst ONLY
      if (this.activeShot.isGreen) {
        this.spawnGreenConfetti(hoop);
      }

      // Net animation & deceleration
      if (hoop.z < 0) {
        this.gswNetWobble = 0.35;
      } else {
        this.houNetWobble = 0.35;
      }

      // Net friction deceleration with forward drift
      this.ballVel.y *= 0.68;
      this.ballVel.x *= 0.55;
      const forwardZ = this.activeShot.shooterTeam === 'GSW' ? -0.4 : 0.4;
      this.ballVel.z = this.ballVel.z * 0.55 + forwardZ;

      // Inbound goes to the defending team
      this.nextPossessionTeam = this.activeShot.shooterTeam === 'GSW' ? 'HOU' : 'GSW';
      this.shotClock = 24.0;
    }
  }

  // --------------------------------------------------------------------------
  // (5) ANTI-STUCK RULE (> 1.5s near rim)
  // --------------------------------------------------------------------------
  private checkAntiStuckRule(dt: number) {
    if (this.rimNearTimer > 1.5) {
      this.rimNearTimer = 0;
      const hoop = this.activeShot?.hoopPos || this.gswHoopPos;
      const dx = this.ballPos.x - hoop.x;
      const dz = this.ballPos.z - hoop.z;
      const distXZ = Math.hypot(dx, dz);

      if (distXZ < this.RIM_RADIUS * 0.75 && Math.abs(this.ballVel.y) < 0.6) {
        // Drop it through for make
        this.ballPos.set(hoop.x, this.RIM_HEIGHT - 0.05, hoop.z);
        this.ballVel.set(0, -1.8, this.activeShot?.shooterTeam === 'GSW' ? -0.3 : 0.3);
      } else {
        // Push outward away from hoop
        const out = new THREE.Vector2(dx, dz).normalize();
        this.ballVel.set(out.x * 2.2, 1.2, out.y * 2.2);
        this.ballState = 'REBOUND';
      }
    }
  }

  // --------------------------------------------------------------------------
  // (4), (6) FLOOR BOUNCE & LOOSE BALL ROLLING
  // --------------------------------------------------------------------------
  private checkFloorCollision(dt: number) {
    if (this.ballPos.y <= this.BALL_RADIUS) {
      this.ballPos.y = this.BALL_RADIUS;

      // Check if missed shot transitioned to floor bounce -> live rebound
      if (this.ballState === 'SHOT' && !this.activeShot?.hasScored) {
        this.ballState = 'REBOUND';
      }

      if (Math.abs(this.ballVel.y) > 0.45 && this.floorBounceCount < 4) {
        // Floor restitution ~0.75
        this.ballVel.y = -this.ballVel.y * 0.75;
        // Reduce horizontal velocity 20% per bounce
        this.ballVel.x *= 0.80;
        this.ballVel.z *= 0.80;
        this.floorBounceCount++;
      } else {
        // Transition to rolling with hardwood friction
        this.ballVel.y = 0;
        this.isBallRolling = true;
        this.ballVel.x *= Math.max(0, 1 - 2.8 * dt);
        this.ballVel.z *= Math.max(0, 1 - 2.8 * dt);

        if (this.ballVel.lengthSq() < 0.005) {
          this.ballVel.set(0, 0, 0);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // (6) LIVE REBOUND PURSUIT (Nearest 2–3 players chase ball)
  // --------------------------------------------------------------------------
  private updateReboundPursuit(dt: number) {
    // 2-3 nearest from each team
    const sortedGSW = this.players
      .filter(p => p.data.team === 'GSW')
      .sort((a, b) => a.position.distanceTo(this.ballPos) - b.position.distanceTo(this.ballPos))
      .slice(0, 3);

    const sortedHOU = this.players
      .filter(p => p.data.team === 'HOU')
      .sort((a, b) => a.position.distanceTo(this.ballPos) - b.position.distanceTo(this.ballPos))
      .slice(0, 3);

    const rebounders = [...sortedGSW, ...sortedHOU];

    for (const p of rebounders) {
      // Controlled player can also be moved manually by keyboard
      if (p !== this.controlledPlayer) {
        const toBall = new THREE.Vector3(this.ballPos.x - p.position.x, 0, this.ballPos.z - p.position.z);
        if (toBall.length() > 0.2) {
          toBall.normalize();
          p.position.addScaledVector(toBall, p.data.speed * 0.88 * dt);
          p.lookAt(this.ballPos.x, p.position.y, this.ballPos.z);
        }
      }

      // Check pickup range (first player within range gains possession)
      const dist = p.position.distanceTo(this.ballPos);
      if (dist < 0.85 && this.ballPos.y < 1.35) {
        // Gain possession smoothly without snapping
        this.ballHolder = p;
        this.ballState = 'DRIBBLE';
        this.isBallRolling = false;
        this.activeShot = null;
        this.shotClock = 24.0;

        if (p.data.team === 'GSW') {
          this.controlledPlayer = p;
          this.updateControlledNameplate(this.controlledPlayer);
        }
        break;
      }
    }
  }

  private executeInbound(team: 'GSW' | 'HOU') {
    const inbounder = this.players.find(p => p.data.team === team);
    if (!inbounder) return;

    const baselineZ = team === 'GSW' ? 13.8 : -13.8;
    inbounder.position.set(0, 0, baselineZ);

    this.ballHolder = inbounder;
    this.ballState = 'DRIBBLE';
    this.floorBounceCount = 0;
    this.isBallRolling = false;
    this.activeShot = null;

    if (team === 'GSW') {
      this.controlledPlayer = inbounder;
      this.updateControlledNameplate(this.controlledPlayer);
    }
  }

  // --------------------------------------------------------------------------
  // (6) NET ANIMATION & VISUAL FX
  // --------------------------------------------------------------------------
  private updateNetAnimation(dt: number) {
    if (this.gswNetWobble > 0) {
      this.gswNetWobble = Math.max(0, this.gswNetWobble - dt);
      const wobble = Math.sin(this.gswNetWobble * 30) * (this.gswNetWobble / 0.35) * 0.28;
      this.gswNetMesh.scale.set(1 + wobble, 1 - wobble * 0.5, 1 + wobble);
    } else {
      this.gswNetMesh.scale.set(1, 1, 1);
    }

    if (this.houNetWobble > 0) {
      this.houNetWobble = Math.max(0, this.houNetWobble - dt);
      const wobble = Math.sin(this.houNetWobble * 30) * (this.houNetWobble / 0.35) * 0.28;
      this.houNetMesh.scale.set(1 + wobble, 1 - wobble * 0.5, 1 + wobble);
    } else {
      this.houNetMesh.scale.set(1, 1, 1);
    }
  }

  private spawnFloatingScore(points: number, hoopPos: THREE.Vector3) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffeb3b';
    ctx.font = 'bold 44px Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
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
        Math.random() * 4.0 + 2.5,
        (Math.random() - 0.5) * 4.5
      );
      this.scene.add(mesh);
      this.confettiParticles.push({ mesh, vel, life: 1.0 });
    }
  }

  private updateVFX(dt: number) {
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

    for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
      const c = this.confettiParticles[i];
      c.life -= dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.vel.y += this.GRAVITY * 0.45 * dt;
      c.mesh.rotation.x += dt * 6;
      c.mesh.rotation.y += dt * 8;

      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.confettiParticles.splice(i, 1);
      }
    }
  }

  // --------------------------------------------------------------------------
  // AI BEHAVIOR & MAN-TO-MAN DEFENSE
  // --------------------------------------------------------------------------
  private updateHoustonAI(dt: number) {
    const houPlayers = this.players.filter(p => p.data.team === 'HOU');
    const gswPlayers = this.players.filter(p => p.data.team === 'GSW');
    const isHouOffense = this.ballHolder && this.ballHolder.data.team === 'HOU';

    this.aiDecisionTimer += dt;
    this.aiPassTimer += dt;

    if (isHouOffense && this.ballHolder && this.ballState === 'DRIBBLE') {
      const carrier = this.ballHolder;
      const targetRim = this.houHoopPos;

      const toRim = new THREE.Vector3().subVectors(targetRim, carrier.position);
      toRim.y = 0;
      const distToRim = toRim.length();

      if (distToRim > 5.5) {
        toRim.normalize();
        carrier.position.addScaledVector(toRim, carrier.data.speed * 0.75 * dt);
        carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
      }

      const defender = this.getNearestDefender(carrier);
      const defDist = defender ? defender.position.distanceTo(carrier.position) : 99;

      if (this.aiPassTimer > 3.2 || (defDist < 1.7 && this.aiDecisionTimer > 1.2)) {
        this.aiPassTimer = 0;
        this.initiatePass(carrier);
      }

      const inGoodRange = distToRim <= 6.8;
      const openShot = defDist > 2.2 && inGoodRange;
      const clockExpiring = this.shotClock < 3.5;

      if ((openShot || clockExpiring || (inGoodRange && this.aiDecisionTimer > 4.5)) && this.ballState === 'DRIBBLE') {
        this.aiDecisionTimer = 0;
        const simHold = 0.65 + (Math.random() - 0.5) * 0.12;
        this.executeShot(carrier, simHold);
      }
    }

    // Defenders stay strictly between their matchup and the basket
    this.players.forEach(p => {
      if (p === this.ballHolder) return;
      if (this.ballState === 'REBOUND') return; // Handled by rebound pursuit

      const isDefense = this.ballHolder ? p.data.team !== this.ballHolder.data.team : p.data.team === 'HOU';
      if (isDefense) {
        const opponents = p.data.team === 'HOU' ? gswPlayers : houPlayers;
        const myMatchup = opponents.find(opp => opp.data.position === p.data.position) || opponents[0];
        const rimToDefend = p.data.team === 'HOU' ? this.gswHoopPos : this.houHoopPos;

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

  // --------------------------------------------------------------------------
  // USER MOVEMENT & ANIMATION
  // --------------------------------------------------------------------------
  private updatePlayerMovement(dt: number) {
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

    // Legs and arms swinging during movement
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
        p.leftLegPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.rightLegPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.leftArmPivot.rotation.x *= Math.max(0, 1 - dt * 10);
        p.rightArmPivot.rotation.x *= Math.max(0, 1 - dt * 10);
      }

      p.lastPos.copy(p.position);
    });

    if (this.controlledPlayer && this.nameplateSprite) {
      this.nameplateSprite.position.set(
        this.controlledPlayer.position.x,
        this.controlledPlayer.position.y + 2.55,
        this.controlledPlayer.position.z
      );
    }
  }

  // --------------------------------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------------------------------
  private animate = (timestamp: number) => {
    requestAnimationFrame(this.animate);
    const dt = 0.016;

    if (!this.isGameOver) {
      this.shotClock = Math.max(0, this.shotClock - dt);
      this.gameClock = Math.max(0, this.gameClock - dt);
      this.onShotClockUpdate?.(Math.ceil(this.shotClock));

      if (this.isChargingShot) {
        this.shotHoldTime += dt;
        this.onShotMeterUpdate?.(Math.min(1.0, this.shotHoldTime / 0.65), true);
      } else {
        this.onShotMeterUpdate?.(0, false);
      }

      this.updatePlayerMovement(dt);
      this.updateHoustonAI(dt);
      this.updateBallPhysics(dt);
      this.updateNetAnimation(dt);
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

interface PlayerMesh extends THREE.Group {
  data: PlayerData;
  runCycle: number;
  lastPos: THREE.Vector3;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
}
