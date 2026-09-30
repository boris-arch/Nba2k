import * as THREE from 'three';
import { sounds } from './audio';

export interface PlayerData {
  id: string;
  name: string;
  number: string;
  team: 'GSW' | 'HOU';
  position: 'PG' | 'SG' | 'SF' | 'PF' | 'C';
  threePointRating: number;
  midRangeRating: number;
  speed: number;
  personalFouls: number;
}

export interface ShotMeterEvent {
  value: number;
  isCharging: boolean;
  isGreen: boolean;
  isFrozen: boolean;
  quality?: string;
}

export type BallState = 'DRIBBLE' | 'SHOT' | 'REBOUND' | 'PASS' | 'BOUNCE_PASS' | 'MADE_DROP' | 'FREE_THROW';

export interface ViolationEventUI {
  violation: string;
  team: 'GSW' | 'HOU';
  awardedTeam: 'GSW' | 'HOU';
  description: string;
}

export interface FoulEventUI {
  fouledName: string;
  foulerName: string;
  foulerPersonalFouls: number;
  isFouledOut?: boolean;
  team: 'GSW' | 'HOU';
  foulType: string;
  attempt: number;
  attemptsTotal: number;
  statusText: string;
  isAndOne?: boolean;
  shot1Result?: 'PENDING' | 'MADE' | 'MISSED';
  shot2Result?: 'PENDING' | 'MADE' | 'MISSED';
  shot3Result?: 'PENDING' | 'MADE' | 'MISSED';
}

export interface FreeThrowState {
  fouledPlayer: PlayerMesh;
  foulerPlayer: PlayerMesh;
  foulType: string;
  attemptsTotal: number;
  currentAttempt: number;
  stage: 'WHISTLE' | 'ROUTINE_1' | 'SHOT_1' | 'RESET_2' | 'ROUTINE_2' | 'SHOT_2' | 'RESET_3' | 'ROUTINE_3' | 'SHOT_3';
  timer: number;
  shot1Made: boolean;
  shot2Made: boolean;
  shot3Made: boolean;
  hasScoredAttempt1: boolean;
  hasScoredAttempt2: boolean;
  hasScoredAttempt3: boolean;
  isAndOne?: boolean;
  startPos: THREE.Vector3;
  targetRim: THREE.Vector3;
}

export class BasketballGame {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;

  // Real-world scale parameters (Meters)
  private readonly GRAVITY = -18.5; // Realistic high-arc basketball shot physics
  private readonly RIM_HEIGHT = 3.05; // 10 feet
  private readonly RIM_RADIUS = 0.23; // ~0.75 ft
  private readonly RIM_TUBE_RADIUS = 0.018; // Thin tube
  private readonly BALL_RADIUS = 0.12; // ~0.39 ft
  private readonly COURT_WIDTH = 15.24;
  private readonly COURT_LENGTH = 28.65;

  // Game Score & Clocks
  private homeScore = 0;
  private awayScore = 0;
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

  // Rebound Target Decal
  private reboundMarker!: THREE.Mesh;

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
    isDunk: boolean;
    points: number;
    shooter: PlayerMesh;
    shooterTeam: 'GSW' | 'HOU';
    hoopPos: THREE.Vector3;
    backboardZ: number;
    hasScored: boolean;
    hasHitRim: boolean;
    hasHitFloor: boolean;
    rattlePhase: number;
  } | null = null;

  // Hoops & Nets
  // GSW attacks negative Z (Hoop at -13.0, Backboard at -13.38)
  // HOU attacks positive Z (Hoop at +13.0, Backboard at +13.38)
  private gswHoopPos = new THREE.Vector3(0, 3.05, -13.0);
  private houHoopPos = new THREE.Vector3(0, 3.05, 13.0);
  private gswHoopGroup!: THREE.Group;
  private houHoopGroup!: THREE.Group;
  private gswNetMesh!: THREE.Mesh;
  private houNetMesh!: THREE.Mesh;
  private gswNetWobble = 0;
  private houNetWobble = 0;

  // Teams & Players
  private players: PlayerMesh[] = [];
  private controlledPlayer!: PlayerMesh;

  // Single Consolidated Nameplate
  private nameplateSprite!: THREE.Sprite;
  private nameplateCanvas!: HTMLCanvasElement;
  private nameplateContext!: CanvasRenderingContext2D;

  // Dynamic Camera Views (Side Broadcast, Courtside, 2K Behind)
  private cameraMode: 'SIDE' | 'BEHIND' | 'COURTSIDE' = 'SIDE';
  private cameraTargetPos = new THREE.Vector3(14.8, 7.6, 0);
  private cameraLookTarget = new THREE.Vector3(0, 1.6, 0);
  private cameraCurrentLook = new THREE.Vector3(0, 1.6, 0);

  // Visual Effects
  private floatingTexts: { sprite: THREE.Sprite; lifetime: number; maxLife: number }[] = [];
  private confettiParticles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  // Dribbling & AI Timers
  private dribbleCycle = 0;
  private prevDribbleSine = 0;
  private aiDecisionTimer = 0;
  private aiPassTimer = 0;
  private houPassCount = 0;
  private houCarrierDribbleTime = 0;

  // Controls, Sprint & Stamina
  private keys: { [key: string]: boolean } = {};
  private joystickVector = new THREE.Vector2(0, 0);
  private shotHoldTime = 0;
  private isChargingShot = false;
  private isSprinting = false;
  private stamina = 1.0;
  private lastTimestamp = 0;
  private lastSqueakTime = 0;

  // Free Throw & Foul Tracking
  private activeFoul: FreeThrowState | null = null;

  // Official NBA Rule Tracking
  private hasEstablishedFrontcourt = false;
  private backcourtTimer = 0;
  private paintTimerMap: Map<PlayerMesh, number> = new Map();
  private isInboundPlay = false;
  private inboundTimer = 0;
  private gswTeamFouls = 2;
  private houTeamFouls = 3;
  private lastBallTouchedTeam: 'GSW' | 'HOU' = 'GSW';
  private foulCooldownTimer = 0;

  // Callbacks
  public onScoreUpdate?: (home: number, away: number, points: number, team: string) => void;
  public onShotMeterUpdate?: (event: ShotMeterEvent) => void;
  public onShotReleased?: (quality: string, isGreen: boolean) => void;
  public onShotClockUpdate?: (seconds: number) => void;
  public onPossessionChange?: (hasBall: boolean) => void;
  public onStaminaUpdate?: (stamina: number) => void;
  public onFoulEvent?: (event: FoulEventUI | null) => void;
  public onRuleViolation?: (event: ViolationEventUI) => void;
  public onTeamFoulsUpdate?: (gswFouls: number, houFouls: number, gswBonus: boolean, houBonus: boolean) => void;

  public emitTeamFouls() {
    this.onTeamFoulsUpdate?.(
      this.gswTeamFouls,
      this.houTeamFouls,
      this.gswTeamFouls >= 5,
      this.houTeamFouls >= 5
    );
  }

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = ''; // Ensure clean container with zero orphan elements

    // 1. Scene & Camera setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e17);

    // Initial camera setup
    this.camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(14.8, 7.6, 0);
    this.camera.lookAt(0, 1.6, 0);

    // 2. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 3. World Setup
    this.setupLighting();
    this.createCourt();
    this.createHoopsAndNets();
    this.createReboundDecal();
    this.createBall();
    this.createSingleNameplate();
    this.spawnTeams();

    // Default possession: Curry has the ball on GSW offense
    this.ballHolder = this.controlledPlayer;
    this.ballState = 'DRIBBLE';
    this.onPossessionChange?.(true);

    // 4. Input Listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // 5. Main Loop
    this.animate(0);
  }

  // --------------------------------------------------------------------------
  // LIGHTING & ENVIRONMENT
  // --------------------------------------------------------------------------
  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    dirLight.position.set(12, 28, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 70;
    dirLight.shadow.camera.left = -16;
    dirLight.shadow.camera.right = 16;
    dirLight.shadow.camera.top = 16;
    dirLight.shadow.camera.bottom = -16;
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x7fb2ff, 0.45);
    rimLight.position.set(-14, 20, -14);
    this.scene.add(rimLight);
  }

  // --------------------------------------------------------------------------
  // HOUSTON ROCKETS COURT IDENTITY & REGULATION BOUNDARIES
  // --------------------------------------------------------------------------
  private createCourt() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;

    // 1. Hardwood base with realistic staggered planks
    ctx.fillStyle = '#caa16a';
    ctx.fillRect(0, 0, 1024, 2048);

    const plankWidth = 32;
    const plankColors = ['#d1a770', '#c89d65', '#d6ac75', '#c2975e', '#cf9f68', '#c69961'];
    for (let x = 0; x < 1024; x += plankWidth) {
      const colIdx = Math.floor(x / plankWidth) % plankColors.length;
      ctx.fillStyle = plankColors[colIdx];
      ctx.fillRect(x, 0, plankWidth, 2048);

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 2048);
      ctx.stroke();

      const staggerOffset = (colIdx * 180) % 240;
      for (let y = staggerOffset; y < 2048; y += 240) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + plankWidth, y);
        ctx.stroke();
      }
    }

    // 2. Houston Rockets Signature Pink/Magenta Keys (The Paint)
    const keyLeft = 348;
    const keyWidth = 328;
    const keyLength = 415;
    const magentaColor = '#d11f5a'; // Iconic Rockets carmine magenta
    const darkCrimson = '#8c0e30';

    // North Key (GSW attack rim)
    ctx.fillStyle = magentaColor;
    ctx.fillRect(keyLeft, 0, keyWidth, keyLength);

    // South Key (Houston attack rim)
    ctx.fillRect(keyLeft, 2048 - keyLength, keyWidth, keyLength);

    // 3. Baselines & Sidelines Border Aprons
    const apronDepth = 75;
    ctx.fillStyle = darkCrimson;
    ctx.fillRect(0, 0, 1024, apronDepth);
    ctx.fillRect(0, 2048 - apronDepth, 1024, apronDepth);
    ctx.fillRect(0, 0, 36, 2048);
    ctx.fillRect(1024 - 36, 0, 36, 2048);

    // 4. "HOUSTON ROCKETS" Baseline Lettering
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 48px Impact, system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 6;

    ctx.save();
    ctx.translate(512, 38);
    ctx.rotate(Math.PI);
    ctx.fillText('HOUSTON ROCKETS', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(512, 2048 - 38);
    ctx.fillText('HOUSTON ROCKETS', 0, 0);
    ctx.restore();

    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.save();
    ctx.translate(18, 1024);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('TOYOTA CENTER', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(1024 - 18, 1024);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('TOYOTA CENTER', 0, 0);
    ctx.restore();
    ctx.shadowBlur = 0;

    // 5. Center Circle & Logo
    ctx.fillStyle = magentaColor;
    ctx.beginPath();
    ctx.arc(512, 1024, 120, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(512, 1024, 120, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 130px Impact, sans-serif';
    ctx.fillText('R', 512, 1030);

    // 6. Crisp White Court Lines & Prominent Out-of-Bounds Boundary Line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12; // Extra bold perimeter line
    ctx.strokeRect(36, apronDepth, 1024 - 72, 2048 - apronDepth * 2);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(42, apronDepth + 6, 1024 - 84, 2048 - (apronDepth + 6) * 2);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;

    // Half court line
    ctx.beginPath();
    ctx.moveTo(36, 1024);
    ctx.lineTo(1024 - 36, 1024);
    ctx.stroke();

    // Free throw circles
    ctx.beginPath();
    ctx.arc(512, keyLength, 120, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(512, 2048 - keyLength, 120, 0, Math.PI * 2);
    ctx.stroke();

    // 3-point arcs
    ctx.beginPath();
    ctx.arc(512, 98, 454, 0.22 * Math.PI, 0.78 * Math.PI, false);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(512, 2048 - 98, 454, 1.22 * Math.PI, 1.78 * Math.PI, false);
    ctx.stroke();

    // Restricted Area Arcs
    ctx.beginPath();
    ctx.arc(512, 98, 85, 0, Math.PI, false);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(512, 2048 - 98, 85, Math.PI, 0, false);
    ctx.stroke();

    const courtTexture = new THREE.CanvasTexture(canvas);
    courtTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const courtGeo = new THREE.PlaneGeometry(this.COURT_WIDTH, this.COURT_LENGTH);
    const courtMat = new THREE.MeshStandardMaterial({
      map: courtTexture,
      roughness: 0.32,
      metalness: 0.1,
    });

    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    this.scene.add(court);

    // PHYSICAL 3D OUT-OF-BOUNDS BOUNDARY STRIPS
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineWidth = 0.10;
    const halfW = 7.15;
    const halfL = 13.80;

    const nBaseGeo = new THREE.PlaneGeometry(halfW * 2 + lineWidth, lineWidth);
    const nBase = new THREE.Mesh(nBaseGeo, lineMat);
    nBase.rotation.x = -Math.PI / 2;
    nBase.position.set(0, 0.012, -halfL);
    this.scene.add(nBase);

    const sBaseGeo = new THREE.PlaneGeometry(halfW * 2 + lineWidth, lineWidth);
    const sBase = new THREE.Mesh(sBaseGeo, lineMat);
    sBase.rotation.x = -Math.PI / 2;
    sBase.position.set(0, 0.012, halfL);
    this.scene.add(sBase);

    const wSideGeo = new THREE.PlaneGeometry(lineWidth, halfL * 2);
    const wSide = new THREE.Mesh(wSideGeo, lineMat);
    wSide.rotation.x = -Math.PI / 2;
    wSide.position.set(-halfW, 0.012, 0);
    this.scene.add(wSide);

    const eSideGeo = new THREE.PlaneGeometry(lineWidth, halfL * 2);
    const eSide = new THREE.Mesh(eSideGeo, lineMat);
    eSide.rotation.x = -Math.PI / 2;
    eSide.position.set(halfW, 0.012, 0);
    this.scene.add(eSide);

    const hashGeo = new THREE.PlaneGeometry(0.35, 0.06);
    [-8.5, -4.5, 0, 4.5, 8.5].forEach(zHash => {
      [-halfW, halfW].forEach(xSide => {
        const hash = new THREE.Mesh(hashGeo, lineMat);
        hash.rotation.x = -Math.PI / 2;
        const offset = xSide > 0 ? -0.17 : 0.17;
        hash.position.set(xSide + offset, 0.012, zHash);
        this.scene.add(hash);
      });
    });
  }

  // --------------------------------------------------------------------------
  // HOOPS & NETS
  // --------------------------------------------------------------------------
  private createHoopsAndNets() {
    const buildHoop = (zPos: number, isHoustonHoop: boolean) => {
      const hoopGroup = new THREE.Group();
      const bbZRel = isHoustonHoop ? 0.38 : -0.38;
      const poleZRel = isHoustonHoop ? 1.15 : -1.15;

      const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e2430 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 1.9, zPos + poleZRel);
      hoopGroup.add(pole);

      const bbGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
      const bbMat = new THREE.MeshStandardMaterial({
        color: 0xf3f6fa,
        roughness: 0.15,
        metalness: 0.1,
      });
      const bb = new THREE.Mesh(bbGeo, bbMat);
      bb.position.set(0, 3.3, zPos + bbZRel);
      bb.castShadow = true;
      hoopGroup.add(bb);

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
      hoopGroup.add(targetBox);

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
      hoopGroup.add(rim);

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
      hoopGroup.add(net);

      this.scene.add(hoopGroup);
      return { group: hoopGroup, net };
    };

    const gswHoop = buildHoop(-13.0, false);
    this.gswHoopGroup = gswHoop.group;
    this.gswNetMesh = gswHoop.net;

    const houHoop = buildHoop(13.0, true);
    this.houHoopGroup = houHoop.group;
    this.houNetMesh = houHoop.net;

    this.houHoopGroup.visible = false;
    this.gswHoopGroup.visible = true;
  }

  // --------------------------------------------------------------------------
  // REBOUND TARGET RING DECAL
  // --------------------------------------------------------------------------
  private createReboundDecal() {
    const ringGeo = new THREE.RingGeometry(0.32, 0.46, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    this.reboundMarker = new THREE.Mesh(ringGeo, ringMat);
    this.reboundMarker.rotation.x = -Math.PI / 2;
    this.reboundMarker.position.set(0, 0.02, 0);
    this.reboundMarker.visible = false;
    this.scene.add(this.reboundMarker);
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
  // SINGLE CONSOLIDATED NAMEPLATE
  // --------------------------------------------------------------------------
  private createSingleNameplate() {
    this.nameplateCanvas = document.createElement('canvas');
    this.nameplateCanvas.width = 512;
    this.nameplateCanvas.height = 128;
    this.nameplateContext = this.nameplateCanvas.getContext('2d')!;

    const texture = new THREE.CanvasTexture(this.nameplateCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.scale.set(3.4, 0.85, 1.0);
    this.nameplateSprite.renderOrder = 999;
  }

  public setControlledPlayer(player: PlayerMesh) {
    if (this.nameplateSprite.parent) {
      this.nameplateSprite.parent.remove(this.nameplateSprite);
    }

    this.controlledPlayer = player;
    this.nameplateSprite.position.set(0, 2.7, 0);
    player.add(this.nameplateSprite);

    this.updateControlledNameplate(player);
  }

  private updateControlledNameplate(player: PlayerMesh) {
    const ctx = this.nameplateContext;
    ctx.clearRect(0, 0, 512, 128);

    const isGSW = player.data.team === 'GSW';

    ctx.shadowColor = isGSW ? 'rgba(0, 83, 188, 0.6)' : 'rgba(206, 17, 65, 0.6)';
    ctx.shadowBlur = 12;

    ctx.fillStyle = isGSW ? 'rgba(10, 30, 80, 0.92)' : 'rgba(90, 10, 30, 0.92)';
    ctx.beginPath();
    ctx.roundRect(16, 16, 480, 96, 24);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.strokeStyle = isGSW ? '#fdb927' : '#ffffff';
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.fillStyle = isGSW ? '#fdb927' : '#ffffff';
    ctx.font = '900 36px Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isGSW ? 'GSW' : 'HOU', 72, 64);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(125, 28);
    ctx.lineTo(125, 100);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${player.data.name} #${player.data.number}`, 145, 64);

    (this.nameplateSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    this.nameplateSprite.visible = true;
  }

  // --------------------------------------------------------------------------
  // PLAYERS & TEAMS CREATION
  // --------------------------------------------------------------------------
  private createPlayerMesh(data: PlayerData): PlayerMesh {
    const group = new THREE.Group() as unknown as PlayerMesh;
    group.data = data;
    group.runCycle = Math.random() * Math.PI;
    group.dribbleHand = 'right';

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

    // Legs with Hip & Knee Articulations
    const thighGeo = new THREE.CylinderGeometry(0.105, 0.092, 0.44, 12);
    const shinGeo = new THREE.CylinderGeometry(0.086, 0.072, 0.44, 12);
    const shoeGeo = new THREE.BoxGeometry(0.16, 0.11, 0.28);
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.55 });
    const shoeMat = new THREE.MeshStandardMaterial({
      color: data.team === 'GSW' ? 0xffffff : 0x181818,
      roughness: 0.35,
    });

    // Left Leg
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.20, 0.95, 0);
    const leftThigh = new THREE.Mesh(thighGeo, shortsMat);
    leftThigh.position.y = -0.22;
    leftThigh.castShadow = true;
    leftLegPivot.add(leftThigh);

    const leftKneePivot = new THREE.Group();
    leftKneePivot.position.set(0, -0.44, 0);
    const leftShin = new THREE.Mesh(shinGeo, skinMat);
    leftShin.position.y = -0.22;
    leftShin.castShadow = true;
    leftKneePivot.add(leftShin);

    const leftFoot = new THREE.Mesh(shoeGeo, shoeMat);
    leftFoot.position.set(0, -0.44, 0.06);
    leftFoot.castShadow = true;
    leftKneePivot.add(leftFoot);

    leftLegPivot.add(leftKneePivot);
    group.add(leftLegPivot);

    // Right Leg
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.20, 0.95, 0);
    const rightThigh = new THREE.Mesh(thighGeo, shortsMat);
    rightThigh.position.y = -0.22;
    rightThigh.castShadow = true;
    rightLegPivot.add(rightThigh);

    const rightKneePivot = new THREE.Group();
    rightKneePivot.position.set(0, -0.44, 0);
    const rightShin = new THREE.Mesh(shinGeo, skinMat);
    rightShin.position.y = -0.22;
    rightShin.castShadow = true;
    rightKneePivot.add(rightShin);

    const rightFoot = new THREE.Mesh(shoeGeo, shoeMat);
    rightFoot.position.set(0, -0.44, 0.06);
    rightFoot.castShadow = true;
    rightKneePivot.add(rightFoot);

    rightLegPivot.add(rightKneePivot);
    group.add(rightLegPivot);

    // Arms with Shoulder & Elbow Articulations
    const upperArmGeo = new THREE.CylinderGeometry(0.082, 0.074, 0.34, 12);
    const forearmGeo = new THREE.CylinderGeometry(0.072, 0.062, 0.34, 12);
    const handGeo = new THREE.BoxGeometry(0.10, 0.12, 0.06);

    // Left Arm
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.40, 1.68, 0);
    const leftUpperArm = new THREE.Mesh(upperArmGeo, skinMat);
    leftUpperArm.position.y = -0.17;
    leftUpperArm.castShadow = true;
    leftArmPivot.add(leftUpperArm);

    const leftElbowPivot = new THREE.Group();
    leftElbowPivot.position.set(0, -0.34, 0);
    const leftForearm = new THREE.Mesh(forearmGeo, skinMat);
    leftForearm.position.y = -0.17;
    leftForearm.castShadow = true;
    leftElbowPivot.add(leftForearm);

    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.set(0, -0.38, 0);
    leftHand.castShadow = true;
    leftElbowPivot.add(leftHand);

    leftArmPivot.add(leftElbowPivot);
    group.add(leftArmPivot);

    // Right Arm
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.40, 1.68, 0);
    const rightUpperArm = new THREE.Mesh(upperArmGeo, skinMat);
    rightUpperArm.position.y = -0.17;
    rightUpperArm.castShadow = true;
    rightArmPivot.add(rightUpperArm);

    const rightElbowPivot = new THREE.Group();
    rightElbowPivot.position.set(0, -0.34, 0);
    const rightForearm = new THREE.Mesh(forearmGeo, skinMat);
    rightForearm.position.y = -0.17;
    rightForearm.castShadow = true;
    rightElbowPivot.add(rightForearm);

    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.set(0, -0.38, 0);
    rightHand.castShadow = true;
    rightElbowPivot.add(rightHand);

    rightArmPivot.add(rightElbowPivot);
    group.add(rightArmPivot);

    group.torsoMesh = torso;
    group.headMesh = head;
    group.leftLegPivot = leftLegPivot;
    group.rightLegPivot = rightLegPivot;
    group.leftKneePivot = leftKneePivot;
    group.rightKneePivot = rightKneePivot;
    group.leftFootMesh = leftFoot;
    group.rightFootMesh = rightFoot;
    group.leftArmPivot = leftArmPivot;
    group.rightArmPivot = rightArmPivot;
    group.leftElbowPivot = leftElbowPivot;
    group.rightElbowPivot = rightElbowPivot;
    group.leftHandMesh = leftHand;
    group.rightHandMesh = rightHand;
    group.lastPos = group.position.clone();
    group.currentSpeed = 0;
    group.idleTimer = Math.random() * 5.0;
    group.dribbleCycle = 0;
    group.crossoverBlend = 1.0;

    this.scene.add(group as unknown as THREE.Object3D);
    return group;
  }

  private spawnTeams() {
    const gswRoster: PlayerData[] = [
      { id: 'curry', name: 'S. CURRY', number: '30', team: 'GSW', position: 'PG', threePointRating: 99, midRangeRating: 96, speed: 4.8, personalFouls: 1 },
      { id: 'thompson', name: 'K. THOMPSON', number: '11', team: 'GSW', position: 'SG', threePointRating: 92, midRangeRating: 90, speed: 4.4, personalFouls: 0 },
      { id: 'wiggins', name: 'A. WIGGINS', number: '22', team: 'GSW', position: 'SF', threePointRating: 84, midRangeRating: 85, speed: 4.6, personalFouls: 1 },
      { id: 'green', name: 'D. GREEN', number: '23', team: 'GSW', position: 'PF', threePointRating: 75, midRangeRating: 78, speed: 4.2, personalFouls: 2 },
      { id: 'looney', name: 'K. LOONEY', number: '5', team: 'GSW', position: 'C', threePointRating: 60, midRangeRating: 72, speed: 3.8, personalFouls: 1 },
    ];

    const houRoster: PlayerData[] = [
      { id: 'vanvleet', name: 'F. VANVLEET', number: '5', team: 'HOU', position: 'PG', threePointRating: 88, midRangeRating: 86, speed: 4.5, personalFouls: 1 },
      { id: 'green_j', name: 'J. GREEN', number: '4', team: 'HOU', position: 'SG', threePointRating: 85, midRangeRating: 84, speed: 4.9, personalFouls: 1 },
      { id: 'brooks', name: 'D. BROOKS', number: '9', team: 'HOU', position: 'SF', threePointRating: 82, midRangeRating: 81, speed: 4.4, personalFouls: 3 },
      { id: 'smith', name: 'J. SMITH JR.', number: '10', team: 'HOU', position: 'PF', threePointRating: 84, midRangeRating: 82, speed: 4.3, personalFouls: 1 },
      { id: 'sengun', name: 'A. SENGUN', number: '28', team: 'HOU', position: 'C', threePointRating: 70, midRangeRating: 85, speed: 3.9, personalFouls: 2 },
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

    this.setControlledPlayer(this.players[0]);
  }

  // --------------------------------------------------------------------------
  // CONTROLS & GAMEPLAY ACTIONS
  // --------------------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    this.keys[key] = true;

    if (e.shiftKey) {
      this.setSprint(true);
    }

    if (e.key === ' ') {
      if (this.ballHolder === this.controlledPlayer && this.ballState === 'DRIBBLE') {
        this.startShooting();
      } else if (this.ballHolder?.data.team !== 'GSW') {
        // Space acts as BLOCK on defense!
        this.triggerBlock();
      }
    }

    if (key === 'x' || key === 'e') {
      if (this.ballHolder === this.controlledPlayer) {
        this.triggerPass();
      } else if (this.ballHolder?.data.team !== 'GSW') {
        // E/X acts as STEAL on defense!
        this.triggerSteal();
      }
    }

    if (key === 'c' || key === 'q') {
      this.cycleControlledPlayer();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    this.keys[key] = false;

    if (!e.shiftKey) {
      this.setSprint(false);
    }

    if (e.key === ' ' && this.isChargingShot) {
      this.releaseShooting();
    }
  };

  public setJoystickInput(x: number, y: number) {
    this.joystickVector.set(x, y);
  }

  public setSprint(sprint: boolean) {
    this.isSprinting = sprint;
  }

  public setCameraMode(mode: 'SIDE' | 'BEHIND' | 'COURTSIDE') {
    this.cameraMode = mode;
  }

  public getCameraMode(): 'SIDE' | 'BEHIND' | 'COURTSIDE' {
    return this.cameraMode;
  }

  public toggleCameraMode(): 'SIDE' | 'BEHIND' | 'COURTSIDE' {
    if (this.cameraMode === 'SIDE') this.cameraMode = 'COURTSIDE';
    else if (this.cameraMode === 'COURTSIDE') this.cameraMode = 'BEHIND';
    else this.cameraMode = 'SIDE';
    return this.cameraMode;
  }

  public startShooting() {
    if (this.ballHolder === this.controlledPlayer && this.ballState === 'DRIBBLE') {
      if (!this.isChargingShot) {
        this.isChargingShot = true;
        this.shotHoldTime = 0;
        this.onShotMeterUpdate?.({
          value: 0,
          isCharging: true,
          isGreen: false,
          isFrozen: false,
        });
      }
    } else if (this.ballState === 'REBOUND') {
      // Snag rebound in mid-air
      this.triggerRebound();
    } else if (this.ballHolder?.data.team !== 'GSW') {
      this.triggerBlock();
    }
  }

  public triggerRebound() {
    if (this.controlledPlayer.isDefendingAnim) return;
    this.controlledPlayer.isDefendingAnim = true;
    this.controlledPlayer.defendAnimTimer = 0;
  }

  public releaseShooting() {
    if (this.isChargingShot) {
      this.isChargingShot = false;
      this.executeShot(this.controlledPlayer, this.shotHoldTime);
    }
  }

  public triggerPass() {
    if (this.ballHolder === this.controlledPlayer) {
      this.initiatePass(this.controlledPlayer);
    }
  }

  // Defensive Block Action
  public triggerBlock() {
    if (this.controlledPlayer.isDefendingAnim || this.ballState === 'FREE_THROW') return;

    this.controlledPlayer.isDefendingAnim = true;
    this.controlledPlayer.defendAnimTimer = 0;

    // Check if near Houston shooter or carrier
    const houCarrier = this.ballHolder && this.ballHolder.data.team === 'HOU' ? this.ballHolder : null;
    const isShotInFlight = this.ballState === 'SHOT' && this.activeShot?.shooterTeam === 'HOU';

    if (isShotInFlight && this.activeShot) {
      const distToBall = this.controlledPlayer.position.distanceTo(this.ballPos);
      const hoop = this.houHoopPos;
      const distToRim = new THREE.Vector2(hoop.x - this.ballPos.x, hoop.z - this.ballPos.z).length();

      // Official NBA Rule 11: Defensive Goaltending (Ball on downward trajectory above rim cylinder)
      if (distToRim < 1.45 && this.ballVel.y < -0.15 && this.ballPos.y >= 2.95) {
        sounds.playWhistle();
        this.spawnFloatingStatus('GOALTENDING! BASKET COUNTS!', this.ballPos, '#10b981');
        this.onRuleViolation?.({
          violation: 'DEFENSIVE GOALTENDING',
          team: 'GSW',
          awardedTeam: 'HOU',
          description: 'Ball touched on downward flight above the cylinder. Basket counts!',
        });
        const pts = this.activeShot.points || 2;
        this.awardPoints('HOU', pts);
        this.ballState = 'MADE_DROP';
        this.ballVel.set(0, -2.0, 0);
        this.activeShot = null;
        setTimeout(() => this.executeInbound('GSW'), 850);
        return;
      }

      if (distToBall < 2.0 && this.ballPos.y < 3.2) {
        // High contact collision check: 24% chance of shooting foul on defender
        const houShooter = this.players.find(p => p.data.team === 'HOU' && p.position.distanceTo(this.ballPos) < 2.4);
        if (houShooter && Math.random() < 0.24) {
          const attempts = this.activeShot.points === 3 ? 3 : 2;
          this.triggerFoul(houShooter, this.controlledPlayer, 'SHOOTING FOUL', attempts);
          return;
        }

        // Clean Block
        sounds.playBlock();
        this.spawnFloatingStatus('BLOCKED BY CURRY!', this.controlledPlayer.position, '#00e5ff');
        this.ballState = 'REBOUND';
        this.activeShot = null;
        this.ballVel.set((Math.random() - 0.5) * 4, 1.8, 4.0);
        this.lastBallTouchedTeam = 'GSW';
      }
    } else if (houCarrier) {
      const distToCarrier = this.controlledPlayer.position.distanceTo(houCarrier.position);
      if (distToCarrier < 1.35 && Math.random() < 0.25) {
        // High contact collision on driver -> shooting foul!
        this.triggerFoul(houCarrier, this.controlledPlayer, 'SHOOTING FOUL', 2);
        return;
      }
      if (distToCarrier < 1.8) {
        sounds.playSneakerSqueak();
      }
    }
  }

  // Defensive Steal Action
  public triggerSteal() {
    if (this.ballState === 'FREE_THROW') return;
    const houCarrier = this.ballHolder && this.ballHolder.data.team === 'HOU' ? this.ballHolder : null;
    if (!houCarrier) return;

    // Lunge arm animation
    this.controlledPlayer.rightArmPivot.rotation.x = -1.5;
    this.controlledPlayer.rightArmPivot.rotation.z = 0.4;

    const dist = this.controlledPlayer.position.distanceTo(houCarrier.position);
    if (dist < 1.5 && this.ballState === 'DRIBBLE') {
      // 22% chance of reach-in foul on aggressive poke check
      if (Math.random() < 0.22) {
        this.triggerFoul(houCarrier, this.controlledPlayer, 'REACH-IN FOUL');
        return;
      }

      const stealChance = 0.45;
      if (Math.random() < stealChance) {
        this.ballHolder = null;
        this.ballState = 'REBOUND';
        this.activeShot = null;
        this.ballVel.set((Math.random() - 0.5) * 3, 1.2, (Math.random() - 0.5) * 3);
        sounds.playSneakerSqueak();
        this.spawnFloatingStatus('STEAL!', this.controlledPlayer.position, '#ffd700');
        this.onPossessionChange?.(false);
        this.lastBallTouchedTeam = 'GSW';
      }
    }
  }

  // --------------------------------------------------------------------------
  // FOUL & FREE THROW SYSTEM
  // --------------------------------------------------------------------------
  public triggerFoul(
    fouled: PlayerMesh,
    fouler: PlayerMesh,
    type: 'SHOOTING FOUL' | 'REACH-IN FOUL' | 'AND-ONE' | 'BLOCKING FOUL' | 'CHARGING FOUL',
    attempts: number = 2,
    isAndOne: boolean = false
  ) {
    if (this.ballState === 'FREE_THROW') return;

    // Track personal foul on the committing player
    fouler.data.personalFouls++;
    const isFouledOut = fouler.data.personalFouls >= 6;

    // Track team fouls
    if (fouler.data.team === 'GSW') {
      this.gswTeamFouls++;
    } else {
      this.houTeamFouls++;
    }
    const teamFouls = fouler.data.team === 'GSW' ? this.gswTeamFouls : this.houTeamFouls;
    this.emitTeamFouls();

    // Check for 6 personal fouls: Fouled Out / Disqualification!
    if (isFouledOut) {
      sounds.playWhistle();
      this.spawnFloatingStatus(`FOULED OUT! (${fouler.data.name} 6 FOULS)`, fouler.position, '#ef4444');
      this.onRuleViolation?.({
        violation: 'DISQUALIFICATION (6 PERSONAL FOULS)',
        team: fouler.data.team,
        awardedTeam: fouled.data.team,
        description: `${fouler.data.name} has committed their 6th personal foul and is disqualified!`,
      });
    }

    // 1. OFFENSIVE CHARGING FOUL (Turnover, no free throws)
    if (type === 'CHARGING FOUL') {
      sounds.playWhistle();
      this.spawnFloatingStatus(`OFFENSIVE CHARGE ON ${fouler.data.name}`, fouler.position, '#ef4444');
      this.onRuleViolation?.({
        violation: 'OFFENSIVE CHARGING FOUL',
        team: fouler.data.team,
        awardedTeam: fouled.data.team,
        description: `Charge on ${fouler.data.name} (Foul #${fouler.data.personalFouls}). Possession to ${fouled.data.team}.`,
      });
      this.executeInbound(fouled.data.team);
      return;
    }

    // 2. COMMON NON-SHOOTING FOULS (Reach-in / Blocking)
    // If not in the bonus (< 5 team fouls in period) and not an And-One
    if ((type === 'REACH-IN FOUL' || type === 'BLOCKING FOUL') && teamFouls < 5 && !isAndOne) {
      sounds.playWhistle();
      this.spawnFloatingStatus(`PERSONAL FOUL ON ${fouler.data.name}`, fouler.position, '#f59e0b');
      this.onRuleViolation?.({
        violation: type === 'BLOCKING FOUL' ? 'DEFENSIVE BLOCKING FOUL' : 'PERSONAL REACH-IN FOUL',
        team: fouler.data.team,
        awardedTeam: fouled.data.team,
        description: `Common foul on ${fouler.data.name} (Personal #${fouler.data.personalFouls}, Team Foul #${teamFouls}). Side-out inbound to ${fouled.data.team}.`,
      });
      this.executeInbound(fouled.data.team);
      return;
    }

    // 3. SHOOTING FOULS, AND-ONE, OR PENALTY BONUS FOULS (Free Throws Awarded)
    sounds.playWhistle();
    this.ballState = 'FREE_THROW';
    this.activeShot = null;
    this.isChargingShot = false;
    this.ballHolder = null;
    this.ballVel.set(0, 0, 0);

    const isGSW = fouled.data.team === 'GSW';
    const targetRim = isGSW ? this.gswHoopPos.clone() : this.houHoopPos.clone();
    const ftZ = isGSW ? -8.8 : 8.8;

    const actualAttempts = isAndOne ? 1 : attempts;
    const isBonus = (type === 'REACH-IN FOUL' || type === 'BLOCKING FOUL') && teamFouls >= 5;

    this.activeFoul = {
      fouledPlayer: fouled,
      foulerPlayer: fouler,
      foulType: isAndOne ? 'AND-ONE FOUL' : isBonus ? 'BONUS (PENALTY) FOUL' : type,
      attemptsTotal: actualAttempts,
      currentAttempt: 1,
      stage: 'WHISTLE',
      timer: 0,
      shot1Made: false,
      shot2Made: false,
      shot3Made: false,
      hasScoredAttempt1: false,
      hasScoredAttempt2: false,
      hasScoredAttempt3: false,
      isAndOne,
      startPos: new THREE.Vector3(0, 1.35, ftZ + (isGSW ? -0.28 : 0.28)),
      targetRim,
    };

    // Reset temporary player animation flags
    this.players.forEach(p => {
      p.isShootingAnim = false;
      p.isDefendingAnim = false;
      p.isDunking = false;
      p.position.y = 0;
    });

    this.setupFreeThrowLineup(fouled);
    const label = isAndOne ? 'AND-ONE! 1 FREE THROW' : `FOUL! ${actualAttempts} FREE THROWS`;
    this.spawnFloatingStatus(label, fouled.position, '#f59e0b');
    this.emitFoulUI(
      1,
      isAndOne
        ? `AND-ONE! BASKET COUNTS + 1 FREE THROW FOR ${fouled.data.name}`
        : `FOUL ON ${fouler.data.name}! ${actualAttempts} FREE THROW${actualAttempts > 1 ? 'S' : ''} FOR ${fouled.data.name}`,
      'PENDING',
      'PENDING',
      'PENDING'
    );
  }

  private emitFoulUI(
    attempt: number | null,
    statusText?: string,
    shot1?: 'PENDING' | 'MADE' | 'MISSED',
    shot2?: 'PENDING' | 'MADE' | 'MISSED',
    shot3?: 'PENDING' | 'MADE' | 'MISSED'
  ) {
    if (!this.activeFoul || attempt === null) {
      this.onFoulEvent?.(null);
      return;
    }
    const ft = this.activeFoul;
    this.onFoulEvent?.({
      fouledName: ft.fouledPlayer.data.name,
      foulerName: ft.foulerPlayer.data.name,
      foulerPersonalFouls: ft.foulerPlayer.data.personalFouls,
      isFouledOut: ft.foulerPlayer.data.personalFouls >= 6,
      team: ft.fouledPlayer.data.team,
      foulType: ft.foulType,
      attempt,
      attemptsTotal: ft.attemptsTotal,
      statusText: statusText || `FREE THROW ${attempt} OF ${ft.attemptsTotal}`,
      shot1Result: shot1,
      shot2Result: shot2,
      shot3Result: shot3,
    });
  }

  private awardFreeThrowPoint(team: 'GSW' | 'HOU') {
    if (team === 'GSW') {
      this.homeScore += 1;
      this.onScoreUpdate?.(this.homeScore, this.awayScore, 1, 'GSW');
    } else {
      this.awayScore += 1;
      this.onScoreUpdate?.(this.homeScore, this.awayScore, 1, 'HOU');
    }
  }

  private awardPoints(team: 'GSW' | 'HOU', points: number) {
    if (team === 'GSW') {
      this.homeScore += points;
      this.onScoreUpdate?.(this.homeScore, this.awayScore, points, 'GSW');
      this.gswNetWobble = 0.55;
    } else {
      this.awayScore += points;
      this.onScoreUpdate?.(this.homeScore, this.awayScore, points, 'HOU');
      this.houNetWobble = 0.55;
    }
    sounds.playSwish();
    sounds.playCrowdCheer();
  }

  private setupFreeThrowLineup(shooter: PlayerMesh) {
    const isGSW = shooter.data.team === 'GSW';
    const rimZ = isGSW ? -13.0 : 13.0;
    const ftZ = isGSW ? -8.8 : 8.8;
    const laneDir = isGSW ? -1 : 1;

    shooter.position.set(0, 0, ftZ);
    shooter.lookAt(0, 0, rimZ);

    const teammates = this.players.filter(p => p.data.team === shooter.data.team && p !== shooter);
    const opponents = this.players.filter(p => p.data.team !== shooter.data.team);

    const spots = [
      { p: opponents[0], pos: new THREE.Vector3(-2.2, 0, ftZ + laneDir * 2.5) },
      { p: opponents[1], pos: new THREE.Vector3(2.2, 0, ftZ + laneDir * 2.5) },
      { p: teammates[0], pos: new THREE.Vector3(-2.2, 0, ftZ + laneDir * 1.3) },
      { p: teammates[1], pos: new THREE.Vector3(2.2, 0, ftZ + laneDir * 1.3) },
      { p: opponents[2], pos: new THREE.Vector3(-2.2, 0, ftZ + laneDir * 0.1) },
      { p: opponents[3], pos: new THREE.Vector3(2.2, 0, ftZ + laneDir * 0.1) },
      { p: opponents[4], pos: new THREE.Vector3(0, 0, ftZ - laneDir * 3.0) },
      { p: teammates[2], pos: new THREE.Vector3(-4.0, 0, ftZ - laneDir * 2.0) },
      { p: teammates[3], pos: new THREE.Vector3(4.0, 0, ftZ - laneDir * 2.0) },
    ];

    spots.forEach(({ p, pos }) => {
      if (p) {
        p.position.copy(pos);
        p.lookAt(0, 0, rimZ);
        p.lastPos.copy(pos);
      }
    });

    shooter.lastPos.copy(shooter.position);
  }

  private updateFoulSequence(dt: number) {
    if (!this.activeFoul) return;

    const ft = this.activeFoul;
    ft.timer += dt;
    const shooter = ft.fouledPlayer;
    const isGSW = shooter.data.team === 'GSW';
    const rimZ = isGSW ? -13.0 : 13.0;
    const ftZ = isGSW ? -8.8 : 8.8;

    if (ft.stage === 'WHISTLE') {
      this.setupFreeThrowLineup(shooter);
      this.ballPos.set(0, 1.15, ftZ + (isGSW ? -0.22 : 0.22));
      this.ball.position.copy(this.ballPos);

      if (ft.timer >= 1.4) {
        ft.stage = 'ROUTINE_1';
        ft.timer = 0;
        const ftPct = shooter.data.threePointRating >= 90 ? 0.92 : shooter.data.midRangeRating >= 80 ? 0.84 : 0.72;
        ft.shot1Made = Math.random() < ftPct;
        this.emitFoulUI(1, 'FREE THROW 1 OF 2 — PRE-SHOT ROUTINE', 'PENDING', 'PENDING');
      }
    } else if (ft.stage === 'ROUTINE_1') {
      const bounceProg = (ft.timer % 0.8) / 0.8;
      if (ft.timer < 1.6) {
        const bounceY = this.BALL_RADIUS + 0.95 * Math.abs(Math.sin(bounceProg * Math.PI));
        this.ballPos.set(0, bounceY, ftZ + (isGSW ? -0.25 : 0.25));
        if (ft.timer > 0.35 && ft.timer < 0.42) sounds.playDribble();
        if (ft.timer > 1.15 && ft.timer < 1.22) sounds.playDribble();

        shooter.rightArmPivot.rotation.x = -0.3 + (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.35;
        shooter.rightElbowPivot.rotation.x = -0.25 - (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.85;
        shooter.leftArmPivot.rotation.x = -0.5;
        shooter.leftElbowPivot.rotation.x = -0.4;
      } else {
        // Deep gather crouch
        this.ballPos.set(0, 1.25, ftZ + (isGSW ? -0.28 : 0.28));
        shooter.leftLegPivot.rotation.x = 0.22;
        shooter.rightLegPivot.rotation.x = 0.22;
        shooter.leftKneePivot.rotation.x = 0.48;
        shooter.rightKneePivot.rotation.x = 0.48;
        shooter.leftArmPivot.rotation.x = -1.1;
        shooter.leftElbowPivot.rotation.x = -1.35;
        shooter.rightArmPivot.rotation.x = -1.1;
        shooter.rightElbowPivot.rotation.x = -1.45;
      }
      this.ball.position.copy(this.ballPos);

      if (ft.timer >= 2.2) {
        ft.stage = 'SHOT_1';
        ft.timer = 0;
        ft.startPos.copy(this.ballPos);
        shooter.leftKneePivot.rotation.x = 0.05;
        shooter.rightKneePivot.rotation.x = 0.05;
        shooter.rightArmPivot.rotation.x = -2.75;
        shooter.rightElbowPivot.rotation.x = -0.12;
        shooter.rightHandMesh.rotation.x = 0.95;
        shooter.leftArmPivot.rotation.x = -2.0;
        shooter.leftElbowPivot.rotation.x = -0.45;
        this.emitFoulUI(1, 'FREE THROW 1 IN FLIGHT...', 'PENDING', 'PENDING');
      }
    } else if (ft.stage === 'SHOT_1') {
      const flightDuration = 0.95;
      const prog = Math.min(1.0, ft.timer / flightDuration);

      const targetPos = ft.targetRim.clone();
      if (!ft.shot1Made) {
        targetPos.z += isGSW ? -0.22 : 0.22;
        targetPos.y += 0.05;
      }
      this.ballPos.lerpVectors(ft.startPos, targetPos, prog);
      this.ballPos.y += Math.sin(prog * Math.PI) * 1.65;
      this.ball.position.copy(this.ballPos);
      this.ball.rotation.x -= dt * 14;

      if (prog >= 1.0 && ft.timer >= flightDuration && !ft.hasScoredAttempt1) {
        ft.hasScoredAttempt1 = true;
        if (ft.shot1Made) {
          sounds.playSwish();
          sounds.playCrowdCheer();
          if (isGSW) this.gswNetWobble = 1.0; else this.houNetWobble = 1.0;
          this.awardFreeThrowPoint(shooter.data.team);
          this.spawnFloatingStatus('+1 FREE THROW', ft.targetRim, '#10b981');
          this.emitFoulUI(
            1,
            ft.attemptsTotal === 1 ? 'AND-ONE FREE THROW: GOOD!' : 'FREE THROW 1: GOOD! (1/2)',
            'MADE',
            'PENDING'
          );
        } else {
          sounds.playRimClang();
          this.spawnFloatingStatus('MISSED', ft.targetRim, '#ef4444');
          this.emitFoulUI(
            1,
            ft.attemptsTotal === 1 ? 'AND-ONE FREE THROW: MISSED' : 'FREE THROW 1: MISSED (0/2)',
            'MISSED',
            'PENDING'
          );
        }
      }

      if (ft.timer >= 1.8) {
        if (ft.attemptsTotal === 1) {
          // Completed And-One (1 attempt)
          const defendingTeam = shooter.data.team === 'GSW' ? 'HOU' : 'GSW';
          shooter.rightHandMesh.rotation.x = 0;
          if (ft.shot1Made) {
            this.emitFoulUI(null);
            this.activeFoul = null;
            this.executeInbound(defendingTeam);
          } else {
            this.emitFoulUI(null);
            this.activeFoul = null;
            this.ballState = 'REBOUND';
            this.activeShot = null;
            this.reboundMarker.position.set(0, 0.02, rimZ);
            this.reboundMarker.visible = true;
            this.ballVel.set((Math.random() - 0.5) * 3, 2.8, isGSW ? 2.5 : -2.5);
            this.shotClock = 24.0;
          }
          return;
        }

        ft.stage = 'RESET_2';
        ft.timer = 0;
        shooter.rightHandMesh.rotation.x = 0;
        this.emitFoulUI(2, 'FREE THROW 2 OF 2', ft.shot1Made ? 'MADE' : 'MISSED', 'PENDING');
      }
    } else if (ft.stage === 'RESET_2') {
      this.setupFreeThrowLineup(shooter);
      this.ballPos.set(0, 1.15, ftZ + (isGSW ? -0.22 : 0.22));
      this.ball.position.copy(this.ballPos);
      shooter.leftArmPivot.rotation.x = -0.5;
      shooter.rightArmPivot.rotation.x = -0.5;
      shooter.leftElbowPivot.rotation.x = 0;
      shooter.rightElbowPivot.rotation.x = 0;
      shooter.leftKneePivot.rotation.x = 0;
      shooter.rightKneePivot.rotation.x = 0;
      shooter.rightHandMesh.rotation.x = 0;

      if (ft.timer >= 1.0) {
        ft.stage = 'ROUTINE_2';
        ft.timer = 0;
        const ftPct = shooter.data.threePointRating >= 90 ? 0.92 : shooter.data.midRangeRating >= 80 ? 0.84 : 0.72;
        ft.shot2Made = Math.random() < ftPct;
        this.emitFoulUI(2, 'FREE THROW 2 OF 2 — PRE-SHOT ROUTINE', ft.shot1Made ? 'MADE' : 'MISSED', 'PENDING');
      }
    } else if (ft.stage === 'ROUTINE_2') {
      const bounceProg = (ft.timer % 0.8) / 0.8;
      if (ft.timer < 1.6) {
        const bounceY = this.BALL_RADIUS + 0.95 * Math.abs(Math.sin(bounceProg * Math.PI));
        this.ballPos.set(0, bounceY, ftZ + (isGSW ? -0.25 : 0.25));
        if (ft.timer > 0.35 && ft.timer < 0.42) sounds.playDribble();
        if (ft.timer > 1.15 && ft.timer < 1.22) sounds.playDribble();

        shooter.rightArmPivot.rotation.x = -0.3 + (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.35;
        shooter.rightElbowPivot.rotation.x = -0.25 - (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.85;
        shooter.leftArmPivot.rotation.x = -0.5;
        shooter.leftElbowPivot.rotation.x = -0.4;
      } else {
        this.ballPos.set(0, 1.25, ftZ + (isGSW ? -0.28 : 0.28));
        shooter.leftLegPivot.rotation.x = 0.22;
        shooter.rightLegPivot.rotation.x = 0.22;
        shooter.leftKneePivot.rotation.x = 0.48;
        shooter.rightKneePivot.rotation.x = 0.48;
        shooter.leftArmPivot.rotation.x = -1.1;
        shooter.leftElbowPivot.rotation.x = -1.35;
        shooter.rightArmPivot.rotation.x = -1.1;
        shooter.rightElbowPivot.rotation.x = -1.45;
      }
      this.ball.position.copy(this.ballPos);

      if (ft.timer >= 2.2) {
        ft.stage = 'SHOT_2';
        ft.timer = 0;
        ft.startPos.copy(this.ballPos);
        shooter.leftKneePivot.rotation.x = 0.05;
        shooter.rightKneePivot.rotation.x = 0.05;
        shooter.rightArmPivot.rotation.x = -2.75;
        shooter.rightElbowPivot.rotation.x = -0.12;
        shooter.rightHandMesh.rotation.x = 0.95;
        shooter.leftArmPivot.rotation.x = -2.0;
        shooter.leftElbowPivot.rotation.x = -0.45;
        this.emitFoulUI(2, 'FREE THROW 2 IN FLIGHT...', ft.shot1Made ? 'MADE' : 'MISSED', 'PENDING');
      }
    } else if (ft.stage === 'SHOT_2') {
      const flightDuration = 0.95;
      const prog = Math.min(1.0, ft.timer / flightDuration);

      const targetPos = ft.targetRim.clone();
      if (!ft.shot2Made) {
        targetPos.z += isGSW ? -0.22 : 0.22;
        targetPos.y += 0.05;
      }
      this.ballPos.lerpVectors(ft.startPos, targetPos, prog);
      this.ballPos.y += Math.sin(prog * Math.PI) * 1.65;
      this.ball.position.copy(this.ballPos);
      this.ball.rotation.x -= dt * 14;

      if (prog >= 1.0 && ft.timer >= flightDuration && !ft.hasScoredAttempt2) {
        ft.hasScoredAttempt2 = true;
        if (ft.shot2Made) {
          sounds.playSwish();
          sounds.playCrowdCheer();
          if (isGSW) this.gswNetWobble = 1.0; else this.houNetWobble = 1.0;
          this.awardFreeThrowPoint(shooter.data.team);
          this.spawnFloatingStatus('+1 FREE THROW', ft.targetRim, '#10b981');
          this.emitFoulUI(2, 'FREE THROW 2: GOOD!', ft.shot1Made ? 'MADE' : 'MISSED', 'MADE');
        } else {
          sounds.playRimClang();
          this.spawnFloatingStatus('MISSED', ft.targetRim, '#ef4444');
          this.emitFoulUI(2, 'FREE THROW 2: MISSED — LIVE BALL!', ft.shot1Made ? 'MADE' : 'MISSED', 'MISSED');
        }
      }

      if (ft.timer >= 1.8) {
        if (ft.attemptsTotal === 3) {
          ft.stage = 'RESET_3';
          ft.timer = 0;
          shooter.rightHandMesh.rotation.x = 0;
          this.emitFoulUI(
            3,
            'FREE THROW 3 OF 3',
            ft.shot1Made ? 'MADE' : 'MISSED',
            ft.shot2Made ? 'MADE' : 'MISSED',
            'PENDING'
          );
          return;
        }

        const defendingTeam = shooter.data.team === 'GSW' ? 'HOU' : 'GSW';
        if (ft.shot2Made) {
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.executeInbound(defendingTeam);
        } else {
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.ballState = 'REBOUND';
          this.activeShot = null;
          this.reboundMarker.position.set(0, 0.02, rimZ);
          this.reboundMarker.visible = true;
          this.ballVel.set((Math.random() - 0.5) * 3, 2.8, isGSW ? 2.5 : -2.5);
          this.shotClock = 24.0;
        }
      }
    } else if (ft.stage === 'RESET_3') {
      this.setupFreeThrowLineup(shooter);
      this.ballPos.set(0, 1.15, ftZ + (isGSW ? -0.22 : 0.22));
      this.ball.position.copy(this.ballPos);
      shooter.leftArmPivot.rotation.x = -0.5;
      shooter.rightArmPivot.rotation.x = -0.5;
      shooter.leftElbowPivot.rotation.x = 0;
      shooter.rightElbowPivot.rotation.x = 0;
      shooter.leftKneePivot.rotation.x = 0;
      shooter.rightKneePivot.rotation.x = 0;
      shooter.rightHandMesh.rotation.x = 0;

      if (ft.timer >= 1.0) {
        ft.stage = 'ROUTINE_3';
        ft.timer = 0;
        const ftPct = shooter.data.threePointRating >= 90 ? 0.92 : shooter.data.midRangeRating >= 80 ? 0.84 : 0.72;
        ft.shot3Made = Math.random() < ftPct;
        this.emitFoulUI(
          3,
          'FREE THROW 3 OF 3 — PRE-SHOT ROUTINE',
          ft.shot1Made ? 'MADE' : 'MISSED',
          ft.shot2Made ? 'MADE' : 'MISSED',
          'PENDING'
        );
      }
    } else if (ft.stage === 'ROUTINE_3') {
      const bounceProg = (ft.timer % 0.8) / 0.8;
      if (ft.timer < 1.6) {
        const bounceY = this.BALL_RADIUS + 0.95 * Math.abs(Math.sin(bounceProg * Math.PI));
        this.ballPos.set(0, bounceY, ftZ + (isGSW ? -0.25 : 0.25));
        if (ft.timer > 0.35 && ft.timer < 0.42) sounds.playDribble();
        if (ft.timer > 1.15 && ft.timer < 1.22) sounds.playDribble();

        shooter.rightArmPivot.rotation.x = -0.3 + (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.35;
        shooter.rightElbowPivot.rotation.x = -0.25 - (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.85;
        shooter.leftArmPivot.rotation.x = -0.5;
        shooter.leftElbowPivot.rotation.x = -0.4;
      } else {
        this.ballPos.set(0, 1.25, ftZ + (isGSW ? -0.28 : 0.28));
        shooter.leftLegPivot.rotation.x = 0.22;
        shooter.rightLegPivot.rotation.x = 0.22;
        shooter.leftKneePivot.rotation.x = 0.48;
        shooter.rightKneePivot.rotation.x = 0.48;
        shooter.leftArmPivot.rotation.x = -1.1;
        shooter.leftElbowPivot.rotation.x = -1.35;
        shooter.rightArmPivot.rotation.x = -1.1;
        shooter.rightElbowPivot.rotation.x = -1.45;
      }
      this.ball.position.copy(this.ballPos);

      if (ft.timer >= 2.2) {
        ft.stage = 'SHOT_3';
        ft.timer = 0;
        ft.startPos.copy(this.ballPos);
        shooter.leftKneePivot.rotation.x = 0.05;
        shooter.rightKneePivot.rotation.x = 0.05;
        shooter.rightArmPivot.rotation.x = -2.75;
        shooter.rightElbowPivot.rotation.x = -0.12;
        shooter.rightHandMesh.rotation.x = 0.95;
        shooter.leftArmPivot.rotation.x = -2.0;
        shooter.leftElbowPivot.rotation.x = -0.45;
        this.emitFoulUI(
          3,
          'FREE THROW 3 IN FLIGHT...',
          ft.shot1Made ? 'MADE' : 'MISSED',
          ft.shot2Made ? 'MADE' : 'MISSED',
          'PENDING'
        );
      }
    } else if (ft.stage === 'SHOT_3') {
      const flightDuration = 0.95;
      const prog = Math.min(1.0, ft.timer / flightDuration);

      const targetPos = ft.targetRim.clone();
      if (!ft.shot3Made) {
        targetPos.z += isGSW ? -0.22 : 0.22;
        targetPos.y += 0.05;
      }
      this.ballPos.lerpVectors(ft.startPos, targetPos, prog);
      this.ballPos.y += Math.sin(prog * Math.PI) * 1.65;
      this.ball.position.copy(this.ballPos);
      this.ball.rotation.x -= dt * 14;

      if (prog >= 1.0 && ft.timer >= flightDuration && !ft.hasScoredAttempt3) {
        ft.hasScoredAttempt3 = true;
        if (ft.shot3Made) {
          sounds.playSwish();
          sounds.playCrowdCheer();
          if (isGSW) this.gswNetWobble = 1.0; else this.houNetWobble = 1.0;
          this.awardFreeThrowPoint(shooter.data.team);
          this.spawnFloatingStatus('+1 FREE THROW', ft.targetRim, '#10b981');
          this.emitFoulUI(
            3,
            'FREE THROW 3: GOOD!',
            ft.shot1Made ? 'MADE' : 'MISSED',
            ft.shot2Made ? 'MADE' : 'MISSED',
            'MADE'
          );
        } else {
          sounds.playRimClang();
          this.spawnFloatingStatus('MISSED', ft.targetRim, '#ef4444');
          this.emitFoulUI(
            3,
            'FREE THROW 3: MISSED — LIVE BALL!',
            ft.shot1Made ? 'MADE' : 'MISSED',
            ft.shot2Made ? 'MADE' : 'MISSED',
            'MISSED'
          );
        }
      }

      if (ft.timer >= 1.8) {
        const defendingTeam = shooter.data.team === 'GSW' ? 'HOU' : 'GSW';
        if (ft.shot3Made) {
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.executeInbound(defendingTeam);
        } else {
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.ballState = 'REBOUND';
          this.activeShot = null;
          this.reboundMarker.position.set(0, 0.02, rimZ);
          this.reboundMarker.visible = true;
          this.ballVel.set((Math.random() - 0.5) * 3, 2.8, isGSW ? 2.5 : -2.5);
          this.shotClock = 24.0;
        }
      }
    }
  }

  public cycleControlledPlayer() {
    const teammates = this.players.filter(p => p.data.team === 'GSW' && p !== this.controlledPlayer);
    if (teammates.length > 0) {
      this.setControlledPlayer(teammates[0]);
    }
  }

  // --------------------------------------------------------------------------
  // SHOT TRAJECTORIES, DUNKS & JUMP SHOTS
  // --------------------------------------------------------------------------
  private executeShot(shooter: PlayerMesh, holdDuration: number) {
    if (this.ballHolder !== shooter) return;

    const isGSW = shooter.data.team === 'GSW';
    const targetHoop = isGSW ? this.gswHoopPos : this.houHoopPos;
    const backboardZ = isGSW ? -13.38 : 13.38;

    const distToHoop = new THREE.Vector2(
      targetHoop.x - shooter.position.x,
      targetHoop.z - shooter.position.z
    ).length();
    const isThree = distToHoop > 6.75;
    const points = isThree ? 3 : 2;

    // Check if close enough for SLAM DUNK!
    const isDunk = distToHoop <= 3.6 && !isThree;

    if (isDunk) {
      shooter.isDunking = true;
      shooter.dunkAnimTimer = 0;
    } else {
      shooter.isShootingAnim = true;
      shooter.shootAnimTimer = 0;
    }

    this.ballHolder = null;
    this.ballState = 'SHOT';
    this.floorBounceCount = 0;
    this.isBallRolling = false;
    this.rimNearTimer = 0;
    this.rimBounceCount = 0;
    this.onPossessionChange?.(false);

    const ideal = 0.65;
    const diff = Math.abs(holdDuration - ideal);
    const isGreen = diff < 0.055 || isDunk;

    const defender = this.getNearestDefender(shooter);
    const defDist = defender ? defender.position.distanceTo(shooter.position) : 99;
    const isContested = defDist < 1.8;

    let willMake = false;
    let quality = 'LATE';

    if (isDunk) {
      willMake = true;
      quality = 'SLAM DUNK!';
    } else if (isGreen) {
      willMake = true;
      quality = 'GREEN RELEASE! PERFECT';
      sounds.playGreenChime();
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
      const releaseRatio = Math.min(1.15, holdDuration / 0.65);
      this.onShotMeterUpdate?.({
        value: releaseRatio,
        isCharging: false,
        isGreen,
        isFrozen: true,
        quality,
      });
    }

    const shotDir = new THREE.Vector3(
      targetHoop.x - shooter.position.x,
      0,
      targetHoop.z - shooter.position.z
    ).normalize();
    const sideDir = new THREE.Vector3(-shotDir.z, 0, shotDir.x);

    const targetPoint = targetHoop.clone();

    if (isDunk) {
      // Slam dunk slams down through the rim
      targetPoint.set(targetHoop.x, this.RIM_HEIGHT - 0.12, targetHoop.z);
    } else if (isGreen) {
      // Perfect green release: direct center swish
      targetPoint.set(targetHoop.x, this.RIM_HEIGHT + 0.02, targetHoop.z);
    } else if (willMake) {
      if (Math.random() < 0.22 && !isThree) {
        // High-percentage bank shot off backboard
        targetPoint.set(
          targetHoop.x + (Math.random() - 0.5) * 0.1,
          this.RIM_HEIGHT + 0.32,
          backboardZ + (isGSW ? 0.08 : -0.08)
        );
      } else {
        // Clean swish through the hoop opening
        targetPoint.set(
          targetHoop.x + (Math.random() - 0.5) * 0.04,
          this.RIM_HEIGHT + 0.02,
          targetHoop.z + (Math.random() - 0.5) * 0.04
        );
      }
    } else {
      if (isContested) {
        const sideOffset = (Math.random() > 0.5 ? 1 : -1) * (this.RIM_RADIUS * 1.05);
        targetPoint.addScaledVector(sideDir, sideOffset);
        targetPoint.addScaledVector(shotDir, -this.RIM_RADIUS * 0.4);
      } else if (holdDuration < ideal) {
        targetPoint.addScaledVector(shotDir, -this.RIM_RADIUS * 1.15);
      } else {
        if (Math.random() < 0.4) {
          targetPoint.set(
            targetHoop.x + (Math.random() - 0.5) * 0.25,
            this.RIM_HEIGHT + 0.25,
            backboardZ + (isGSW ? 0.05 : -0.05)
          );
        } else {
          targetPoint.addScaledVector(shotDir, this.RIM_RADIUS * 1.15);
        }
      }
    }

    const startElevation = isDunk ? 3.35 : 2.05;
    this.ballPos.set(shooter.position.x, startElevation, shooter.position.z).addScaledVector(shotDir, 0.28);
    this.ballPrevPos.copy(this.ballPos);
    this.ball.position.copy(this.ballPos);

    const flightDuration = isDunk ? 0.38 : THREE.MathUtils.clamp(0.88 + distToHoop * 0.035, 0.95, 1.18);
    this.ballVel.x = (targetPoint.x - this.ballPos.x) / flightDuration;
    this.ballVel.z = (targetPoint.z - this.ballPos.z) / flightDuration;
    const deltaY = targetPoint.y - this.ballPos.y;
    this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * flightDuration * flightDuration) / flightDuration;

    this.activeShot = {
      isGreen,
      willMake,
      isDunk,
      points,
      shooter,
      shooterTeam: shooter.data.team,
      hoopPos: targetHoop.clone(),
      backboardZ,
      hasScored: false,
      hasHitRim: false,
      hasHitFloor: false,
      rattlePhase: 0,
    };
  }

  // --------------------------------------------------------------------------
  // PASSES
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
  // BALLISTICS & DYNAMIC DRIBBLE
  // --------------------------------------------------------------------------
  private updateBallPhysics(dt: number) {
    if (this.ballState === 'FREE_THROW') {
      this.updateFoulSequence(dt);
      return;
    }

    if (this.ballState === 'DRIBBLE' && this.ballHolder) {
      const holder = this.ballHolder;

      // Track smoothed player movement speed
      const vel = new THREE.Vector3().subVectors(holder.position, holder.lastPos);
      vel.y = 0;
      const rawSpeed = vel.length() / Math.max(dt, 0.001);
      holder.currentSpeed = THREE.MathUtils.lerp(holder.currentSpeed, rawSpeed, dt * 7.5);

      // Dynamic Dribble Frequency based on speed (Idle: ~9.5 rad/s, Jog: ~13.5 rad/s, Sprint: ~18.5 rad/s)
      const speedFrac = THREE.MathUtils.clamp(holder.currentSpeed / 5.2, 0, 1);
      const isSprinting = this.isSprinting && holder === this.controlledPlayer;
      const dribbleSpeed = isSprinting
        ? 18.5
        : THREE.MathUtils.lerp(9.5, 14.5, speedFrac);

      holder.dribbleCycle += dt * dribbleSpeed;

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(holder.quaternion);

      // Bounce math with sharp floor contact and smooth apex hang
      const sinVal = Math.sin(holder.dribbleCycle);
      const bounceNorm = Math.abs(sinVal);

      // Dribble height rises with speed (Idle: 0.80m waist/knee, Sprint: 1.02m pocket)
      const maxHandY = THREE.MathUtils.lerp(0.80, 1.02, speedFrac);
      const dribbleY = this.BALL_RADIUS + (maxHandY - this.BALL_RADIUS) * Math.pow(bounceNorm, 1.35);

      // Floor bounce impact audio
      if (this.prevDribbleSine > 0 && sinVal <= 0) {
        sounds.playDribble();
      }
      this.prevDribbleSine = sinVal;

      // Smooth Crossover Blending between Left and Right hands (-1.0 to 1.0)
      const targetBlend = holder.dribbleHand === 'left' ? -1.0 : 1.0;
      holder.crossoverBlend = THREE.MathUtils.lerp(holder.crossoverBlend, targetBlend, dt * 8.5);

      // Forward push increases with speed (Idle: 0.22m, Sprint push-ahead: 0.46m)
      const forwardPush = THREE.MathUtils.lerp(0.22, 0.46, speedFrac);
      // Lateral offset: -0.38m (left hand) to +0.38m (right hand)
      const lateralOffset = holder.crossoverBlend * 0.38;

      const offset = right.clone().multiplyScalar(lateralOffset).add(forward.clone().multiplyScalar(forwardPush));

      this.ballPos.copy(holder.position).add(offset);
      this.ballPos.y = dribbleY;
      this.ballPrevPos.copy(this.ballPos);
      this.ball.position.copy(this.ballPos);
      this.ball.rotation.x += dt * (8 + speedFrac * 10);

      // Dynamic Arm & Elbow Articulation:
      const isLeft = holder.crossoverBlend < 0;
      const primaryArm = isLeft ? holder.leftArmPivot : holder.rightArmPivot;
      const primaryElbow = isLeft ? holder.leftElbowPivot : holder.rightElbowPivot;
      const primaryHand = isLeft ? holder.leftHandMesh : holder.rightHandMesh;
      const offArm = isLeft ? holder.rightArmPivot : holder.leftArmPivot;
      const offElbow = isLeft ? holder.rightElbowPivot : holder.leftElbowPivot;

      primaryArm.rotation.x = -0.32 + bounceNorm * 0.28;
      primaryArm.rotation.z = (isLeft ? -0.22 : 0.22) * (1 - speedFrac * 0.3);

      // Elbow articulates down on push and bends up on catch:
      primaryElbow.rotation.x = -0.25 - (1 - bounceNorm) * 0.85;
      primaryHand.rotation.x = -0.15 + bounceNorm * 0.35;

      if (!holder.isShootingAnim && !holder.isDunking) {
        if (speedFrac < 0.2) {
          // Off-hand protective forearm shield in stationary triple-threat / pound dribble
          offArm.rotation.x = -0.72;
          offArm.rotation.z = isLeft ? 0.38 : -0.38;
          offElbow.rotation.x = -1.25;
        } else {
          // Running stride arm swing with natural elbow flexion
          const swing = Math.sin(holder.runCycle) * 0.65;
          offArm.rotation.x = isLeft ? swing * 0.75 : -swing * 0.75;
          offArm.rotation.z = isLeft ? 0.15 : -0.15;
          offElbow.rotation.x = -0.75 - Math.abs(swing) * 0.4;
        }
      }
      return;
    }

    this.ballPrevPos.copy(this.ballPos);

    if (!this.isBallRolling) {
      this.ballVel.y += this.GRAVITY * dt;
    }

    this.ballPos.addScaledVector(this.ballVel, dt);

    if (this.ballState === 'SHOT') {
      this.ball.rotation.x -= dt * (Math.PI * 4);
    } else if (this.isBallRolling) {
      const speed = new THREE.Vector2(this.ballVel.x, this.ballVel.z).length();
      if (speed > 0.01) {
        this.ball.rotation.x += (speed / this.BALL_RADIUS) * dt;
      }
    }

    this.checkBackboardCollisions();
    this.checkRimCollisions(dt);
    this.checkScoringPlaneCrossing();
    this.checkAntiStuckRule(dt);
    this.checkFloorCollision(dt);

    if ((this.ballState === 'PASS' || this.ballState === 'BOUNCE_PASS') && this.passTargetPlayer) {
      const distToReceiver = this.ballPos.distanceTo(this.passTargetPlayer.position);
      if (distToReceiver < 0.85 && this.ballPos.y > 0.35) {
        this.ballHolder = this.passTargetPlayer;
        this.ballState = 'DRIBBLE';
        this.passTargetPlayer = null;
        if (this.ballHolder.data.team === 'GSW') {
          this.setControlledPlayer(this.ballHolder);
          this.onPossessionChange?.(true);
        } else {
          this.onPossessionChange?.(false);
        }
      }
    }

    // Rebound target floor decal
    if (this.ballState === 'REBOUND') {
      if (this.ballPos.y > 0.3) {
        this.reboundMarker.position.set(this.ballPos.x, 0.02, this.ballPos.z);
        this.reboundMarker.visible = true;
      } else {
        this.reboundMarker.visible = false;
      }
      this.updateReboundPursuit(dt);
    } else {
      this.reboundMarker.visible = false;
    }

    // Out-of-bounds loose ball check
    if ((this.ballState === 'REBOUND' || this.isBallRolling) && this.ballPos.y <= 0.65) {
      if (Math.abs(this.ballPos.x) > 7.15 || Math.abs(this.ballPos.z) > 13.80) {
        sounds.playWhistle();
        this.spawnFloatingStatus('OUT OF BOUNDS', this.ballPos, '#ff3344');
        const nextTeam = this.activeShot?.shooterTeam === 'GSW' ? 'HOU' : 'GSW';
        this.executeInbound(nextTeam);
      }
    }

    if (this.ballState === 'MADE_DROP') {
      this.postScoreTimer += dt;
      if (this.postScoreTimer > 1.2 && this.floorBounceCount >= 1 && this.nextPossessionTeam) {
        this.executeInbound(this.nextPossessionTeam);
        this.nextPossessionTeam = null;
        this.postScoreTimer = 0;
      }
    }

    this.ball.position.copy(this.ballPos);
  }

  // --------------------------------------------------------------------------
  // BACKBOARD & RIM COLLISIONS
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
          sounds.playBackboard();
          if (this.activeShot) {
            this.activeShot.hasHitRim = true;
          }
          this.ballVel.z = -this.ballVel.z * 0.65;
          this.ballVel.x *= 0.85;
          this.ballVel.y *= 0.85;
          this.ballPos.z = h.zBB + (h.isGSW ? (this.BALL_RADIUS + 0.025) : -(this.BALL_RADIUS + 0.025));
        }
      }
    });
  }

  private checkRimCollisions(dt: number) {
    if (this.activeShot?.isGreen && !this.activeShot.hasScored) return;

    const hoops = [this.gswHoopPos, this.houHoopPos];

    hoops.forEach(hoop => {
      const dx = this.ballPos.x - hoop.x;
      const dz = this.ballPos.z - hoop.z;
      const distXZ = Math.sqrt(dx * dx + dz * dz);

      if (Math.abs(this.ballPos.y - this.RIM_HEIGHT) < 0.4 && distXZ < 0.45) {
        this.rimNearTimer += dt;
      }

      if (distXZ < 0.001) return;

      const ringX = hoop.x + (dx / distXZ) * this.RIM_RADIUS;
      const ringY = this.RIM_HEIGHT;
      const ringZ = hoop.z + (dz / distXZ) * this.RIM_RADIUS;

      const distToRing = Math.hypot(this.ballPos.x - ringX, this.ballPos.y - ringY, this.ballPos.z - ringZ);
      const contactDist = this.BALL_RADIUS + this.RIM_TUBE_RADIUS;

      if (distToRing < contactDist) {
        const nx = (this.ballPos.x - ringX) / distToRing;
        const ny = (this.ballPos.y - ringY) / distToRing;
        const nz = (this.ballPos.z - ringZ) / distToRing;

        const vDotN = this.ballVel.x * nx + this.ballVel.y * ny + this.ballVel.z * nz;

        if (vDotN < 0) {
          this.rimBounceCount++;
          sounds.playRimClang();

          if (this.activeShot) {
            this.activeShot.hasHitRim = true;
            // Real-world NBA rule: Contact with rim resets shot clock
            if (this.shotClock < 14.0) {
              this.shotClock = 14.0;
            }
          }

          this.ballVel.y = Math.abs(this.ballVel.y) * 0.6 + 0.8;
          this.ballVel.x = (this.ballVel.x - 1.5 * vDotN * nx) * 0.5;
          this.ballVel.z = (this.ballVel.z - 1.5 * vDotN * nz) * 0.5;

          this.ballVel.x += (Math.random() - 0.5) * 0.35;
          this.ballVel.z += (Math.random() - 0.5) * 0.35;

          this.ballPos.set(
            ringX + nx * (contactDist + 0.004),
            ringY + ny * (contactDist + 0.004),
            ringZ + nz * (contactDist + 0.004)
          );

          if (this.activeShot && !this.activeShot.hasScored) {
            const toCenter = new THREE.Vector2(hoop.x - this.ballPos.x, hoop.z - this.ballPos.z);

            if (this.activeShot.willMake) {
              this.activeShot.rattlePhase++;
              if (this.activeShot.rattlePhase >= 2 || distXZ < this.RIM_RADIUS) {
                toCenter.normalize();
                this.ballVel.x += toCenter.x * 0.65;
                this.ballVel.z += toCenter.y * 0.65;
                this.ballVel.y = THREE.MathUtils.clamp(this.ballVel.y, -0.6, 0.8);
              }
            } else {
              toCenter.normalize();
              this.ballVel.x -= toCenter.x * 0.95;
              this.ballVel.z -= toCenter.y * 0.95;
              this.ballVel.y += 0.5;
              this.ballState = 'REBOUND';
            }
          }
        }
      }
    });
  }

  private checkScoringPlaneCrossing() {
    if (this.activeShot?.hasScored || this.ballState === 'MADE_DROP') return;

    const hoops = [
      { pos: this.gswHoopPos, team: 'GSW', netWobble: 'gsw' },
      { pos: this.houHoopPos, team: 'HOU', netWobble: 'hou' },
    ];

    for (const h of hoops) {
      const dx = this.ballPos.x - h.pos.x;
      const dz = this.ballPos.z - h.pos.z;
      const distXZ = Math.hypot(dx, dz);

      // Robust horizontal cylinder detection: ball center within rim radius + tolerance
      const insideCylinder = distXZ <= (this.RIM_RADIUS + 0.02);

      // Ball is descending downwards
      const isDescending = this.ballVel.y < 0.05 || this.ballPos.y < this.ballPrevPos.y;

      // Vertical scoring band: passing down through the rim opening (between 2.65m and 3.16m)
      const inHeightZone = this.ballPos.y <= (this.RIM_HEIGHT + 0.08) && this.ballPos.y >= (this.RIM_HEIGHT - 0.45);
      const crossedDownward = this.ballPrevPos.y >= (this.RIM_HEIGHT - 0.06) && this.ballPos.y <= (this.RIM_HEIGHT + 0.08);

      if (insideCylinder && isDescending && (inHeightZone || crossedDownward)) {
        const isDunk = this.activeShot?.isDunk || false;
        const isGreen = this.activeShot?.isGreen || false;
        const points = this.activeShot?.points || 2;
        const scoringTeam: 'GSW' | 'HOU' = (this.activeShot?.shooterTeam) || (h.team === 'GSW' ? 'GSW' : 'HOU');

        if (this.activeShot) {
          this.activeShot.hasScored = true;
        }

        this.ballState = 'MADE_DROP';
        this.floorBounceCount = 0;
        this.postScoreTimer = 0;

        if (scoringTeam === 'GSW') {
          this.homeScore += points;
        } else {
          this.awayScore += points;
        }
        this.onScoreUpdate?.(this.homeScore, this.awayScore, points, scoringTeam);

        // Audio & Visual celebratory feedback
        if (isDunk) {
          sounds.playDunk();
        } else {
          sounds.playSwish();
        }
        sounds.playCrowdCheer();

        this.spawnFloatingScore(points, h.pos);
        if (isGreen) {
          this.spawnGreenConfetti(h.pos);
        }

        if (h.netWobble === 'gsw') {
          this.gswNetWobble = 0.45;
        } else {
          this.houNetWobble = 0.45;
        }

        // Guide ball down cleanly through net throat
        this.ballPos.x = h.pos.x * 0.75 + this.ballPos.x * 0.25;
        this.ballPos.z = h.pos.z * 0.75 + this.ballPos.z * 0.25;
        this.ballVel.x *= 0.25;
        this.ballVel.z *= 0.25;
        this.ballVel.y = -2.2;

        this.nextPossessionTeam = scoringTeam === 'GSW' ? 'HOU' : 'GSW';
        this.shotClock = 24.0;
        break;
      }
    }
  }

  private checkAntiStuckRule(dt: number) {
    if (this.rimNearTimer > 1.5) {
      this.rimNearTimer = 0;
      const hoop = this.activeShot?.hoopPos || this.gswHoopPos;
      const dx = this.ballPos.x - hoop.x;
      const dz = this.ballPos.z - hoop.z;
      const distXZ = Math.hypot(dx, dz);

      if (distXZ < this.RIM_RADIUS * 0.75 && Math.abs(this.ballVel.y) < 0.6) {
        this.ballPos.set(hoop.x, this.RIM_HEIGHT - 0.05, hoop.z);
        this.ballVel.set(0, -1.8, this.activeShot?.shooterTeam === 'GSW' ? -0.3 : 0.3);
      } else {
        const out = new THREE.Vector2(dx, dz).normalize();
        this.ballVel.set(out.x * 2.2, 1.2, out.y * 2.2);
        this.ballState = 'REBOUND';
      }
    }
  }

  private checkFloorCollision(dt: number) {
    if (this.ballPos.y <= this.BALL_RADIUS) {
      this.ballPos.y = this.BALL_RADIUS;

      if (this.ballState === 'SHOT' && !this.activeShot?.hasScored) {
        this.ballState = 'REBOUND';
        if (this.rimBounceCount === 0) {
          // Ball hit the floor without touching the rim: Airball
          this.spawnFloatingStatus('AIRBALL!', this.ballPos, '#94a3b8');
        }
      }

      if (Math.abs(this.ballVel.y) > 0.45 && this.floorBounceCount < 4) {
        this.ballVel.y = -this.ballVel.y * 0.75;
        this.ballVel.x *= 0.80;
        this.ballVel.z *= 0.80;
        this.floorBounceCount++;
        sounds.playDribble();
      } else {
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

  private updateReboundPursuit(dt: number) {
    const sortedGSW = this.players
      .filter(p => p.data.team === 'GSW')
      .sort((a, b) => a.position.distanceTo(this.ballPos) - b.position.distanceTo(this.ballPos))
      .slice(0, 3);

    const sortedHOU = this.players
      .filter(p => p.data.team === 'HOU')
      .sort((a, b) => a.position.distanceTo(this.ballPos) - b.position.distanceTo(this.ballPos))
      .slice(0, 3);

    const rebounders = [...sortedGSW, ...sortedHOU];

    // Check for high-traffic tip-out scramble
    const highContenders = rebounders.filter(r => r.position.distanceTo(this.ballPos) < 1.25);
    if (highContenders.length >= 2 && Math.random() < 0.15 && this.ballPos.y > 1.6) {
      const tipper = highContenders[Math.floor(Math.random() * highContenders.length)];
      const tipDir = new THREE.Vector3(
        (Math.random() - 0.5) * 5.0,
        1.8,
        tipper.data.team === 'GSW' ? 5.5 : -5.5
      );
      this.ballVel.copy(tipDir);
      sounds.playBlock();
      this.spawnFloatingStatus('TIP-OUT!', tipper.position, '#38bdf8');
      return;
    }

    for (const p of rebounders) {
      if (p !== this.controlledPlayer) {
        const toBall = new THREE.Vector3(this.ballPos.x - p.position.x, 0, this.ballPos.z - p.position.z);
        if (toBall.length() > 0.2) {
          toBall.normalize();
          p.position.addScaledVector(toBall, p.data.speed * 0.88 * dt);
          p.lookAt(this.ballPos.x, p.position.y, this.ballPos.z);
        }
      }

      const isControlledJumping = p === this.controlledPlayer && (this.controlledPlayer.isDefendingAnim || !!this.keys[' ']);
      const maxCatchDist = isControlledJumping ? 1.45 : 0.90;
      const maxCatchY = isControlledJumping ? 2.4 : 1.45;

      const dist = p.position.distanceTo(this.ballPos);
      if (dist < maxCatchDist && this.ballPos.y < maxCatchY) {
        // NBA Rule 10, Sec. II: Shooter cannot catch own airball before it touches rim or floor
        if (this.activeShot && !this.activeShot.hasHitRim && !this.activeShot.hasHitFloor && p === this.activeShot.shooter) {
          sounds.playWhistle();
          this.spawnFloatingStatus('TRAVELING / SELF-PASS', p.position, '#ff3344');
          const turnoverTeam = p.data.team === 'GSW' ? 'HOU' : 'GSW';
          this.executeInbound(turnoverTeam);
          return;
        }

        const prevShooterTeam = this.activeShot?.shooterTeam || 'GSW';
        const isOffensiveRebound = p.data.team === prevShooterTeam;

        this.ballHolder = p;
        this.ballState = 'DRIBBLE';
        this.isBallRolling = false;
        this.activeShot = null;
        this.houPassCount = 0;
        this.houCarrierDribbleTime = 0;

        // Official NBA Shot Clock rule: 14s on offensive rebound, 24s on defensive rebound
        if (isOffensiveRebound) {
          this.shotClock = 14.0;
          const label = p.data.team === 'GSW' ? 'OFFENSIVE REBOUND' : 'OFFENSIVE REBOUND (HOU)';
          this.spawnFloatingStatus(label, p.position, '#ffd700');
        } else {
          this.shotClock = 24.0;
          const label = p.data.team === 'GSW' ? 'DEFENSIVE REBOUND' : 'DEFENSIVE REBOUND (HOU)';
          this.spawnFloatingStatus(label, p.position, '#38bdf8');
        }

        sounds.playSneakerSqueak();

        if (p.data.team === 'GSW') {
          this.setControlledPlayer(p);
          this.onPossessionChange?.(true);
        } else {
          this.onPossessionChange?.(false);
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
    this.houPassCount = 0;
    this.houCarrierDribbleTime = 0;

    // Reset official NBA rule states
    this.hasEstablishedFrontcourt = false;
    this.backcourtTimer = 0;
    this.paintTimerMap.clear();
    this.isInboundPlay = true;
    this.inboundTimer = 0;
    this.shotClock = 24.0;
    this.lastBallTouchedTeam = team;

    if (team === 'GSW') {
      this.setControlledPlayer(inbounder);
      this.onPossessionChange?.(true);
    } else {
      this.onPossessionChange?.(false);
    }
  }

  // --------------------------------------------------------------------------
  // OFFICIAL NBA RULES ENGINE
  // --------------------------------------------------------------------------
  private checkOfficialNBARules(dt: number) {
    if (this.ballState === 'FREE_THROW') return;

    // 1. INBOUND 5-SECOND VIOLATION
    if (this.isInboundPlay && this.ballHolder) {
      this.inboundTimer += dt;
      if (Math.abs(this.ballHolder.position.z) < 13.5) {
        this.isInboundPlay = false;
        this.inboundTimer = 0;
      } else if (this.inboundTimer >= 5.0) {
        sounds.playWhistle();
        const defendingTeam = this.ballHolder.data.team === 'GSW' ? 'HOU' : 'GSW';
        this.spawnFloatingStatus('5-SECOND INBOUND VIOLATION', this.ballHolder.position, '#ef4444');
        this.onRuleViolation?.({
          violation: '5-SECOND INBOUND VIOLATION',
          team: this.ballHolder.data.team,
          awardedTeam: defendingTeam,
          description: `Failed to inbound the ball within 5 seconds. Turnover, ball to ${defendingTeam}.`,
        });
        this.executeInbound(defendingTeam);
        return;
      }
    }

    // 2. 8-SECOND BACKCOURT RULE & OVER-AND-BACK (BACKCOURT VIOLATION)
    if (this.ballState === 'DRIBBLE' && this.ballHolder && !this.isInboundPlay) {
      const carrier = this.ballHolder;
      const isGSW = carrier.data.team === 'GSW';

      // For GSW: Backcourt is z > 0, Frontcourt is z <= 0
      // For HOU: Backcourt is z < 0, Frontcourt is z >= 0
      const inBackcourt = isGSW ? carrier.position.z > 0 : carrier.position.z < 0;

      if (inBackcourt) {
        if (this.hasEstablishedFrontcourt) {
          // OVER AND BACK VIOLATION
          sounds.playWhistle();
          const defendingTeam = isGSW ? 'HOU' : 'GSW';
          this.spawnFloatingStatus('OVER & BACK VIOLATION', carrier.position, '#ef4444');
          this.onRuleViolation?.({
            violation: 'BACKCOURT VIOLATION (OVER & BACK)',
            team: carrier.data.team,
            awardedTeam: defendingTeam,
            description: `Offense returned the ball to the backcourt after crossing midcourt. Ball to ${defendingTeam}.`,
          });
          this.executeInbound(defendingTeam);
          return;
        } else {
          // 8-SECOND COUNT
          this.backcourtTimer += dt;
          if (this.backcourtTimer >= 8.0) {
            sounds.playWhistle();
            const defendingTeam = isGSW ? 'HOU' : 'GSW';
            this.spawnFloatingStatus('8-SECOND VIOLATION!', carrier.position, '#ef4444');
            this.onRuleViolation?.({
              violation: '8-SECOND BACKCOURT VIOLATION',
              team: carrier.data.team,
              awardedTeam: defendingTeam,
              description: `Offense failed to advance ball across midcourt within 8 seconds. Ball to ${defendingTeam}.`,
            });
            this.executeInbound(defendingTeam);
            return;
          }
        }
      } else {
        // Established Frontcourt
        this.hasEstablishedFrontcourt = true;
        this.backcourtTimer = 0;
      }
    }

    // 3. OUT-OF-BOUNDS VIOLATION
    if (!this.isInboundPlay) {
      const boundaryX = 7.55;
      const boundaryZ = 14.25;

      if (this.ballState === 'DRIBBLE' && this.ballHolder) {
        if (Math.abs(this.ballHolder.position.x) > boundaryX || Math.abs(this.ballHolder.position.z) > boundaryZ) {
          sounds.playWhistle();
          const defendingTeam = this.ballHolder.data.team === 'GSW' ? 'HOU' : 'GSW';
          this.spawnFloatingStatus('STEPPED OUT OF BOUNDS!', this.ballHolder.position, '#ef4444');
          this.onRuleViolation?.({
            violation: 'STEPPED OUT OF BOUNDS',
            team: this.ballHolder.data.team,
            awardedTeam: defendingTeam,
            description: `${this.ballHolder.data.name} stepped on or over the sideline. Turnover, ball to ${defendingTeam}.`,
          });
          this.executeInbound(defendingTeam);
          return;
        }
      } else if (this.ballState === 'REBOUND' || this.ballState === 'PASS' || this.ballState === 'BOUNCE_PASS') {
        if (Math.abs(this.ballPos.x) > 7.70 || Math.abs(this.ballPos.z) > 14.40) {
          sounds.playWhistle();
          const lastTeam = this.lastBallTouchedTeam || (this.controlledPlayer.data.team === 'GSW' ? 'GSW' : 'HOU');
          const awardedTeam = lastTeam === 'GSW' ? 'HOU' : 'GSW';
          this.spawnFloatingStatus('OUT OF BOUNDS', this.ballPos, '#ef4444');
          this.onRuleViolation?.({
            violation: 'BALL OUT OF BOUNDS',
            team: lastTeam,
            awardedTeam,
            description: `Ball out of bounds, last touched by ${lastTeam}. Possession awarded to ${awardedTeam}.`,
          });
          this.executeInbound(awardedTeam);
          return;
        }
      }
    }

    // 4. OFFENSIVE 3-SECOND LANE VIOLATION (Camping in the key)
    if (this.ballState === 'DRIBBLE' && this.ballHolder) {
      const offTeam = this.ballHolder.data.team;
      const isGSW = offTeam === 'GSW';

      this.players.forEach(p => {
        if (p.data.team !== offTeam) return;
        if (p.isDunking || p.isShootingAnim || this.isChargingShot) {
          this.paintTimerMap.delete(p);
          return;
        }

        const inPaint = isGSW
          ? Math.abs(p.position.x) <= 2.45 && p.position.z <= -8.8 && p.position.z >= -14.2
          : Math.abs(p.position.x) <= 2.45 && p.position.z >= 8.8 && p.position.z <= 14.2;

        if (inPaint) {
          const t = (this.paintTimerMap.get(p) || 0) + dt;
          this.paintTimerMap.set(p, t);
          if (t >= 3.0) {
            sounds.playWhistle();
            const defendingTeam = isGSW ? 'HOU' : 'GSW';
            this.spawnFloatingStatus('3 SECONDS IN THE KEY!', p.position, '#ef4444');
            this.onRuleViolation?.({
              violation: '3-SECOND LANE VIOLATION',
              team: isGSW ? 'GSW' : 'HOU',
              awardedTeam: defendingTeam,
              description: `${p.data.name} remained in the free-throw lane for 3 seconds. Turnover, ball to ${defendingTeam}.`,
            });
            this.paintTimerMap.clear();
            this.executeInbound(defendingTeam);
          }
        } else {
          this.paintTimerMap.delete(p);
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // CAMERA FRAMING (SIDE BROADCAST, COURTSIDE, 2K BEHIND)
  // --------------------------------------------------------------------------
  private updateCamera(dt: number) {
    if (!this.controlledPlayer) return;

    // Both hoops are always visible in full-court side broadcast view
    this.gswHoopGroup.visible = true;
    this.houHoopGroup.visible = true;

    const focusPlayer = this.controlledPlayer;
    let targetX = focusPlayer.position.x;
    let targetZ = focusPlayer.position.z;

    if (this.ballState === 'SHOT' || this.ballState === 'REBOUND') {
      targetX = focusPlayer.position.x * 0.35 + this.ballPos.x * 0.65;
      targetZ = focusPlayer.position.z * 0.35 + this.ballPos.z * 0.65;
    }

    if (this.cameraMode === 'SIDE') {
      // Classic TV Sideline Broadcast View (Authentic horizontal court perspective)
      const camX = 14.8;
      const camY = 7.6;
      const camZ = THREE.MathUtils.clamp(targetZ * 0.68, -8.5, 8.5);

      const lookX = targetX * 0.2;
      const lookY = 1.6 + (this.ballState === 'SHOT' ? Math.max(0, (this.ballPos.y - 2.0) * 0.3) : 0);
      const lookZ = targetZ;

      this.cameraTargetPos.set(camX, camY, camZ);
      this.cameraLookTarget.set(lookX, lookY, lookZ);
    } else if (this.cameraMode === 'COURTSIDE') {
      // Intimate, dynamic courtside side view right off the hardwood
      const camX = 10.5;
      const camY = 4.2;
      const camZ = THREE.MathUtils.clamp(targetZ * 0.75, -9.0, 9.0);

      const lookX = targetX * 0.15;
      const lookY = 1.5;
      const lookZ = targetZ;

      this.cameraTargetPos.set(camX, camY, camZ);
      this.cameraLookTarget.set(lookX, lookY, lookZ);
    } else {
      // 2K Drive (Behind player end-to-end follow)
      const isGswPossession = !this.ballHolder || this.ballHolder.data.team === 'GSW';
      if (isGswPossession) {
        const camX = targetX * 0.82;
        const camZ = THREE.MathUtils.clamp(targetZ + 7.5, -6.5, 14.2);
        const camY = 6.8;

        const lookX = targetX * 0.65;
        const lookZ = targetZ - 2.8;
        const lookY = 1.6;

        this.cameraTargetPos.set(camX, camY, camZ);
        this.cameraLookTarget.set(lookX, lookY, lookZ);
      } else {
        const camX = targetX * 0.82;
        const camZ = THREE.MathUtils.clamp(targetZ - 7.5, -14.2, 6.5);
        const camY = 6.8;

        const lookX = targetX * 0.65;
        const lookZ = targetZ + 2.8;
        const lookY = 1.6;

        this.cameraTargetPos.set(camX, camY, camZ);
        this.cameraLookTarget.set(lookX, lookY, lookZ);
      }
    }

    const followSpeed = dt * 5.8;
    this.camera.position.lerp(this.cameraTargetPos, followSpeed);
    this.cameraCurrentLook.lerp(this.cameraLookTarget, followSpeed);
    this.camera.lookAt(this.cameraCurrentLook);
  }

  // --------------------------------------------------------------------------
  // NET ANIMATION & VISUAL FX
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

  private spawnFloatingStatus(text: string, pos: THREE.Vector3, color = '#ffeb3b') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = color;
    ctx.font = '900 32px Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.set(pos.x, 1.8, pos.z);
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
  // HOUSTON AI OFFENSE & DEFENSE
  // --------------------------------------------------------------------------
  private updateHoustonAI(dt: number) {
    if (this.ballState === 'FREE_THROW') return;

    const houPlayers = this.players.filter(p => p.data.team === 'HOU');
    const gswPlayers = this.players.filter(p => p.data.team === 'GSW');
    const isHouOffense = this.ballHolder && this.ballHolder.data.team === 'HOU';

    this.aiDecisionTimer += dt;
    this.aiPassTimer += dt;

    // 1. HOUSTON OFFENSIVE PLAYMAKING & ATTACKING
    if (isHouOffense && this.ballHolder) {
      const carrier = this.ballHolder;
      this.houCarrierDribbleTime += dt;
      const targetRim = this.houHoopPos;

      const toRim = new THREE.Vector3().subVectors(targetRim, carrier.position);
      toRim.y = 0;
      const distToRim = toRim.length();

      const defender = this.getNearestDefender(carrier);
      const defDist = defender ? defender.position.distanceTo(carrier.position) : 99;

      // Smart Off-Ball Spacing & Cuts
      const offBallSpots = [
        new THREE.Vector3(-5.4, 0, 9.8),
        new THREE.Vector3(5.4, 0, 9.8),
        new THREE.Vector3(-4.8, 0, 6.2),
        new THREE.Vector3(4.8, 0, 6.2),
        new THREE.Vector3(0, 0, 4.5),
      ];

      let spotIdx = 0;
      houPlayers.forEach(p => {
        if (p === carrier) return;
        const targetSpot = offBallSpots[spotIdx % offBallSpots.length];
        spotIdx++;

        const sway = Math.sin(this.gameClock * 2.5 + spotIdx) * 0.45;
        const desiredPos = new THREE.Vector3(targetSpot.x + sway, 0, targetSpot.z);
        const toSpot = new THREE.Vector3().subVectors(desiredPos, p.position);
        toSpot.y = 0;
        if (toSpot.length() > 0.3) {
          toSpot.normalize();
          p.position.addScaledVector(toSpot, p.data.speed * 0.85 * dt);
          p.lookAt(targetRim.x, p.position.y, targetRim.z);
        }
      });

      // DRIVING TO THE BASKET: Carrier accelerates toward the hoop!
      if (distToRim > 1.2) {
        toRim.normalize();
        // Crossover dribble cadence
        carrier.dribbleHand = Math.sin(this.gameClock * 5) > 0 ? 'left' : 'right';
        const driveSpeedMult = defDist < 1.4 ? 0.95 : 1.25;
        carrier.position.addScaledVector(toRim, carrier.data.speed * driveSpeedMult * dt);
        carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
      }

      // DECISION 1: SLAM DUNK OR LAYUP (within 3.3m of the rim)
      if (distToRim <= 3.3 && this.ballState === 'DRIBBLE') {
        this.houCarrierDribbleTime = 0;
        this.aiDecisionTimer = 0;
        this.executeShot(carrier, 0.65);
        return;
      }

      // DECISION 2: OPEN PULL-UP 3-POINTER OR MID-RANGE JUMPER
      const isOpenShot = defDist > 1.85 && distToRim <= 7.2 && this.houCarrierDribbleTime > 0.6;
      const clockExpiring = this.shotClock <= 4.0;
      if ((isOpenShot || clockExpiring) && this.ballState === 'DRIBBLE') {
        this.houCarrierDribbleTime = 0;
        this.aiDecisionTimer = 0;
        const simHold = 0.65 + (Math.random() - 0.5) * 0.08;
        this.executeShot(carrier, simHold);
        return;
      }

      // DECISION 3: DRIVE-AND-KICK / SWING PASS
      const isTrapped = defDist < 1.35 && this.houCarrierDribbleTime > 1.0;
      const wantsPass = this.houCarrierDribbleTime > 2.0 && Math.random() < 0.25;
      if ((isTrapped || wantsPass) && this.ballState === 'DRIBBLE') {
        this.houPassCount++;
        this.houCarrierDribbleTime = 0;
        this.aiPassTimer = 0;
        this.initiatePass(carrier);
        return;
      }
    }

    // 2. HOUSTON DEFENSE (ACTIVE SHOT CONTESTS, STEALS, BOX OUTS)
    const isGswShotActive = this.isChargingShot || (this.ballState === 'SHOT' && this.activeShot?.shooterTeam === 'GSW');
    const gswCarrier = this.ballHolder && this.ballHolder.data.team === 'GSW' ? this.ballHolder : null;

    houPlayers.forEach(p => {
      if (p === this.ballHolder) return;
      if (this.ballState === 'REBOUND') return;

      // When GSW is taking a shot: LEAP AND CONTEST!
      if (isGswShotActive) {
        const shooter = this.ballHolder || (this.activeShot ? this.controlledPlayer : null);
        const nearestToShooter = shooter ? this.getNearestDefender(shooter) : null;

        if (p === nearestToShooter && shooter) {
          const toShooter = new THREE.Vector3().subVectors(shooter.position, p.position);
          toShooter.y = 0;
          const distToShooter = toShooter.length();

          if (distToShooter > 0.8) {
            toShooter.normalize();
            p.position.addScaledVector(toShooter, p.data.speed * 1.15 * dt);
          }
          p.lookAt(shooter.position.x, p.position.y, shooter.position.z);

          // Leaping block contest!
          if (!p.isDefendingAnim && distToShooter < 2.2) {
            p.isDefendingAnim = true;
            p.defendAnimTimer = 0;

            // 20% chance for an over-aggressive Houston contest to commit a SHOOTING FOUL!
            if (this.ballState === 'SHOT' && this.activeShot && distToShooter < 1.45 && Math.random() < 0.20) {
              if (shooter) {
                const attempts = this.activeShot.points === 3 ? 3 : 2;
                this.triggerFoul(shooter, p, 'SHOOTING FOUL', attempts);
                return;
              }
            }

            // 20% chance for an elite Houston defender to block or alter the shot!
            if (this.ballState === 'SHOT' && this.activeShot && Math.random() < 0.20 && this.ballPos.y < 3.2) {
              sounds.playBlock();
              this.spawnFloatingStatus('BLOCKED BY HOUSTON!', p.position, '#ce1141');
              this.ballState = 'REBOUND';
              this.activeShot = null;
              this.ballVel.set((Math.random() - 0.5) * 4, 1.8, 3.5);
            }
          }
          return;
        } else {
          // Off-ball defenders box out near rim
          const reboundSpot = new THREE.Vector3(
            (p.position.x > 0 ? 1 : -1) * 2.0,
            0,
            -11.8 + Math.sin(p.runCycle) * 0.5
          );
          const toBox = new THREE.Vector3().subVectors(reboundSpot, p.position);
          toBox.y = 0;
          if (toBox.length() > 0.4) {
            toBox.normalize();
            p.position.addScaledVector(toBox, p.data.speed * 0.85 * dt);
            p.lookAt(this.gswHoopPos.x, p.position.y, this.gswHoopPos.z);
          }
          return;
        }
      }

      // On-Ball Tight Perimeter Defense & Poke Check Steals
      if (gswCarrier) {
        const distToCarrier = p.position.distanceTo(gswCarrier.position);
        const isPrimaryDefender = p === this.getNearestDefender(gswCarrier);

        if (isPrimaryDefender) {
          const toCarrier = new THREE.Vector3().subVectors(gswCarrier.position, p.position);
          toCarrier.y = 0;
          if (toCarrier.length() > 1.1) {
            toCarrier.normalize();
            p.position.addScaledVector(toCarrier, p.data.speed * 0.95 * dt);
          }
          p.lookAt(gswCarrier.position.x, p.position.y, gswCarrier.position.z);
          p.leftArmPivot.rotation.x = -1.1;
          p.rightArmPivot.rotation.x = -1.1;

          // Poke check steal attempt
          if (distToCarrier < 1.35 && Math.random() < 0.015 && this.ballState === 'DRIBBLE') {
            p.rightArmPivot.rotation.x = -1.6;

            // 18% chance of reach-in foul by Houston on Curry
            if (Math.random() < 0.18) {
              this.triggerFoul(gswCarrier, p, 'REACH-IN FOUL');
              return;
            }

            if (Math.random() < 0.25) {
              // Steal success!
              this.ballHolder = null;
              this.ballState = 'REBOUND';
              this.activeShot = null;
              this.ballVel.set((Math.random() - 0.5) * 3, 1.2, 2.5);
              sounds.playSneakerSqueak();
              this.spawnFloatingStatus('STEAL BY HOUSTON!', p.position, '#ce1141');
              this.onPossessionChange?.(false);
            }
          }
          return;
        }
      }

      // Shadow matchup off-ball
      const myMatchup = gswPlayers.find(opp => opp.data.position === p.data.position) || gswPlayers[0];
      const dirToHoop = new THREE.Vector3().subVectors(this.gswHoopPos, myMatchup.position).normalize();
      const idealGuardPos = myMatchup.position.clone().addScaledVector(dirToHoop, 1.6);
      const moveDir = new THREE.Vector3().subVectors(idealGuardPos, p.position);
      moveDir.y = 0;
      if (moveDir.length() > 0.2) {
        moveDir.normalize();
        p.position.addScaledVector(moveDir, p.data.speed * 0.88 * dt);
        p.lookAt(myMatchup.position.x, p.position.y, myMatchup.position.z);
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
  // USER MOVEMENT, SPRINTING & ANIMATIONS
  // --------------------------------------------------------------------------
  private updatePlayerMovement(dt: number) {
    if (this.ballState === 'FREE_THROW') return;

    if (this.controlledPlayer) {
      // 1. Gather Screen-Space Input
      // inputX: -1 for Screen Left, +1 for Screen Right
      // inputY: +1 for Screen Up, -1 for Screen Down
      let inputX = 0;
      let inputY = 0;

      if (this.keys['a'] || this.keys['arrowleft']) inputX -= 1;
      if (this.keys['d'] || this.keys['arrowright']) inputX += 1;
      if (this.keys['w'] || this.keys['arrowup']) inputY += 1;
      if (this.keys['s'] || this.keys['arrowdown']) inputY -= 1;

      if (this.joystickVector.lengthSq() > 0.01) {
        inputX += this.joystickVector.x;
        inputY -= this.joystickVector.y; // DOM Y increases downward, so invert for Screen Up
      }

      // 2. Camera-Oriented Movement Vectors (Zero Inversion Guarantee)
      // Extract horizontal forward & right vectors directly from camera view
      const camForward = new THREE.Vector3();
      this.camera.getWorldDirection(camForward);
      camForward.y = 0;
      if (camForward.lengthSq() > 0.001) {
        camForward.normalize();
      } else {
        camForward.set(0, 0, -1);
      }

      const camRight = new THREE.Vector3();
      camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

      const move = new THREE.Vector3();
      move.addScaledVector(camRight, inputX);
      move.addScaledVector(camForward, inputY);

      // Dynamic Crossover Hand Switching based on screen horizontal motion
      if (inputX < -0.15) {
        this.controlledPlayer.dribbleHand = 'left';
      } else if (inputX > 0.15) {
        this.controlledPlayer.dribbleHand = 'right';
      }

      // Turbo / Sprinting logic
      const isTryingSprint = this.isSprinting || !!this.keys['shift'];
      let speedMult = 1.0;
      if (isTryingSprint && this.stamina > 0.05 && move.lengthSq() > 0) {
        speedMult = 1.4;
        this.stamina = Math.max(0, this.stamina - dt * 0.22);
      } else {
        this.stamina = Math.min(1.0, this.stamina + dt * 0.35);
      }
      this.onStaminaUpdate?.(this.stamina);

      if (move.lengthSq() > 0) {
        move.normalize();
        this.controlledPlayer.position.addScaledVector(
          move,
          this.controlledPlayer.data.speed * speedMult * dt
        );
        this.controlledPlayer.lookAt(
          this.controlledPlayer.position.x + move.x,
          this.controlledPlayer.position.y,
          this.controlledPlayer.position.z + move.z
        );

        // Sneaker squeak sound on sharp turns
        if (this.gameClock - this.lastSqueakTime > 0.9 && speedMult > 1.0 && Math.random() < 0.2) {
          sounds.playSneakerSqueak();
          this.lastSqueakTime = this.gameClock;
        }

        // Real-World NBA Driving Contact: Offensive Charge vs Defensive Blocking Foul
        if (
          this.ballHolder === this.controlledPlayer &&
          this.ballState === 'DRIBBLE' &&
          speedMult > 1.0 &&
          this.foulCooldownTimer <= 0
        ) {
          const nearestDef = this.getNearestDefender(this.controlledPlayer);
          if (nearestDef) {
            const dist = this.controlledPlayer.position.distanceTo(nearestDef.position);
            const hoopDist = new THREE.Vector2(
              this.gswHoopPos.x - nearestDef.position.x,
              this.gswHoopPos.z - nearestDef.position.z
            ).length();

            // Outside the restricted area arc (~1.3m from basket)
            if (dist < 0.92 && hoopDist > 1.3) {
              this.foulCooldownTimer = 2.5;
              // If defender is planted and not sprinting (speed < 0.8) -> Offensive Charge!
              if (nearestDef.currentSpeed < 0.8) {
                this.triggerFoul(nearestDef, this.controlledPlayer, 'CHARGING FOUL');
                return;
              } else {
                // Defender was sliding laterally or into the path -> Defensive Blocking Foul!
                this.triggerFoul(this.controlledPlayer, nearestDef, 'BLOCKING FOUL');
                return;
              }
            }
          }
        }
      }

      // Enforce out-of-bounds boundary
      const boundX = 7.05;
      const boundZ = 13.68;
      this.controlledPlayer.position.x = THREE.MathUtils.clamp(this.controlledPlayer.position.x, -boundX, boundX);
      this.controlledPlayer.position.z = THREE.MathUtils.clamp(this.controlledPlayer.position.z, -boundZ, boundZ);
    }

    // Comprehensive Player Animation Updates (Running, Jump Shot, Slam Dunk, Block)
    this.players.forEach(p => {
      // 1. DUNK ANIMATION (High-Flying Tomahawk Posterizer with Knee Tuck & Rim Hang)
      if (p.isDunking) {
        p.dunkAnimTimer = (p.dunkAnimTimer || 0) + dt;
        const dunkProg = Math.min(1.0, p.dunkAnimTimer / 0.78);

        if (dunkProg < 0.40) {
          // Launch & Cocking the ball behind head
          const takeoffNorm = dunkProg / 0.40;
          p.position.y = Math.sin(takeoffNorm * Math.PI * 0.5) * 0.95;
          p.torsoMesh.rotation.x = -0.16;

          p.rightArmPivot.rotation.x = -1.25;
          p.rightArmPivot.rotation.z = 0.28;
          p.rightElbowPivot.rotation.x = -2.1; // Arm cocked back
          p.rightHandMesh.rotation.x = 0.3;

          p.leftArmPivot.rotation.x = -0.65;
          p.leftElbowPivot.rotation.x = -0.85;

          // Lead knee tucks high, trailing leg kicks back
          p.leftLegPivot.rotation.x = -0.85;
          p.leftKneePivot.rotation.x = 1.35;
          p.rightLegPivot.rotation.x = 0.40;
          p.rightKneePivot.rotation.x = 0.85;
        } else if (dunkProg < 0.68) {
          // Powerful downward hammer flush through the rim
          p.position.y = 0.95 - ((dunkProg - 0.40) / 0.28) * 0.35;
          p.torsoMesh.rotation.x = 0.22;

          p.rightArmPivot.rotation.x = -2.85;
          p.rightArmPivot.rotation.z = 0.08;
          p.rightElbowPivot.rotation.x = -0.18; // Full arm extension down through rim
          p.rightHandMesh.rotation.x = 0.75;

          p.leftArmPivot.rotation.x = -1.1;
          p.leftElbowPivot.rotation.x = -0.4;

          p.leftLegPivot.rotation.x = 0.35;
          p.leftKneePivot.rotation.x = 0.55;
          p.rightLegPivot.rotation.x = 0.35;
          p.rightKneePivot.rotation.x = 0.55;
        } else {
          // Hang & landing impact absorption
          const landNorm = (dunkProg - 0.68) / 0.32;
          p.position.y = Math.max(0, 0.60 * (1 - landNorm));
          p.torsoMesh.rotation.x = 0.22 * (1 - landNorm);

          p.rightArmPivot.rotation.x = -2.85 + landNorm * 2.5;
          p.rightElbowPivot.rotation.x = -0.18 * (1 - landNorm);
          p.rightHandMesh.rotation.x = 0.75 * (1 - landNorm);

          // Deep knee bend absorbing landing impact
          const kneeAbsorb = Math.sin(landNorm * Math.PI) * 0.70;
          p.leftKneePivot.rotation.x = kneeAbsorb;
          p.rightKneePivot.rotation.x = kneeAbsorb;
          p.leftLegPivot.rotation.x = kneeAbsorb * 0.4;
          p.rightLegPivot.rotation.x = kneeAbsorb * 0.4;
        }

        if (dunkProg >= 1.0) {
          p.isDunking = false;
          p.dunkAnimTimer = 0;
          p.position.y = 0;
          p.leftKneePivot.rotation.x = 0;
          p.rightKneePivot.rotation.x = 0;
          p.rightElbowPivot.rotation.x = 0;
          p.leftElbowPivot.rotation.x = 0;
          p.rightHandMesh.rotation.x = 0;
          p.torsoMesh.rotation.x = 0;
        }
        return;
      }

      // 2. JUMP SHOT ANIMATION (Curry Signature One-Motion Quick Release & Goose-Neck)
      if (p.isShootingAnim) {
        p.shootAnimTimer = (p.shootAnimTimer || 0) + dt;
        const shotProg = Math.min(1.0, p.shootAnimTimer / 0.72);

        if (shotProg < 0.22) {
          // Gather & Knee Dip
          const dipProg = shotProg / 0.22;
          p.position.y = -0.10 * Math.sin(dipProg * Math.PI * 0.5);
          p.torsoMesh.rotation.x = 0.12;

          p.leftLegPivot.rotation.x = 0.24 * dipProg;
          p.rightLegPivot.rotation.x = 0.24 * dipProg;
          p.leftKneePivot.rotation.x = 0.65 * dipProg;
          p.rightKneePivot.rotation.x = 0.65 * dipProg;

          // Ball loaded into shooting pocket
          p.rightArmPivot.rotation.x = -1.2 * dipProg;
          p.rightElbowPivot.rotation.x = -1.55 * dipProg;
          p.leftArmPivot.rotation.x = -1.2 * dipProg;
          p.leftElbowPivot.rotation.x = -1.45 * dipProg;
        } else if (shotProg < 0.58) {
          // Elevation & High Set Point
          const riseProg = (shotProg - 0.22) / 0.36;
          p.position.y = Math.sin(riseProg * Math.PI * 0.5) * 0.58;
          p.torsoMesh.rotation.x = 0.05;

          // Legs straighten in mid-air
          p.leftLegPivot.rotation.x = 0.08;
          p.rightLegPivot.rotation.x = 0.08;
          p.leftKneePivot.rotation.x = 0.08;
          p.rightKneePivot.rotation.x = 0.08;

          // Set Point: Right elbow tucked at 90°, guide hand stabilized
          p.rightArmPivot.rotation.x = -1.85;
          p.rightArmPivot.rotation.z = -0.12;
          p.rightElbowPivot.rotation.x = -1.4;

          p.leftArmPivot.rotation.x = -1.8;
          p.leftArmPivot.rotation.z = -0.32;
          p.leftElbowPivot.rotation.x = -0.95;
        } else if (shotProg < 0.82) {
          // High Release & Goose-Neck Wrist Snap!
          const hangProg = (shotProg - 0.58) / 0.24;
          p.position.y = 0.58 * (1 - hangProg * 0.4);

          // Full extension overhead
          p.rightArmPivot.rotation.x = -2.75;
          p.rightArmPivot.rotation.z = -0.06;
          p.rightElbowPivot.rotation.x = -0.12;
          p.rightHandMesh.rotation.x = 0.95; // Signature goose-neck wrist snap!

          p.leftArmPivot.rotation.x = -2.1;
          p.leftArmPivot.rotation.z = -0.28;
          p.leftElbowPivot.rotation.x = -0.45;
        } else {
          // Touchdown & Landing Knee Cushioning
          const landProg = (shotProg - 0.82) / 0.18;
          p.position.y = Math.max(0, 0.35 * (1 - landProg));

          const kneeBend = Math.sin(landProg * Math.PI) * 0.42;
          p.leftKneePivot.rotation.x = kneeBend;
          p.rightKneePivot.rotation.x = kneeBend;
          p.leftLegPivot.rotation.x = kneeBend * 0.35;
          p.rightLegPivot.rotation.x = kneeBend * 0.35;

          p.rightHandMesh.rotation.x = 0.95 * (1 - landProg);
          p.rightArmPivot.rotation.x = -2.75 * (1 - landProg);
          p.leftArmPivot.rotation.x = -2.1 * (1 - landProg);
        }

        if (shotProg >= 1.0) {
          p.isShootingAnim = false;
          p.shootAnimTimer = 0;
          p.position.y = 0;
          p.leftKneePivot.rotation.x = 0;
          p.rightKneePivot.rotation.x = 0;
          p.rightElbowPivot.rotation.x = 0;
          p.leftElbowPivot.rotation.x = 0;
          p.rightHandMesh.rotation.x = 0;
          p.torsoMesh.rotation.x = 0;
        }
        return;
      }

      // 3. DEFENSIVE CONTEST / BLOCK ANIMATION (Leaping Contest with High Arm Reach)
      if (p.isDefendingAnim) {
        p.defendAnimTimer = (p.defendAnimTimer || 0) + dt;
        const blockProg = Math.min(1.0, p.defendAnimTimer / 0.68);

        p.position.y = Math.sin(blockProg * Math.PI) * 0.72;
        p.leftArmPivot.rotation.x = -2.95;
        p.rightArmPivot.rotation.x = -2.95;
        p.leftArmPivot.rotation.z = 0.22;
        p.rightArmPivot.rotation.z = -0.22;
        p.leftElbowPivot.rotation.x = -0.18;
        p.rightElbowPivot.rotation.x = -0.18;

        const legLeap = Math.sin(blockProg * Math.PI) * 0.28;
        p.leftLegPivot.rotation.x = legLeap;
        p.rightLegPivot.rotation.x = legLeap;
        p.leftKneePivot.rotation.x = legLeap * 0.6;
        p.rightKneePivot.rotation.x = legLeap * 0.6;

        if (blockProg >= 1.0) {
          p.isDefendingAnim = false;
          p.defendAnimTimer = 0;
          p.position.y = 0;
          p.leftKneePivot.rotation.x = 0;
          p.rightKneePivot.rotation.x = 0;
          p.leftElbowPivot.rotation.x = 0;
          p.rightElbowPivot.rotation.x = 0;
        }
        return;
      }

      // 4. BIOMECHANICALLY ACCURATE RUNNING & SPRINTING STRIDES
      p.position.x = THREE.MathUtils.clamp(p.position.x, -7.05, 7.05);
      p.position.z = THREE.MathUtils.clamp(p.position.z, -13.68, 13.68);

      const vel = new THREE.Vector3().subVectors(p.position, p.lastPos);
      vel.y = 0;
      const rawSpeed = vel.length() / Math.max(dt, 0.001);
      p.currentSpeed = THREE.MathUtils.lerp(p.currentSpeed, rawSpeed, dt * 7.5);

      const hasBall = this.ballHolder === p;
      const isMoving = p.currentSpeed > 0.25;

      if (isMoving) {
        p.idleTimer = 0;
        p.runCycle += dt * p.currentSpeed * 4.8;

        const strideAmp = THREE.MathUtils.lerp(0.42, 0.88, Math.min(1.0, p.currentSpeed / 4.8));
        const swing = Math.sin(p.runCycle) * strideAmp;

        // Hip swing
        p.leftLegPivot.rotation.x = swing;
        p.rightLegPivot.rotation.x = -swing;

        // Realistic Knee Backswing Flexion (Bends back up to 80° when leg trails behind!)
        p.leftKneePivot.rotation.x = Math.max(0, -swing * 1.85);
        p.rightKneePivot.rotation.x = Math.max(0, swing * 1.85);

        // Forward Torso Drive Lean & Pelvis Vertical Bounce
        const leanAngle = THREE.MathUtils.lerp(0.04, 0.24, Math.min(1.0, p.currentSpeed / 5.0));
        p.torsoMesh.rotation.x = leanAngle;
        p.torsoMesh.position.y = 1.35 + Math.abs(Math.sin(p.runCycle * 2)) * 0.045;
        p.headMesh.position.y = 2.0;

        // Spine Counter-Rotation (Shoulders rotate opposite to hips!)
        p.torsoMesh.rotation.y = -Math.sin(p.runCycle) * 0.14;

        // If off-ball player, pump arms naturally with elbow flexion
        if (!hasBall) {
          p.leftArmPivot.rotation.x = -swing * 0.88;
          p.rightArmPivot.rotation.x = swing * 0.88;
          p.leftArmPivot.rotation.z = 0;
          p.rightArmPivot.rotation.z = 0;
          p.leftElbowPivot.rotation.x = -0.85 - swing * 0.35;
          p.rightElbowPivot.rotation.x = -0.85 + swing * 0.35;
          p.leftHandMesh.rotation.x = 0;
          p.rightHandMesh.rotation.x = 0;
        }
      } else {
        // IDLE STANDING ANIMATIONS (Natural weight shifting, breathing & ready stances)
        p.idleTimer += dt;
        p.torsoMesh.rotation.x = THREE.MathUtils.lerp(p.torsoMesh.rotation.x, 0.04, dt * 6);
        p.torsoMesh.rotation.y = THREE.MathUtils.lerp(p.torsoMesh.rotation.y, 0, dt * 6);

        // Subtle realistic breathing & weight sway
        const breath = Math.sin(p.idleTimer * 2.2) * 0.016;
        p.torsoMesh.position.y = 1.35 + breath;
        p.headMesh.position.y = 2.0 + breath * 0.8;

        if (hasBall) {
          // BALL CARRIER IDLE STANCE (Triple-threat athletic crouch)
          p.leftLegPivot.rotation.x = THREE.MathUtils.lerp(p.leftLegPivot.rotation.x, 0.14, dt * 6);
          p.rightLegPivot.rotation.x = THREE.MathUtils.lerp(p.rightLegPivot.rotation.x, 0.16, dt * 6);
          p.leftKneePivot.rotation.x = THREE.MathUtils.lerp(p.leftKneePivot.rotation.x, 0.25, dt * 6);
          p.rightKneePivot.rotation.x = THREE.MathUtils.lerp(p.rightKneePivot.rotation.x, 0.28, dt * 6);
        } else {
          // OFF-BALL IDLE STANCES (Defenders vs Attackers)
          const isDefense = this.ballHolder ? p.data.team !== this.ballHolder.data.team : p.data.team === 'HOU';

          if (isDefense) {
            // DEFENDER READY STANCE: Wide base, deep knee bend, active hovering hands contesting passing lanes
            p.leftLegPivot.rotation.x = THREE.MathUtils.lerp(p.leftLegPivot.rotation.x, 0.22, dt * 6);
            p.rightLegPivot.rotation.x = THREE.MathUtils.lerp(p.rightLegPivot.rotation.x, 0.22, dt * 6);
            p.leftKneePivot.rotation.x = THREE.MathUtils.lerp(p.leftKneePivot.rotation.x, 0.42, dt * 6);
            p.rightKneePivot.rotation.x = THREE.MathUtils.lerp(p.rightKneePivot.rotation.x, 0.42, dt * 6);

            const sway = Math.sin(p.idleTimer * 2.4) * 0.06;
            p.leftArmPivot.rotation.x = -0.42 + sway;
            p.rightArmPivot.rotation.x = -0.42 - sway;
            p.leftArmPivot.rotation.z = -0.52 - Math.abs(sway);
            p.rightArmPivot.rotation.z = 0.52 + Math.abs(sway);
            p.leftElbowPivot.rotation.x = -0.48;
            p.rightElbowPivot.rotation.x = -0.48;
          } else {
            // OFFENSIVE OFF-BALL CATCH-AND-SHOOT STANCE: Hands raised around chest, ready to receive pass
            p.leftLegPivot.rotation.x = THREE.MathUtils.lerp(p.leftLegPivot.rotation.x, 0.08, dt * 6);
            p.rightLegPivot.rotation.x = THREE.MathUtils.lerp(p.rightLegPivot.rotation.x, 0.08, dt * 6);
            p.leftKneePivot.rotation.x = THREE.MathUtils.lerp(p.leftKneePivot.rotation.x, 0.14, dt * 6);
            p.rightKneePivot.rotation.x = THREE.MathUtils.lerp(p.rightKneePivot.rotation.x, 0.14, dt * 6);

            const sway = Math.sin(p.idleTimer * 2.0) * 0.03;
            p.leftArmPivot.rotation.x = -0.75 + sway;
            p.rightArmPivot.rotation.x = -0.75 + sway;
            p.leftArmPivot.rotation.z = -0.16;
            p.rightArmPivot.rotation.z = 0.16;
            p.leftElbowPivot.rotation.x = -1.25;
            p.rightElbowPivot.rotation.x = -1.25;
          }
        }
      }

      p.lastPos.copy(p.position);
    });
  }

  // --------------------------------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------------------------------
  private animate = (timestamp: number) => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    let dt = this.lastTimestamp > 0 ? (timestamp - this.lastTimestamp) / 1000 : 0.016;
    if (isNaN(dt) || dt <= 0 || dt > 0.05) dt = 0.016;
    this.lastTimestamp = timestamp;

    if (!this.isGameOver) {
      if (this.ballState !== 'FREE_THROW') {
        this.shotClock = Math.max(0, this.shotClock - dt);
        this.gameClock = Math.max(0, this.gameClock - dt);
        this.onShotClockUpdate?.(Math.ceil(this.shotClock));
        if (this.foulCooldownTimer > 0) {
          this.foulCooldownTimer = Math.max(0, this.foulCooldownTimer - dt);
        }
      }

      // Official Shot Clock Violation (Buzzer & Turnover)
      if (this.shotClock <= 0 && this.ballState === 'DRIBBLE') {
        sounds.playBuzzer();
        sounds.playWhistle();
        const curTeam = this.ballHolder?.data.team || 'GSW';
        const turnoverTeam = curTeam === 'GSW' ? 'HOU' : 'GSW';
        this.spawnFloatingStatus('24-SECOND SHOT CLOCK VIOLATION', this.ballPos, '#ff3344');
        this.onRuleViolation?.({
          violation: '24-SECOND SHOT CLOCK VIOLATION',
          team: curTeam,
          awardedTeam: turnoverTeam,
          description: `Shot clock expired with possession. Turnover, ball to ${turnoverTeam}.`,
        });
        this.executeInbound(turnoverTeam);
        this.shotClock = 24.0;
      }

      if (this.isChargingShot) {
        this.shotHoldTime += dt;
        const progress = Math.min(1.15, this.shotHoldTime / 0.65);
        const isGreen = Math.abs(this.shotHoldTime - 0.65) < 0.055;
        this.onShotMeterUpdate?.({
          value: progress,
          isCharging: true,
          isGreen,
          isFrozen: false,
        });
      }

      this.updatePlayerMovement(dt);
      this.updateHoustonAI(dt);
      this.updateBallPhysics(dt);
      this.checkOfficialNBARules(dt);
      this.updateCamera(dt);
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}

interface PlayerMesh extends THREE.Group {
  data: PlayerData;
  runCycle: number;
  lastPos: THREE.Vector3;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightKneePivot: THREE.Group;
  leftFootMesh: THREE.Mesh;
  rightFootMesh: THREE.Mesh;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  leftHandMesh: THREE.Mesh;
  rightHandMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  headMesh: THREE.Mesh;
  isShootingAnim?: boolean;
  shootAnimTimer?: number;
  isDunking?: boolean;
  dunkAnimTimer?: number;
  isDefendingAnim?: boolean;
  defendAnimTimer?: number;
  dribbleHand?: 'left' | 'right';
  currentSpeed: number;
  idleTimer: number;
  dribbleCycle: number;
  crossoverBlend: number;
}
