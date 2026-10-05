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
  skinColor?: string;
  hairColor?: string;
  hairStyle?: 'curry_curly' | 'klay_taper' | 'sengun_wave' | 'buzz' | 'dreads' | 'afro_fade' | 'textured_crop';
  hasBeard?: boolean;
  beardStyle?: 'goatee' | 'full_beard' | 'stubble' | 'clean' | 'scruff';
  hasHeadband?: boolean;
  headbandColor?: number;
  hasShootingSleeve?: boolean;
  sleeveArm?: 'left' | 'right';
  hasLegSleeve?: boolean;
  shoePrimaryColor?: number;
  shoeAccentColor?: number;
  heightScale?: number;
  widthScale?: number;
}

export interface ShotMeterEvent {
  value: number;
  isCharging: boolean;
  isGreen: boolean;
  isFrozen: boolean;
  quality?: string;
}

export type BallState = 'DRIBBLE' | 'SHOT' | 'REBOUND' | 'PASS' | 'BOUNCE_PASS' | 'MADE_DROP' | 'FREE_THROW' | 'INJURY_SUB';

export interface InjuryEventUI {
  injuredPlayer: PlayerData;
  substitutePlayer: PlayerData;
  injuryType: string;
  injuryDescription: string;
  stage: 'COLLAPSE' | 'SUB_ENTRY' | 'TAG_OUT' | 'RESUME';
  timer: number;
}

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
  isUserShooting?: boolean;
  canShoot?: boolean;
  isCharging?: boolean;
  ftMeterValue?: number;
  isGreen?: boolean;
  quality?: string;
  hasFocused?: boolean;
  routineAction?: 'NONE' | 'DRIBBLE' | 'SPIN' | 'FOCUS';
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
  isCharging?: boolean;
  chargeTime?: number;
  isGreen?: boolean;
  quality?: string;
  hasFocused?: boolean;
  routineAction?: 'NONE' | 'DRIBBLE' | 'SPIN' | 'FOCUS';
  routineActionTimer?: number;
  hasBouncedFloor?: boolean;
  missTargetPos?: THREE.Vector3;
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

  // Single Consolidated Nameplate & 2K Floor Indicator
  private nameplateSprite!: THREE.Sprite;
  private nameplateCanvas!: HTMLCanvasElement;
  private nameplateContext!: CanvasRenderingContext2D;
  private playerFloorRing!: THREE.Mesh;
  private playerFloorArrow!: THREE.Mesh;

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
  private houPlayType: 'PICK_AND_ROLL' | 'ISOLATION' | 'DRIVE_AND_KICK' | 'MOTION' = 'PICK_AND_ROLL';
  private houPlayTimer = 0;
  private houScreener: PlayerMesh | null = null;
  private gswCutTimer = 0;
  private gswScreenTimer = 0;
  private gswScreenActive = false;
  private gswScreener: PlayerMesh | null = null;

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
  private gswTeamFouls = 0;
  private houTeamFouls = 0;
  private lastBallTouchedTeam: 'GSW' | 'HOU' = 'GSW';
  private foulCooldownTimer = 0;
  private pendingShootingFoul: {
    shooter: PlayerMesh;
    fouler: PlayerMesh;
    attempts: number;
  } | null = null;

  // Bench Rosters & Injury Substitution State
  private gswBenchRoster: PlayerData[] = [];
  private houBenchRoster: PlayerData[] = [];
  private activeInjuryState: {
    injuredPlayer: PlayerMesh;
    substituteMesh: PlayerMesh;
    substituteData: PlayerData;
    injuryType: string;
    description: string;
    stage: 'COLLAPSE' | 'SUB_ENTRY' | 'TAG_OUT' | 'RESUME';
    timer: number;
    benchSidelinePos: THREE.Vector3;
    courtTargetPos: THREE.Vector3;
    initialInjuredPos: THREE.Vector3;
    possessionTeam: 'GSW' | 'HOU';
  } | null = null;
  private exhaustionSprintTimer = 0;
  private collisionCooldownTimer = 0;

  // Callbacks
  public onScoreUpdate?: (home: number, away: number, points: number, team: string) => void;
  public onShotMeterUpdate?: (event: ShotMeterEvent) => void;
  public onShotReleased?: (quality: string, isGreen: boolean) => void;
  public onShotClockUpdate?: (seconds: number) => void;
  public onPossessionChange?: (hasBall: boolean) => void;
  public onStaminaUpdate?: (stamina: number) => void;
  public onFoulEvent?: (event: FoulEventUI | null) => void;
  public onInjuryEvent?: (event: InjuryEventUI | null) => void;
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
    this.createPlayerFloorRing();
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
  // 2K SIGNATURE CONTROLLED PLAYER FLOOR RING
  // --------------------------------------------------------------------------
  private createPlayerFloorRing() {
    const ringGeo = new THREE.RingGeometry(0.55, 0.68, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfdb927,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.playerFloorRing = new THREE.Mesh(ringGeo, ringMat);
    this.playerFloorRing.rotation.x = -Math.PI / 2;
    this.playerFloorRing.position.set(0, 0.02, 0);
    this.scene.add(this.playerFloorRing);

    // Forward direction indicator chevron
    const arrowGeo = new THREE.ConeGeometry(0.16, 0.28, 3);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xfdb927,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.playerFloorArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.playerFloorArrow.rotation.x = -Math.PI / 2;
    this.playerFloorArrow.position.set(0, 0.02, 0.76);
    this.playerFloorRing.add(this.playerFloorArrow);
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
  // SINGLE CONSOLIDATED NAMEPLATE (COMPACT 2K STYLE)
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
      depthTest: true,
      depthWrite: false,
    });

    this.nameplateSprite = new THREE.Sprite(spriteMat);
    this.nameplateSprite.scale.set(0.95, 0.24, 1.0);
    this.nameplateSprite.renderOrder = 20;
    this.nameplateSprite.visible = false;
  }

  public setControlledPlayer(player: PlayerMesh) {
    if (this.nameplateSprite.parent) {
      this.nameplateSprite.parent.remove(this.nameplateSprite);
    }

    this.controlledPlayer = player;
    this.nameplateSprite.position.set(0, 2.38, 0);
    player.add(this.nameplateSprite);

    this.updateControlledNameplate(player);
  }

  private updateControlledNameplate(player: PlayerMesh) {
    const ctx = this.nameplateContext;
    ctx.clearRect(0, 0, 512, 128);

    const isGSW = player.data.team === 'GSW';

    ctx.shadowColor = isGSW ? 'rgba(0, 83, 188, 0.5)' : 'rgba(206, 17, 65, 0.5)';
    ctx.shadowBlur = 8;

    ctx.fillStyle = isGSW ? 'rgba(10, 25, 65, 0.92)' : 'rgba(75, 10, 25, 0.92)';
    ctx.beginPath();
    ctx.roundRect(24, 20, 464, 88, 20);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = isGSW ? '#fdb927' : '#ffffff';
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.fillStyle = isGSW ? '#fdb927' : '#ffffff';
    ctx.font = '900 34px Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isGSW ? 'GSW' : 'HOU', 80, 64);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(130, 30);
    ctx.lineTo(130, 98);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${player.data.name} #${player.data.number}`, 148, 64);

    (this.nameplateSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    this.nameplateSprite.visible = this.ballState !== 'FREE_THROW' && this.ballState !== 'SHOT' && !this.isChargingShot;
  }

  // --------------------------------------------------------------------------
  // CHARACTER VISUAL DETAIL GENERATORS (JERSEYS, FACES, HAIR, SNEAKERS)
  // --------------------------------------------------------------------------
  private createJerseyMaterials(data: PlayerData): THREE.MeshStandardMaterial[] {
    const isGSW = data.team === 'GSW';
    const primaryColorHex = isGSW ? '#0053bc' : '#ce1141';
    const secondaryColorHex = isGSW ? '#fdb927' : '#ffffff';
    const trimColorHex = isGSW ? '#ffffff' : '#181818';

    // 1. FRONT JERSEY CANVAS (Wordmark, Crest, Number, Ribbed V-Neck, Mesh Texture)
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = 512;
    frontCanvas.height = 512;
    const fCtx = frontCanvas.getContext('2d')!;

    fCtx.fillStyle = primaryColorHex;
    fCtx.fillRect(0, 0, 512, 512);

    // Staggered breathable micro-mesh fabric texture
    fCtx.fillStyle = 'rgba(0, 0, 0, 0.09)';
    for (let y = 14; y < 500; y += 12) {
      const shift = (Math.floor(y / 12) % 2) * 6;
      for (let x = 14 + shift; x < 500; x += 12) {
        fCtx.fillRect(x, y, 2, 2);
      }
    }

    // Ribbed V-Neck Collar
    fCtx.fillStyle = secondaryColorHex;
    fCtx.beginPath();
    fCtx.moveTo(172, 0);
    fCtx.lineTo(256, 76);
    fCtx.lineTo(340, 0);
    fCtx.lineWidth = 18;
    fCtx.strokeStyle = secondaryColorHex;
    fCtx.stroke();

    fCtx.lineWidth = 6;
    fCtx.strokeStyle = trimColorHex;
    fCtx.beginPath();
    fCtx.moveTo(178, 0);
    fCtx.lineTo(256, 70);
    fCtx.lineTo(334, 0);
    fCtx.stroke();

    // Armhole Ribbed Trim Borders
    fCtx.strokeStyle = secondaryColorHex;
    fCtx.lineWidth = 14;
    fCtx.beginPath();
    fCtx.moveTo(0, 0);
    fCtx.lineTo(0, 220);
    fCtx.moveTo(512, 0);
    fCtx.lineTo(512, 220);
    fCtx.stroke();

    fCtx.strokeStyle = trimColorHex;
    fCtx.lineWidth = 4;
    fCtx.beginPath();
    fCtx.moveTo(8, 0);
    fCtx.lineTo(8, 220);
    fCtx.moveTo(504, 0);
    fCtx.lineTo(504, 220);
    fCtx.stroke();

    // NBA Logoman Patch (Left Upper Chest)
    fCtx.fillStyle = '#0053bc';
    fCtx.fillRect(115, 68, 14, 28);
    fCtx.fillStyle = '#ce1141';
    fCtx.fillRect(129, 68, 14, 28);
    fCtx.fillStyle = '#ffffff';
    fCtx.beginPath();
    fCtx.arc(122, 76, 4, 0, Math.PI * 2);
    fCtx.fill();

    // Team Emblem & Front Number
    fCtx.textAlign = 'center';
    fCtx.textBaseline = 'middle';
    if (isGSW) {
      // Golden State Warriors: Iconic Bridge Ring & "WARRIORS"
      fCtx.save();
      fCtx.strokeStyle = '#fdb927';
      fCtx.lineWidth = 10;
      fCtx.beginPath();
      fCtx.arc(256, 225, 86, 0, Math.PI * 2);
      fCtx.stroke();

      fCtx.fillStyle = '#fdb927';
      fCtx.font = '900 46px Impact, system-ui, sans-serif';
      fCtx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      fCtx.shadowBlur = 6;
      fCtx.fillText('WARRIORS', 256, 122);

      fCtx.font = '900 88px Impact, system-ui, sans-serif';
      fCtx.fillStyle = '#fdb927';
      fCtx.shadowBlur = 4;
      fCtx.fillText(data.number, 256, 225);

      fCtx.lineWidth = 4;
      fCtx.strokeStyle = '#ffffff';
      fCtx.strokeText(data.number, 256, 225);
      fCtx.restore();
    } else {
      // Houston Rockets: Modern Bold "ROCKETS" & White Outlined Number
      fCtx.save();
      fCtx.fillStyle = '#ffffff';
      fCtx.font = '900 52px Impact, system-ui, sans-serif';
      fCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      fCtx.shadowBlur = 8;
      fCtx.fillText('ROCKETS', 256, 126);

      fCtx.strokeStyle = '#181818';
      fCtx.lineWidth = 6;
      fCtx.strokeText('ROCKETS', 256, 126);

      fCtx.font = '900 98px Impact, system-ui, sans-serif';
      fCtx.fillStyle = '#ffffff';
      fCtx.shadowBlur = 6;
      fCtx.fillText(data.number, 256, 240);

      fCtx.lineWidth = 6;
      fCtx.strokeStyle = '#181818';
      fCtx.strokeText(data.number, 256, 240);
      fCtx.restore();
    }

    // 2. BACK JERSEY CANVAS (Arched Surname & Large Number)
    const backCanvas = document.createElement('canvas');
    backCanvas.width = 512;
    backCanvas.height = 512;
    const bCtx = backCanvas.getContext('2d')!;

    bCtx.fillStyle = primaryColorHex;
    bCtx.fillRect(0, 0, 512, 512);

    bCtx.fillStyle = 'rgba(0, 0, 0, 0.09)';
    for (let y = 14; y < 500; y += 12) {
      const shift = (Math.floor(y / 12) % 2) * 6;
      for (let x = 14 + shift; x < 500; x += 12) {
        bCtx.fillRect(x, y, 2, 2);
      }
    }

    // Upper collar stripe
    bCtx.fillStyle = secondaryColorHex;
    bCtx.fillRect(170, 0, 172, 14);

    // NBA Logoman below collar
    bCtx.fillStyle = '#0053bc';
    bCtx.fillRect(242, 22, 14, 24);
    bCtx.fillStyle = '#ce1141';
    bCtx.fillRect(256, 22, 14, 24);

    // Player Surname
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.font = '900 50px Impact, system-ui, sans-serif';
    bCtx.fillStyle = isGSW ? '#fdb927' : '#ffffff';
    bCtx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    bCtx.shadowBlur = 6;

    const surname = data.name.includes('.') ? data.name.split('.').slice(1).join('.').trim() : data.name;
    bCtx.fillText(surname, 256, 92);
    bCtx.lineWidth = 3;
    bCtx.strokeStyle = isGSW ? '#ffffff' : '#181818';
    bCtx.strokeText(surname, 256, 92);

    // Large Back Number
    bCtx.font = '900 170px Impact, system-ui, sans-serif';
    bCtx.fillStyle = isGSW ? '#fdb927' : '#ffffff';
    bCtx.shadowBlur = 8;
    bCtx.fillText(data.number, 256, 255);

    bCtx.lineWidth = 8;
    bCtx.strokeStyle = isGSW ? '#ffffff' : '#181818';
    bCtx.strokeText(data.number, 256, 255);

    // 3. SIDES CANVAS (Team Racing / Side Trim Panels)
    const sideCanvas = document.createElement('canvas');
    sideCanvas.width = 128;
    sideCanvas.height = 512;
    const sCtx = sideCanvas.getContext('2d')!;

    sCtx.fillStyle = primaryColorHex;
    sCtx.fillRect(0, 0, 128, 512);

    if (isGSW) {
      sCtx.fillStyle = '#fdb927';
      sCtx.fillRect(44, 0, 40, 512);
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(58, 0, 12, 512);
    } else {
      sCtx.fillStyle = '#181818';
      sCtx.fillRect(38, 0, 52, 512);
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(56, 0, 16, 512);
    }

    // 4. TOP & BOTTOM CANVAS
    const topCanvas = document.createElement('canvas');
    topCanvas.width = 256;
    topCanvas.height = 128;
    const tCtx = topCanvas.getContext('2d')!;
    tCtx.fillStyle = primaryColorHex;
    tCtx.fillRect(0, 0, 256, 128);
    tCtx.fillStyle = secondaryColorHex;
    tCtx.fillRect(40, 40, 176, 48);

    const frontTex = new THREE.CanvasTexture(frontCanvas);
    const backTex = new THREE.CanvasTexture(backCanvas);
    const sideTex = new THREE.CanvasTexture(sideCanvas);
    const topTex = new THREE.CanvasTexture(topCanvas);

    const baseProps = { roughness: 0.42, metalness: 0.06 };

    return [
      new THREE.MeshStandardMaterial({ map: sideTex, ...baseProps }), // +X (Right)
      new THREE.MeshStandardMaterial({ map: sideTex, ...baseProps }), // -X (Left)
      new THREE.MeshStandardMaterial({ map: topTex, ...baseProps }),  // +Y (Top)
      new THREE.MeshStandardMaterial({ color: isGSW ? 0x0053bc : 0xce1141, ...baseProps }), // -Y (Bottom)
      new THREE.MeshStandardMaterial({ map: frontTex, ...baseProps }), // +Z (Front)
      new THREE.MeshStandardMaterial({ map: backTex, ...baseProps }),  // -Z (Back)
    ];
  }

  private createFaceDecal(data: PlayerData, skinHex: string): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 256, 256);

    // Subtle skin depth tone
    const grad = ctx.createRadialGradient(128, 128, 30, 128, 128, 120);
    grad.addColorStop(0, skinHex);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // 1. Athletic Eyes with Specular Sparkle
    const eyeY = 102;
    const eyeDist = 42;
    [-eyeDist, eyeDist].forEach(offset => {
      const ex = 128 + offset;

      // Socket shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY - 2, 17, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sclera (White)
      ctx.fillStyle = '#f4f6fa';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iris (Dark Brown)
      ctx.fillStyle = '#26170d';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = '#0a0604';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex - 2, eyeY - 2, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Upper eyelid definition
      ctx.strokeStyle = '#1a0e07';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY - 2, 15, 8, 0, Math.PI, 0);
      ctx.stroke();
    });

    // 2. Eyebrows
    ctx.strokeStyle = data.hairColor || '#18100a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(76, eyeY - 14);
    ctx.quadraticCurveTo(88, eyeY - 21, 108, eyeY - 16);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(148, eyeY - 16);
    ctx.quadraticCurveTo(168, eyeY - 21, 180, eyeY - 14);
    ctx.stroke();

    // 3. Shaded Nose Bridge & Nostrils
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(125, eyeY - 5);
    ctx.lineTo(124, 142);
    ctx.lineTo(132, 142);
    ctx.stroke();

    ctx.fillStyle = 'rgba(30, 15, 8, 0.5)';
    ctx.beginPath();
    ctx.ellipse(119, 144, 4, 2.5, -0.2, 0, Math.PI * 2);
    ctx.ellipse(137, 144, 4, 2.5, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 4. Athletic Lips
    const mouthY = 168;
    ctx.strokeStyle = 'rgba(60, 25, 15, 0.55)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(112, mouthY);
    ctx.quadraticCurveTo(128, mouthY + 3, 144, mouthY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(80, 30, 20, 0.25)';
    ctx.beginPath();
    ctx.ellipse(128, mouthY + 5, 12, 4, 0, 0, Math.PI);
    ctx.fill();

    // 5. Player-Specific Facial Hair
    if (data.hasBeard) {
      const beardColor = 'rgba(24, 15, 10, 0.88)';
      ctx.fillStyle = beardColor;
      ctx.strokeStyle = beardColor;

      if (data.beardStyle === 'goatee') {
        // Curry / Thompson / Jalen Green
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(115, mouthY - 8);
        ctx.lineTo(141, mouthY - 8);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(128, mouthY + 16, 12, 10, 0, 0, Math.PI);
        ctx.fill();
      } else if (data.beardStyle === 'full_beard') {
        // VanVleet / Draymond Green / Looney / Brooks
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(92, 142);
        ctx.quadraticCurveTo(100, 175, 128, 192);
        ctx.quadraticCurveTo(156, 175, 164, 142);
        ctx.stroke();

        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(112, mouthY - 8);
        ctx.lineTo(144, mouthY - 8);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(128, mouthY + 16, 22, 14, 0, 0, Math.PI);
        ctx.fill();
      } else if (data.beardStyle === 'stubble' || data.beardStyle === 'scruff') {
        // Sengun / Wiggins
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(30, 18, 12, 0.5)';
        ctx.beginPath();
        ctx.moveTo(96, 148);
        ctx.quadraticCurveTo(105, 175, 128, 188);
        ctx.quadraticCurveTo(151, 175, 160, 148);
        ctx.stroke();

        ctx.fillStyle = 'rgba(30, 18, 12, 0.4)';
        ctx.beginPath();
        ctx.ellipse(128, mouthY + 14, 16, 8, 0, 0, Math.PI);
        ctx.fill();
      }
    }

    // 6. Hairline Taper on Forehead
    ctx.fillStyle = data.hairColor || '#18100a';
    ctx.beginPath();
    ctx.moveTo(68, eyeY - 26);
    ctx.quadraticCurveTo(128, eyeY - 45, 188, eyeY - 26);
    ctx.lineTo(188, 30);
    ctx.lineTo(68, 30);
    ctx.fill();

    const faceTex = new THREE.CanvasTexture(canvas);
    const faceMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    });

    const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), faceMat);
    faceMesh.position.set(0, 0.01, 0.185);
    return faceMesh;
  }

  private createHairMesh(data: PlayerData): THREE.Group {
    const hairGroup = new THREE.Group();
    const hairColorHex = data.hairColor ? parseInt(data.hairColor.replace('#', '0x')) : 0x18100a;
    const hairMat = new THREE.MeshStandardMaterial({
      color: hairColorHex,
      roughness: 0.9,
      metalness: 0.05,
    });

    if (data.hairStyle === 'curry_curly' || data.hairStyle === 'afro_fade') {
      const capGeo = new THREE.SphereGeometry(0.208, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.y = 0.02;
      hairGroup.add(cap);

      const curlGeo = new THREE.DodecahedronGeometry(0.045);
      [-0.07, 0, 0.07].forEach(x => {
        [-0.05, 0.05].forEach(z => {
          const curl = new THREE.Mesh(curlGeo, hairMat);
          curl.position.set(x, 0.17, z);
          hairGroup.add(curl);
        });
      });
    } else if (data.hairStyle === 'klay_taper' || data.hairStyle === 'textured_crop') {
      const capGeo = new THREE.SphereGeometry(0.206, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.y = 0.02;
      hairGroup.add(cap);
    } else if (data.hairStyle === 'sengun_wave') {
      const capGeo = new THREE.SphereGeometry(0.212, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.y = 0.025;
      hairGroup.add(cap);

      const waveGeo = new THREE.BoxGeometry(0.22, 0.06, 0.24);
      const wave = new THREE.Mesh(waveGeo, hairMat);
      wave.position.set(0, 0.18, 0.02);
      hairGroup.add(wave);
    } else if (data.hairStyle === 'dreads') {
      const capGeo = new THREE.SphereGeometry(0.21, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const cap = new THREE.Mesh(capGeo, hairMat);
      hairGroup.add(cap);

      const locGeo = new THREE.CylinderGeometry(0.015, 0.012, 0.12, 6);
      const angles = [0.2, 0.8, 1.4, 2.0, 2.6, 3.2, 3.8, 4.4, 5.0, 5.6];
      angles.forEach(ang => {
        const loc = new THREE.Mesh(locGeo, hairMat);
        loc.position.set(Math.cos(ang) * 0.16, 0.12, Math.sin(ang) * 0.16);
        loc.rotation.z = Math.cos(ang) * 0.35;
        loc.rotation.x = Math.sin(ang) * 0.35;
        hairGroup.add(loc);
      });
    } else {
      const capGeo = new THREE.SphereGeometry(0.204, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.50);
      const cap = new THREE.Mesh(capGeo, hairMat);
      cap.position.y = 0.02;
      hairGroup.add(cap);
    }

    return hairGroup;
  }

  private createEars(skinMat: THREE.Material): THREE.Group {
    const earGroup = new THREE.Group();
    const earGeo = new THREE.CylinderGeometry(0.035, 0.025, 0.065, 8);
    [-0.195, 0.195].forEach(x => {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(x, 0, -0.01);
      ear.rotation.z = x > 0 ? 0.25 : -0.25;
      ear.rotation.y = x > 0 ? 0.3 : -0.3;
      earGroup.add(ear);
    });
    return earGroup;
  }

  private createHeadband(color: number): THREE.Mesh {
    const hbGeo = new THREE.CylinderGeometry(0.208, 0.208, 0.055, 24, 1, true);
    const hbMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.1,
    });
    const hb = new THREE.Mesh(hbGeo, hbMat);
    hb.position.set(0, 0.075, 0);

    const badgeGeo = new THREE.PlaneGeometry(0.04, 0.025);
    const badgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.set(0, 0, 0.21);
    hb.add(badge);

    return hb;
  }

  private createSneaker(data: PlayerData, isLeft: boolean): THREE.Group {
    const shoeGroup = new THREE.Group();
    const primaryColor = data.shoePrimaryColor ?? (data.team === 'GSW' ? 0xffffff : 0x181818);
    const accentColor = data.shoeAccentColor ?? (data.team === 'GSW' ? 0xfdb927 : 0xce1141);

    // 1. Rubber Outsole & Cushioned Midsole
    const soleGeo = new THREE.BoxGeometry(0.165, 0.042, 0.30);
    const soleMat = new THREE.MeshStandardMaterial({
      color: 0xf5f6fa,
      roughness: 0.85,
      metalness: 0.02,
    });
    const sole = new THREE.Mesh(soleGeo, soleMat);
    sole.position.set(0, -0.038, 0.01);
    sole.castShadow = true;
    shoeGroup.add(sole);

    // Midsole Accent Cushion unit
    const cushionGeo = new THREE.BoxGeometry(0.168, 0.018, 0.16);
    const cushionMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.35,
      metalness: 0.2,
    });
    const cushion = new THREE.Mesh(cushionGeo, cushionMat);
    cushion.position.set(0, -0.028, -0.04);
    shoeGroup.add(cushion);

    // 2. Sneaker Upper
    const upperGeo = new THREE.BoxGeometry(0.155, 0.088, 0.27);
    const upperMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.45,
      metalness: 0.1,
    });
    const upper = new THREE.Mesh(upperGeo, upperMat);
    upper.position.set(0, 0.025, 0.005);
    upper.castShadow = true;
    shoeGroup.add(upper);

    // 3. Padded High-top Ankle Collar
    const collarGeo = new THREE.BoxGeometry(0.148, 0.065, 0.14);
    const collarMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.5,
    });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.set(0, 0.08, -0.05);
    shoeGroup.add(collar);

    // 4. Contrasting Toe Cap
    const toeGeo = new THREE.BoxGeometry(0.152, 0.045, 0.09);
    const toeMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.4,
    });
    const toe = new THREE.Mesh(toeGeo, toeMat);
    toe.position.set(0, 0.012, 0.10);
    shoeGroup.add(toe);

    // 5. Instep Laces & Tongue
    const lacesGeo = new THREE.BoxGeometry(0.09, 0.035, 0.14);
    const lacesMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.7,
    });
    const laces = new THREE.Mesh(lacesGeo, lacesMat);
    laces.position.set(0, 0.065, 0.035);
    shoeGroup.add(laces);

    // 6. Signature Brand Slash on outer lateral side
    const brandGeo = new THREE.PlaneGeometry(0.12, 0.032);
    const brandMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const brandMesh = new THREE.Mesh(brandGeo, brandMat);
    const lateralX = isLeft ? -0.079 : 0.079;
    brandMesh.position.set(lateralX, 0.03, 0);
    brandMesh.rotation.y = isLeft ? -Math.PI / 2 : Math.PI / 2;
    shoeGroup.add(brandMesh);

    return shoeGroup;
  }

  private createSocks(data: PlayerData): THREE.Group {
    const sockGroup = new THREE.Group();
    const sockColorHex = 0xf5f7fb;
    const sockMat = new THREE.MeshStandardMaterial({
      color: sockColorHex,
      roughness: 0.85,
    });

    // Ribbed crew sock
    const sockGeo = new THREE.CylinderGeometry(0.092, 0.082, 0.22, 14);
    const sock = new THREE.Mesh(sockGeo, sockMat);
    sock.position.set(0, -0.31, 0);
    sock.castShadow = true;
    sockGroup.add(sock);

    // Dual compression team stripes
    const stripeColor1 = data.team === 'GSW' ? 0x0053bc : 0xce1141;
    const stripeColor2 = data.team === 'GSW' ? 0xfdb927 : 0x181818;

    const s1Mat = new THREE.MeshBasicMaterial({ color: stripeColor1 });
    const s2Mat = new THREE.MeshBasicMaterial({ color: stripeColor2 });

    const stripeGeo = new THREE.CylinderGeometry(0.093, 0.093, 0.018, 14);
    const stripe1 = new THREE.Mesh(stripeGeo, s1Mat);
    stripe1.position.set(0, -0.22, 0);
    sockGroup.add(stripe1);

    const stripe2 = new THREE.Mesh(stripeGeo, s2Mat);
    stripe2.position.set(0, -0.245, 0);
    sockGroup.add(stripe2);

    return sockGroup;
  }

  private createDeltoids(jerseyColor: number): THREE.Group {
    const shoulderGroup = new THREE.Group();
    const shoulderGeo = new THREE.SphereGeometry(0.095, 12, 10);
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: jerseyColor,
      roughness: 0.45,
    });

    [-0.34, 0.34].forEach(x => {
      const shoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
      shoulder.position.set(x, 0.38, 0);
      shoulder.scale.set(1.1, 0.75, 0.9);
      shoulderGroup.add(shoulder);
    });
    return shoulderGroup;
  }

  private createWaistband(data: PlayerData): THREE.Group {
    const wbGroup = new THREE.Group();
    const isGSW = data.team === 'GSW';
    const bandMat = new THREE.MeshStandardMaterial({
      color: isGSW ? 0xfdb927 : 0x181818,
      roughness: 0.4,
    });
    const bandGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.065, 20);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 0.95, 0);
    wbGroup.add(band);

    const knotGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const knotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    knot.position.set(0, 0.95, 0.18);
    wbGroup.add(knot);

    return wbGroup;
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
    const skinHex = data.skinColor || '#c68642';
    const skinColorInt = parseInt(skinHex.replace('#', '0x'));
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColorInt, roughness: 0.65 });

    // 1. Torso with HD Multi-Face Textured Jersey
    const jerseyMats = this.createJerseyMaterials(data);
    const torsoGeo = new THREE.BoxGeometry(0.65, 0.85, 0.35);
    const torso = new THREE.Mesh(torsoGeo, jerseyMats);
    torso.position.y = 1.35;
    torso.castShadow = true;

    // Muscular Deltoid Shoulder Caps
    const deltoids = this.createDeltoids(jerseyColor);
    torso.add(deltoids);
    group.add(torso);

    // Elastic Waistband with Drawstring
    const waistband = this.createWaistband(data);
    group.add(waistband);

    // 2. Head with Anatomical Neck, Expressive Face Decal, 3D Hair, Ears & Headband
    const headGeo = new THREE.SphereGeometry(0.20, 24, 20);
    const headMat = new THREE.MeshStandardMaterial({ color: skinColorInt, roughness: 0.65 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.scale.set(0.92, 1.05, 0.98);
    head.position.y = 2.0;
    head.castShadow = true;

    // Muscular Neck Connecting Head to Torso
    const neckGeo = new THREE.CylinderGeometry(0.085, 0.098, 0.20, 14);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.set(0, -0.15, 0);
    neck.castShadow = true;
    head.add(neck);

    // High-Resolution Expressive Face Decal
    const faceDecal = this.createFaceDecal(data, skinHex);
    head.add(faceDecal);

    // Anatomical Ears
    const ears = this.createEars(skinMat);
    head.add(ears);

    // Signature 3D Hair Geometry
    const hair = this.createHairMesh(data);
    head.add(hair);

    // Embroidered Headband if equipped
    if (data.hasHeadband) {
      const hbColor = data.headbandColor ?? (data.team === 'GSW' ? 0x0053bc : 0x181818);
      head.add(this.createHeadband(hbColor));
    }
    group.add(head);

    // 3. Legs with Hip & Knee Articulations, Shorts Piping, Crew Socks & Sculpted Sneakers
    const thighGeo = new THREE.CylinderGeometry(0.105, 0.092, 0.44, 14);
    const shinGeo = new THREE.CylinderGeometry(0.086, 0.072, 0.44, 14);
    const shortsMat = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.55 });

    // Shorts hem piping
    const hemGeo = new THREE.TorusGeometry(0.096, 0.012, 8, 16);
    const hemMat = new THREE.MeshBasicMaterial({ color: data.team === 'GSW' ? 0xfdb927 : 0xffffff });

    // Compression leg sleeve / tights
    const legSleeveMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.4 });
    const shinMat = data.hasLegSleeve ? legSleeveMat : skinMat;

    // Left Leg
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.20, 0.95, 0);
    const leftThigh = new THREE.Mesh(thighGeo, shortsMat);
    leftThigh.position.y = -0.22;
    leftThigh.castShadow = true;
    leftLegPivot.add(leftThigh);

    const leftHem = new THREE.Mesh(hemGeo, hemMat);
    leftHem.rotation.x = Math.PI / 2;
    leftHem.position.y = -0.42;
    leftLegPivot.add(leftHem);

    const leftKneePivot = new THREE.Group();
    leftKneePivot.position.set(0, -0.44, 0);
    const leftShin = new THREE.Mesh(shinGeo, shinMat);
    leftShin.position.y = -0.22;
    leftShin.castShadow = true;
    leftKneePivot.add(leftShin);

    // Ribbed athletic crew socks
    const leftSocks = this.createSocks(data);
    leftKneePivot.add(leftSocks);

    // Sculpted basketball sneaker
    const leftFoot = this.createSneaker(data, true);
    leftFoot.position.set(0, -0.44, 0.06);
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

    const rightHem = new THREE.Mesh(hemGeo, hemMat);
    rightHem.rotation.x = Math.PI / 2;
    rightHem.position.y = -0.42;
    rightLegPivot.add(rightHem);

    const rightKneePivot = new THREE.Group();
    rightKneePivot.position.set(0, -0.44, 0);
    const rightShin = new THREE.Mesh(shinGeo, shinMat);
    rightShin.position.y = -0.22;
    rightShin.castShadow = true;
    rightKneePivot.add(rightShin);

    const rightSocks = this.createSocks(data);
    rightKneePivot.add(rightSocks);

    const rightFoot = this.createSneaker(data, false);
    rightFoot.position.set(0, -0.44, 0.06);
    rightKneePivot.add(rightFoot);

    rightLegPivot.add(rightKneePivot);
    group.add(rightLegPivot);

    // 4. Arms with Shoulder & Elbow Articulations, Shooting Compression Sleeves & Wristbands
    const upperArmGeo = new THREE.CylinderGeometry(0.082, 0.074, 0.34, 12);
    const forearmGeo = new THREE.CylinderGeometry(0.072, 0.062, 0.34, 12);
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fb, roughness: 0.35, metalness: 0.08 });

    const leftArmHasSleeve = !!(data.hasShootingSleeve && data.sleeveArm === 'left');
    const rightArmHasSleeve = !!(data.hasShootingSleeve && (data.sleeveArm === 'right' || !data.sleeveArm));

    const leftArmMat = leftArmHasSleeve ? sleeveMat : skinMat;
    const rightArmMat = rightArmHasSleeve ? sleeveMat : skinMat;

    // Sculpted Athletic Hands
    const handGeo = new THREE.BoxGeometry(0.09, 0.11, 0.055);

    // Left Arm
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.40, 1.68, 0);
    const leftUpperArm = new THREE.Mesh(upperArmGeo, leftArmMat);
    leftUpperArm.position.y = -0.17;
    leftUpperArm.castShadow = true;
    leftArmPivot.add(leftUpperArm);

    const leftElbowPivot = new THREE.Group();
    leftElbowPivot.position.set(0, -0.34, 0);
    const leftForearm = new THREE.Mesh(forearmGeo, leftArmMat);
    leftForearm.position.y = -0.17;
    leftForearm.castShadow = true;
    leftElbowPivot.add(leftForearm);

    if (leftArmHasSleeve) {
      const wristbandGeo = new THREE.CylinderGeometry(0.066, 0.064, 0.045, 12);
      const wristbandMat = new THREE.MeshStandardMaterial({
        color: data.team === 'GSW' ? 0xfdb927 : 0xffffff,
        roughness: 0.5,
      });
      const wb = new THREE.Mesh(wristbandGeo, wristbandMat);
      wb.position.set(0, -0.32, 0);
      leftElbowPivot.add(wb);
    }

    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.set(0, -0.38, 0);
    leftHand.castShadow = true;
    leftElbowPivot.add(leftHand);

    leftArmPivot.add(leftElbowPivot);
    group.add(leftArmPivot);

    // Right Arm
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.40, 1.68, 0);
    const rightUpperArm = new THREE.Mesh(upperArmGeo, rightArmMat);
    rightUpperArm.position.y = -0.17;
    rightUpperArm.castShadow = true;
    rightArmPivot.add(rightUpperArm);

    const rightElbowPivot = new THREE.Group();
    rightElbowPivot.position.set(0, -0.34, 0);
    const rightForearm = new THREE.Mesh(forearmGeo, rightArmMat);
    rightForearm.position.y = -0.17;
    rightForearm.castShadow = true;
    rightElbowPivot.add(rightForearm);

    if (rightArmHasSleeve) {
      const wristbandGeo = new THREE.CylinderGeometry(0.066, 0.064, 0.045, 12);
      const wristbandMat = new THREE.MeshStandardMaterial({
        color: data.team === 'GSW' ? 0xfdb927 : 0xffffff,
        roughness: 0.5,
      });
      const wb = new THREE.Mesh(wristbandGeo, wristbandMat);
      wb.position.set(0, -0.32, 0);
      rightElbowPivot.add(wb);
    }

    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.set(0, -0.38, 0);
    rightHand.castShadow = true;
    rightElbowPivot.add(rightHand);

    rightArmPivot.add(rightElbowPivot);
    group.add(rightArmPivot);

    // Apply NBA Positional Proportions (Height & Bulk Scales)
    const wScale = data.widthScale || 1.0;
    const hScale = data.heightScale || 1.0;
    group.scale.set(wScale, hScale, wScale);

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
      {
        id: 'curry',
        name: 'S. CURRY',
        number: '30',
        team: 'GSW',
        position: 'PG',
        threePointRating: 99,
        midRangeRating: 96,
        speed: 4.8,
        personalFouls: 1,
        skinColor: '#d69660',
        hairColor: '#20140d',
        hairStyle: 'curry_curly',
        hasBeard: true,
        beardStyle: 'goatee',
        hasHeadband: false,
        hasShootingSleeve: true,
        sleeveArm: 'right',
        heightScale: 0.96,
        widthScale: 0.95,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0xfdb927,
      },
      {
        id: 'thompson',
        name: 'K. THOMPSON',
        number: '11',
        team: 'GSW',
        position: 'SG',
        threePointRating: 92,
        midRangeRating: 90,
        speed: 4.4,
        personalFouls: 0,
        skinColor: '#e0a679',
        hairColor: '#241810',
        hairStyle: 'klay_taper',
        hasBeard: true,
        beardStyle: 'goatee',
        hasHeadband: true,
        headbandColor: 0x0053bc,
        hasShootingSleeve: false,
        heightScale: 1.01,
        widthScale: 0.98,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
      {
        id: 'wiggins',
        name: 'A. WIGGINS',
        number: '22',
        team: 'GSW',
        position: 'SF',
        threePointRating: 84,
        midRangeRating: 85,
        speed: 4.6,
        personalFouls: 1,
        skinColor: '#5a3922',
        hairColor: '#120c08',
        hairStyle: 'dreads',
        hasBeard: true,
        beardStyle: 'scruff',
        hasHeadband: false,
        hasShootingSleeve: true,
        sleeveArm: 'left',
        heightScale: 1.03,
        widthScale: 1.00,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0x0053bc,
      },
      {
        id: 'green',
        name: 'D. GREEN',
        number: '23',
        team: 'GSW',
        position: 'PF',
        threePointRating: 75,
        midRangeRating: 78,
        speed: 4.2,
        personalFouls: 2,
        skinColor: '#492f1b',
        hairColor: '#110a07',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        hasHeadband: false,
        hasShootingSleeve: false,
        hasLegSleeve: true,
        heightScale: 1.02,
        widthScale: 1.08,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0xfdb927,
      },
      {
        id: 'looney',
        name: 'K. LOONEY',
        number: '5',
        team: 'GSW',
        position: 'C',
        threePointRating: 60,
        midRangeRating: 72,
        speed: 3.8,
        personalFouls: 1,
        skinColor: '#422816',
        hairColor: '#100a07',
        hairStyle: 'afro_fade',
        hasBeard: true,
        beardStyle: 'full_beard',
        hasHeadband: false,
        hasShootingSleeve: false,
        hasLegSleeve: true,
        heightScale: 1.09,
        widthScale: 1.10,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
    ];

    const houRoster: PlayerData[] = [
      {
        id: 'vanvleet',
        name: 'F. VANVLEET',
        number: '5',
        team: 'HOU',
        position: 'PG',
        threePointRating: 88,
        midRangeRating: 86,
        speed: 4.5,
        personalFouls: 1,
        skinColor: '#be8250',
        hairColor: '#1a100a',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        hasHeadband: true,
        headbandColor: 0xffffff,
        hasShootingSleeve: false,
        heightScale: 0.94,
        widthScale: 0.97,
        shoePrimaryColor: 0xce1141,
        shoeAccentColor: 0xffffff,
      },
      {
        id: 'green_j',
        name: 'J. GREEN',
        number: '4',
        team: 'HOU',
        position: 'SG',
        threePointRating: 85,
        midRangeRating: 84,
        speed: 4.9,
        personalFouls: 1,
        skinColor: '#bb7f52',
        hairColor: '#1a110a',
        hairStyle: 'textured_crop',
        hasBeard: true,
        beardStyle: 'goatee',
        hasHeadband: false,
        hasShootingSleeve: true,
        sleeveArm: 'right',
        heightScale: 0.99,
        widthScale: 0.95,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0xce1141,
      },
      {
        id: 'brooks',
        name: 'D. BROOKS',
        number: '9',
        team: 'HOU',
        position: 'SF',
        threePointRating: 82,
        midRangeRating: 81,
        speed: 4.4,
        personalFouls: 3,
        skinColor: '#54351e',
        hairColor: '#110b07',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        hasHeadband: true,
        headbandColor: 0x181818,
        hasShootingSleeve: true,
        sleeveArm: 'left',
        heightScale: 1.02,
        widthScale: 1.05,
        shoePrimaryColor: 0xce1141,
        shoeAccentColor: 0x181818,
      },
      {
        id: 'smith',
        name: 'J. SMITH JR.',
        number: '10',
        team: 'HOU',
        position: 'PF',
        threePointRating: 84,
        midRangeRating: 82,
        speed: 4.3,
        personalFouls: 1,
        skinColor: '#4c2f1a',
        hairColor: '#0f0a06',
        hairStyle: 'buzz',
        hasBeard: false,
        beardStyle: 'clean',
        hasHeadband: false,
        hasShootingSleeve: false,
        hasLegSleeve: true,
        heightScale: 1.08,
        widthScale: 1.02,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0xce1141,
      },
      {
        id: 'sengun',
        name: 'A. SENGUN',
        number: '28',
        team: 'HOU',
        position: 'C',
        threePointRating: 70,
        midRangeRating: 85,
        speed: 3.9,
        personalFouls: 2,
        skinColor: '#e6be9a',
        hairColor: '#2b1b11',
        hairStyle: 'sengun_wave',
        hasBeard: true,
        beardStyle: 'stubble',
        hasHeadband: false,
        hasShootingSleeve: false,
        hasLegSleeve: false,
        heightScale: 1.10,
        widthScale: 1.12,
        shoePrimaryColor: 0xce1141,
        shoeAccentColor: 0xffffff,
      },
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

    this.gswBenchRoster = [
      {
        id: 'paul',
        name: 'C. PAUL',
        number: '3',
        team: 'GSW',
        position: 'PG',
        threePointRating: 86,
        midRangeRating: 94,
        speed: 4.2,
        personalFouls: 0,
        skinColor: '#5a3825',
        hairColor: '#120b07',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'goatee',
        heightScale: 0.94,
        widthScale: 0.96,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
      {
        id: 'kuminga',
        name: 'J. KUMINGA',
        number: '00',
        team: 'GSW',
        position: 'PF',
        threePointRating: 78,
        midRangeRating: 84,
        speed: 4.9,
        personalFouls: 0,
        skinColor: '#3a2012',
        hairColor: '#0a0604',
        hairStyle: 'textured_crop',
        hasBeard: false,
        heightScale: 1.04,
        widthScale: 1.08,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0xfdb927,
      },
      {
        id: 'payton',
        name: 'G. PAYTON II',
        number: '8',
        team: 'GSW',
        position: 'SG',
        threePointRating: 77,
        midRangeRating: 80,
        speed: 4.9,
        personalFouls: 0,
        skinColor: '#4d301c',
        hairColor: '#100a06',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        heightScale: 0.98,
        widthScale: 1.00,
        shoePrimaryColor: 0x0053bc,
        shoeAccentColor: 0xfdb927,
      },
      {
        id: 'podziemski',
        name: 'B. PODZIEMSKI',
        number: '2',
        team: 'GSW',
        position: 'SG',
        threePointRating: 86,
        midRangeRating: 83,
        speed: 4.4,
        personalFouls: 0,
        skinColor: '#edd0b5',
        hairColor: '#2b1d14',
        hairStyle: 'curry_curly',
        hasBeard: false,
        heightScale: 0.98,
        widthScale: 0.96,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
      {
        id: 'moody',
        name: 'M. MOODY',
        number: '4',
        team: 'GSW',
        position: 'SF',
        threePointRating: 87,
        midRangeRating: 82,
        speed: 4.4,
        personalFouls: 0,
        skinColor: '#452a17',
        hairColor: '#100905',
        hairStyle: 'dreads',
        hasBeard: true,
        beardStyle: 'stubble',
        heightScale: 1.02,
        widthScale: 1.00,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
      {
        id: 'saric',
        name: 'D. SARIC',
        number: '20',
        team: 'GSW',
        position: 'C',
        threePointRating: 82,
        midRangeRating: 84,
        speed: 3.7,
        personalFouls: 0,
        skinColor: '#e8cbb0',
        hairColor: '#261b12',
        hairStyle: 'klay_taper',
        hasBeard: true,
        beardStyle: 'stubble',
        heightScale: 1.08,
        widthScale: 1.10,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0x0053bc,
      },
    ];

    this.houBenchRoster = [
      {
        id: 'whitmore',
        name: 'C. WHITMORE',
        number: '7',
        team: 'HOU',
        position: 'SF',
        threePointRating: 84,
        midRangeRating: 82,
        speed: 4.8,
        personalFouls: 0,
        skinColor: '#422816',
        hairColor: '#0e0805',
        hairStyle: 'buzz',
        hasBeard: false,
        heightScale: 1.02,
        widthScale: 1.06,
        shoePrimaryColor: 0xce1141,
        shoeAccentColor: 0xffffff,
      },
      {
        id: 'amen',
        name: 'A. THOMPSON',
        number: '1',
        team: 'HOU',
        position: 'PG',
        threePointRating: 75,
        midRangeRating: 82,
        speed: 5.0,
        personalFouls: 0,
        skinColor: '#4c301c',
        hairColor: '#110a06',
        hairStyle: 'textured_crop',
        hasBeard: false,
        heightScale: 1.02,
        widthScale: 0.98,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0xce1141,
      },
      {
        id: 'holiday',
        name: 'A. HOLIDAY',
        number: '0',
        team: 'HOU',
        position: 'PG',
        threePointRating: 86,
        midRangeRating: 82,
        speed: 4.6,
        personalFouls: 0,
        skinColor: '#3d2413',
        hairColor: '#0a0604',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        heightScale: 0.93,
        widthScale: 0.95,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0xce1141,
      },
      {
        id: 'jeffgreen',
        name: 'J. GREEN',
        number: '32',
        team: 'HOU',
        position: 'PF',
        threePointRating: 80,
        midRangeRating: 84,
        speed: 4.1,
        personalFouls: 0,
        skinColor: '#482d1a',
        hairColor: '#120b07',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'full_beard',
        heightScale: 1.05,
        widthScale: 1.08,
        shoePrimaryColor: 0x181818,
        shoeAccentColor: 0xffffff,
      },
      {
        id: 'landale',
        name: 'J. LANDALE',
        number: '2',
        team: 'HOU',
        position: 'C',
        threePointRating: 68,
        midRangeRating: 78,
        speed: 3.7,
        personalFouls: 0,
        skinColor: '#e8c9ad',
        hairColor: '#302216',
        hairStyle: 'textured_crop',
        hasBeard: true,
        beardStyle: 'stubble',
        heightScale: 1.10,
        widthScale: 1.12,
        shoePrimaryColor: 0xffffff,
        shoeAccentColor: 0xce1141,
      },
    ];

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

    if (this.ballState === 'FREE_THROW') {
      if (e.key === ' ') {
        this.startFreeThrowShot();
      } else if (key === 'f') {
        this.triggerFreeThrowDribble();
      } else if (key === 'r') {
        this.triggerFreeThrowSpin();
      } else if (key === 'c' || key === 'b') {
        this.triggerFreeThrowFocus();
      }
      return;
    }

    if (e.key === ' ') {
      if (this.ballHolder === this.controlledPlayer && this.ballState === 'DRIBBLE') {
        this.startShooting();
      } else if (this.ballHolder?.data.team !== 'GSW') {
        // Space acts as BLOCK on defense!
        this.triggerBlock();
      }
    }

    if (key === 'x' || key === 'e' || key === 'k' || key === 'p') {
      if (this.ballHolder?.data.team === 'GSW' || this.isInboundPlay) {
        this.triggerPass();
      } else if (this.ballHolder?.data.team === 'HOU' || this.ballState === 'REBOUND') {
        // Acts as STEAL on defense!
        this.triggerSteal();
      }
    }

    if (key === 'c' || key === 'q') {
      this.cycleControlledPlayer();
    }

    if (key === 'b') {
      this.triggerManualTacticalSubstitution();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    this.keys[key] = false;

    if (!e.shiftKey) {
      this.setSprint(false);
    }

    if (this.ballState === 'FREE_THROW') {
      if (e.key === ' ') {
        this.releaseFreeThrowShot();
      }
      return;
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
    if (this.ballState === 'FREE_THROW') {
      this.startFreeThrowShot();
      return;
    }
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
    if (this.ballState === 'FREE_THROW') {
      this.releaseFreeThrowShot();
      return;
    }
    if (this.isChargingShot) {
      this.isChargingShot = false;
      this.executeShot(this.controlledPlayer, this.shotHoldTime);
    }
  }

  public startFreeThrowShot() {
    if (this.ballState !== 'FREE_THROW' || !this.activeFoul) return;
    const ft = this.activeFoul;
    if (!ft.stage.startsWith('ROUTINE')) return;
    if (ft.fouledPlayer.data.team !== 'GSW') return;

    if (!ft.isCharging) {
      ft.isCharging = true;
      ft.chargeTime = 0;
      ft.routineAction = 'NONE';
      sounds.playSneakerSqueak();
    }
  }

  public releaseFreeThrowShot() {
    if (this.ballState !== 'FREE_THROW' || !this.activeFoul) return;
    const ft = this.activeFoul;
    if (!ft.isCharging) return;

    this.executeFreeThrowRelease(ft);
  }

  public triggerFreeThrowDribble() {
    if (this.ballState !== 'FREE_THROW' || !this.activeFoul) return;
    const ft = this.activeFoul;
    if (!ft.stage.startsWith('ROUTINE') || ft.isCharging) return;
    if (ft.fouledPlayer.data.team !== 'GSW') return;

    ft.routineAction = 'DRIBBLE';
    ft.routineActionTimer = 0.75;
    sounds.playDribble();
    sounds.playSneakerSqueak();
    this.spawnFloatingStatus('RHYTHM DRIBBLE', this.ballPos, '#38bdf8');
  }

  public triggerFreeThrowSpin() {
    if (this.ballState !== 'FREE_THROW' || !this.activeFoul) return;
    const ft = this.activeFoul;
    if (!ft.stage.startsWith('ROUTINE') || ft.isCharging) return;
    if (ft.fouledPlayer.data.team !== 'GSW') return;

    ft.routineAction = 'SPIN';
    ft.routineActionTimer = 0.65;
    sounds.playSneakerSqueak();
    this.spawnFloatingStatus('SPIN BALL', this.ballPos, '#a855f7');
  }

  public triggerFreeThrowFocus() {
    if (this.ballState !== 'FREE_THROW' || !this.activeFoul) return;
    const ft = this.activeFoul;
    if (!ft.stage.startsWith('ROUTINE') || ft.isCharging) return;
    if (ft.fouledPlayer.data.team !== 'GSW') return;

    ft.routineAction = 'FOCUS';
    ft.routineActionTimer = 0.85;
    ft.hasFocused = true;
    sounds.playSneakerSqueak();
    this.spawnFloatingStatus('FOCUSED! (+WIDER GREEN ZONE)', this.ballPos, '#10b981');
  }

  public triggerPass() {
    if (this.ballState === 'FREE_THROW') return;

    // Case 1: Human player currently holds the ball -> pass to teammate
    if (this.ballHolder === this.controlledPlayer && (this.ballState === 'DRIBBLE' || this.isInboundPlay)) {
      this.initiatePass(this.controlledPlayer);
      return;
    }

    // Case 2: Human is controlling an off-ball player and GSW has possession -> Call for pass ("Pass to me!")
    if (this.ballHolder && this.ballHolder.data.team === 'GSW' && this.ballHolder !== this.controlledPlayer) {
      this.initiatePass(this.ballHolder, this.controlledPlayer);
      return;
    }

    // Case 3: Inbound play active for GSW (whether controlled or AI inbounder)
    if (this.isInboundPlay) {
      const gswInbounder = this.players.find(p => p.data.team === 'GSW');
      if (gswInbounder) {
        this.initiatePass(gswInbounder);
      }
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
        // High contact collision check on shooter in flight
        const houShooter = this.players.find(p => p.data.team === 'HOU' && p.position.distanceTo(this.ballPos) < 2.4);
        if (houShooter && this.foulCooldownTimer <= 0 && Math.random() < 0.12) {
          const attempts = this.activeShot.points === 3 ? 3 : 2;
          this.pendingShootingFoul = { shooter: houShooter, fouler: this.controlledPlayer, attempts };
          this.foulCooldownTimer = 7.0;
          sounds.playWhistle();
          this.spawnFloatingStatus('FOUL ON CONTEST!', this.controlledPlayer.position, '#f59e0b');
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
      if (distToCarrier < 1.15 && this.foulCooldownTimer <= 0 && Math.random() < 0.08) {
        // Body contact on dribbler -> defensive blocking foul (NOT a shooting foul!)
        this.triggerFoul(houCarrier, this.controlledPlayer, 'BLOCKING FOUL');
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
    if (dist < 1.4 && this.ballState === 'DRIBBLE') {
      // Occasional reach-in foul on aggressive poke check
      if (this.foulCooldownTimer <= 0 && Math.random() < 0.08) {
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

  public resetAllPlayerPoses() {
    this.players.forEach(p => {
      p.isShootingAnim = false;
      p.isDefendingAnim = false;
      p.isDunking = false;
      p.position.y = 0;
      p.torsoMesh.rotation.set(0, 0, 0);
      p.torsoMesh.scale.set(1, 1, 1);
      p.leftArmPivot.rotation.set(0, 0, 0);
      p.rightArmPivot.rotation.set(0, 0, 0);
      p.leftElbowPivot.rotation.set(0, 0, 0);
      p.rightElbowPivot.rotation.set(0, 0, 0);
      p.leftLegPivot.rotation.set(0, 0, 0);
      p.rightLegPivot.rotation.set(0, 0, 0);
      p.leftKneePivot.rotation.set(0, 0, 0);
      p.rightKneePivot.rotation.set(0, 0, 0);
      p.rightHandMesh.rotation.set(0, 0, 0);
    });
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

    // Enforce global foul cooldown so repeated fouls cannot spam
    this.foulCooldownTimer = 7.0;

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
      const sideX = fouler.position.x >= 0 ? 7.15 : -7.15;
      const sideZ = THREE.MathUtils.clamp(fouler.position.z, -12.5, 12.5);
      this.executeInbound(fouled.data.team, { x: sideX, z: sideZ });
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
      // Side-out inbound at the spot of the foul (keeps court progress!)
      const sideX = fouled.position.x >= 0 ? 7.15 : -7.15;
      const sideZ = THREE.MathUtils.clamp(fouled.position.z, -12.5, 12.5);
      this.executeInbound(fouled.data.team, { x: sideX, z: sideZ });
      return;
    }

    // 3. SHOOTING FOULS, AND-ONE, OR PENALTY BONUS FOULS (Free Throws Awarded)
    sounds.playWhistle();
    this.ballState = 'FREE_THROW';
    this.activeShot = null;
    this.isChargingShot = false;
    this.ballHolder = null;
    this.ballVel.set(0, 0, 0);

    // Completely unlock and reset all player poses before free throw setup
    this.resetAllPlayerPoses();

    // Hide overhead billboard & floor decal immediately so the screen is completely unobstructed
    if (this.nameplateSprite) this.nameplateSprite.visible = false;
    if (this.playerFloorRing) this.playerFloorRing.visible = false;
    // Clear any floating texts near the shooter/court so they don't block the camera
    for (const ft of this.floatingTexts) {
      this.scene.remove(ft.sprite);
    }
    this.floatingTexts = [];

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

    this.setupFreeThrowLineup(fouled);
    // Overhead 3D status is positioned high above the court (y = 3.6) so it never blocks the hoop view
    const label = isAndOne ? 'AND-ONE! 1 FREE THROW' : `FOUL! ${actualAttempts} FREE THROWS`;
    this.spawnFloatingStatus(label, new THREE.Vector3(fouled.position.x, 3.6, fouled.position.z), '#f59e0b');
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
    shot3?: 'PENDING' | 'MADE' | 'MISSED',
    extra?: {
      isCharging?: boolean;
      ftMeterValue?: number;
      isGreen?: boolean;
      quality?: string;
      canShoot?: boolean;
      routineAction?: 'NONE' | 'DRIBBLE' | 'SPIN' | 'FOCUS';
      hasFocused?: boolean;
    }
  ) {
    if (!this.activeFoul || attempt === null) {
      this.onFoulEvent?.(null);
      return;
    }
    const ft = this.activeFoul;
    const isUserShooting = ft.fouledPlayer.data.team === 'GSW';
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
      isUserShooting,
      canShoot: extra?.canShoot ?? (ft.stage.startsWith('ROUTINE') && isUserShooting),
      isCharging: extra?.isCharging ?? !!ft.isCharging,
      ftMeterValue: extra?.ftMeterValue ?? (ft.chargeTime ? Math.min(1.15, ft.chargeTime / 0.85) : 0),
      isGreen: extra?.isGreen ?? !!ft.isGreen,
      quality: extra?.quality ?? ft.quality,
      hasFocused: extra?.hasFocused ?? !!ft.hasFocused,
      routineAction: extra?.routineAction ?? ft.routineAction ?? 'NONE',
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

    if (isGSW) {
      this.setControlledPlayer(shooter);
      this.onPossessionChange?.(true);
    } else {
      const gswRebounder = opponents[0] || this.players.find(p => p.data.team === 'GSW');
      if (gswRebounder) {
        this.setControlledPlayer(gswRebounder);
      }
      this.onPossessionChange?.(false);
    }
  }

  private executeFreeThrowRelease(ft: FreeThrowState) {
    const attempt = ft.currentAttempt;
    const shooter = ft.fouledPlayer;
    const isGSW = shooter.data.team === 'GSW';
    const ftPct = shooter.data.threePointRating >= 90 ? 0.92 : shooter.data.midRangeRating >= 80 ? 0.84 : 0.74;

    let willMake = false;
    let isGreen = false;
    let quality = 'LATE';

    if (isGSW) {
      const meterVal = ft.chargeTime ? Math.min(1.15, ft.chargeTime / 0.85) : 0.88;
      const ideal = 0.88;
      const greenWidth = ft.hasFocused ? 0.12 : 0.06;
      isGreen = Math.abs(meterVal - ideal) <= greenWidth;

      if (isGreen) {
        willMake = true;
        quality = 'PERFECT GREEN RELEASE!';
        sounds.playGreenChime();
      } else {
        const diff = Math.abs(meterVal - ideal);
        if (diff <= 0.16) {
          quality = meterVal < ideal ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE';
          willMake = Math.random() < ftPct;
        } else {
          quality = meterVal < ideal ? 'VERY EARLY' : 'VERY LATE';
          willMake = false;
        }
      }
    } else {
      // AI Shooter
      willMake = Math.random() < ftPct;
      isGreen = willMake && Math.random() < 0.35;
      quality = willMake ? 'GOOD TIMING' : 'OFF TIMING';
    }

    ft.isCharging = false;
    ft.chargeTime = 0;
    ft.isGreen = isGreen;
    ft.quality = quality;
    ft.timer = 0;
    ft.startPos.copy(this.ballPos);

    shooter.leftKneePivot.rotation.x = 0.05;
    shooter.rightKneePivot.rotation.x = 0.05;
    shooter.rightArmPivot.rotation.x = -2.75;
    shooter.rightElbowPivot.rotation.x = -0.12;
    shooter.rightHandMesh.rotation.x = 0.95;
    shooter.leftArmPivot.rotation.x = -2.0;
    shooter.leftElbowPivot.rotation.x = -0.45;

    if (attempt === 1) {
      ft.shot1Made = willMake;
      ft.stage = 'SHOT_1';
      this.emitFoulUI(1, `FREE THROW 1: ${quality}`, 'PENDING', 'PENDING', 'PENDING', { quality, isGreen });
    } else if (attempt === 2) {
      ft.shot2Made = willMake;
      ft.stage = 'SHOT_2';
      this.emitFoulUI(2, `FREE THROW 2: ${quality}`, ft.shot1Made ? 'MADE' : 'MISSED', 'PENDING', 'PENDING', { quality, isGreen });
    } else {
      ft.shot3Made = willMake;
      ft.stage = 'SHOT_3';
      this.emitFoulUI(3, `FREE THROW 3: ${quality}`, ft.shot1Made ? 'MADE' : 'MISSED', ft.shot2Made ? 'MADE' : 'MISSED', 'PENDING', { quality, isGreen });
    }

    const rimZ = isGSW ? -13.0 : 13.0;
    if (!willMake) {
      const isFrontIron = Math.random() < 0.65;
      const ironZ = isFrontIron ? rimZ + (isGSW ? 0.22 : -0.22) : rimZ + (isGSW ? -0.23 : 0.23);
      ft.missTargetPos = new THREE.Vector3((Math.random() - 0.5) * 0.12, isFrontIron ? 3.06 : 3.08, ironZ);
    } else {
      ft.missTargetPos = undefined;
    }
    ft.hasBouncedFloor = false;

    if (isGreen) {
      this.spawnFloatingStatus('GREEN RELEASE! 🎯', ft.targetRim, '#10b981');
    }
  }

  private handleFreeThrowRoutineStage(
    dt: number,
    ft: FreeThrowState,
    attempt: number,
    isGSW: boolean,
    ftZ: number
  ) {
    const shooter = ft.fouledPlayer;
    const shot1 = attempt > 1 ? (ft.shot1Made ? 'MADE' : 'MISSED') : 'PENDING';
    const shot2 = attempt > 2 ? (ft.shot2Made ? 'MADE' : 'MISSED') : 'PENDING';

    if (isGSW) {
      // 1. HUMAN PLAYER CONTROLS THE FREE THROW
      if (ft.isCharging) {
        ft.chargeTime = (ft.chargeTime || 0) + dt * 1.35;
        const meterVal = Math.min(1.15, ft.chargeTime / 0.85);

        // Gather animation
        shooter.leftKneePivot.rotation.x = 0.48 * Math.min(1, meterVal);
        shooter.rightKneePivot.rotation.x = 0.48 * Math.min(1, meterVal);
        shooter.rightArmPivot.rotation.x = -1.1 * Math.min(1, meterVal);
        shooter.rightElbowPivot.rotation.x = -1.45 * Math.min(1, meterVal);
        shooter.leftArmPivot.rotation.x = -1.1 * Math.min(1, meterVal);
        shooter.leftElbowPivot.rotation.x = -1.35 * Math.min(1, meterVal);

        this.ballPos.set(0, 1.25 + 0.35 * Math.min(1, meterVal), ftZ + (isGSW ? -0.28 : 0.28));
        this.ball.position.copy(this.ballPos);

        const greenMin = ft.hasFocused ? 0.76 : 0.82;
        const greenMax = ft.hasFocused ? 0.98 : 0.94;
        const isCurrentlyGreen = meterVal >= greenMin && meterVal <= greenMax;

        this.emitFoulUI(
          attempt,
          isCurrentlyGreen ? 'PERFECT RELEASE WINDOW! RELEASE NOW!' : 'TIMING RELEASE... RELEASE IN GREEN!',
          shot1,
          shot2,
          'PENDING',
          {
            isCharging: true,
            ftMeterValue: meterVal,
            isGreen: isCurrentlyGreen,
            canShoot: true,
            hasFocused: ft.hasFocused,
          }
        );

        if (ft.chargeTime > 1.25) {
          // Overcharged - auto release
          this.executeFreeThrowRelease(ft);
        }
      } else if (ft.routineAction === 'DRIBBLE') {
        ft.routineActionTimer = (ft.routineActionTimer || 0) - dt;
        const bounceNorm = Math.abs(Math.sin((1 - ft.routineActionTimer / 0.75) * Math.PI * 2));
        const bounceY = this.BALL_RADIUS + 0.95 * bounceNorm;
        this.ballPos.set(0, bounceY, ftZ + (isGSW ? -0.25 : 0.25));
        this.ball.position.copy(this.ballPos);

        shooter.rightArmPivot.rotation.x = -0.3 + (1 - bounceNorm) * 0.35;
        shooter.rightElbowPivot.rotation.x = -0.25 - (1 - bounceNorm) * 0.85;

        if (ft.routineActionTimer <= 0) {
          ft.routineAction = 'NONE';
        }
      } else if (ft.routineAction === 'SPIN') {
        ft.routineActionTimer = (ft.routineActionTimer || 0) - dt;
        const spinFrac = 1 - Math.max(0, ft.routineActionTimer / 0.65);
        this.ball.rotation.x -= dt * 26;
        const floatY = 1.25 + Math.sin(spinFrac * Math.PI) * 0.22;
        this.ballPos.set(0, floatY, ftZ + (isGSW ? -0.28 : 0.28));
        this.ball.position.copy(this.ballPos);

        shooter.rightArmPivot.rotation.x = -0.8;
        shooter.leftArmPivot.rotation.x = -0.8;

        if (ft.routineActionTimer <= 0) {
          ft.routineAction = 'NONE';
        }
      } else if (ft.routineAction === 'FOCUS') {
        ft.routineActionTimer = (ft.routineActionTimer || 0) - dt;
        shooter.leftArmPivot.rotation.x = -0.4;
        shooter.rightArmPivot.rotation.x = -0.4;
        shooter.torsoMesh.scale.set(1.05, 1.05, 1.05);

        this.ballPos.set(0, 1.25, ftZ + (isGSW ? -0.28 : 0.28));
        this.ball.position.copy(this.ballPos);

        if (ft.routineActionTimer <= 0) {
          shooter.torsoMesh.scale.set(1, 1, 1);
          ft.routineAction = 'NONE';
        }
      } else {
        // Idle breathing at the line
        const breath = Math.sin(ft.timer * 3.5) * 0.02;
        this.ballPos.set(0, 1.25 + breath, ftZ + (isGSW ? -0.28 : 0.28));
        this.ball.position.copy(this.ballPos);

        shooter.leftLegPivot.rotation.x = 0.15;
        shooter.rightLegPivot.rotation.x = 0.15;
        shooter.leftKneePivot.rotation.x = 0.35;
        shooter.rightKneePivot.rotation.x = 0.35;
        shooter.leftArmPivot.rotation.x = -0.9;
        shooter.leftElbowPivot.rotation.x = -1.1;
        shooter.rightArmPivot.rotation.x = -0.9;
        shooter.rightElbowPivot.rotation.x = -1.1;

        if (ft.timer % 1.5 < dt) {
          this.emitFoulUI(
            attempt,
            ft.hasFocused
              ? '★ FOCUSED! GREEN ZONE EXPANDED • HOLD [SPACE] TO SHOOT'
              : 'HOLD [SPACE] TO SHOOT • [F] DRIBBLE • [R] SPIN • [C] FOCUS',
            shot1,
            shot2,
            'PENDING',
            { canShoot: true, hasFocused: ft.hasFocused }
          );
        }

        // Auto-countdown after 12s
        if (ft.timer >= 12.0) {
          this.startFreeThrowShot();
          setTimeout(() => this.releaseFreeThrowShot(), 650);
        }
      }
    } else {
      // 2. AI FREE THROW SHOOTER (Houston)
      const bounceProg = (ft.timer % 0.8) / 0.8;
      if (ft.timer < 1.6) {
        const bounceY = this.BALL_RADIUS + 0.95 * Math.abs(Math.sin(bounceProg * Math.PI));
        this.ballPos.set(0, bounceY, ftZ + (isGSW ? -0.25 : 0.25));
        if (ft.timer > 0.35 && ft.timer < 0.42) sounds.playDribble();
        if (ft.timer > 1.15 && ft.timer < 1.22) sounds.playDribble();

        shooter.rightArmPivot.rotation.x = -0.3 + (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.35;
        shooter.rightElbowPivot.rotation.x = -0.25 - (1 - Math.abs(Math.sin(bounceProg * Math.PI))) * 0.85;
      } else {
        this.ballPos.set(0, 1.25, ftZ + (isGSW ? -0.28 : 0.28));
      }
      this.ball.position.copy(this.ballPos);

      if (ft.timer >= 2.0) {
        this.executeFreeThrowRelease(ft);
      }
    }
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

      if (ft.timer >= 1.2) {
        ft.stage = 'ROUTINE_1';
        ft.timer = 0;
        ft.currentAttempt = 1;
        ft.routineAction = 'NONE';
        ft.hasFocused = false;
        ft.isCharging = false;
        ft.chargeTime = 0;
        const msg = isGSW
          ? 'HOLD [SPACE] TO SHOOT • [F] DRIBBLE • [R] SPIN • [C] FOCUS'
          : `FREE THROW 1 OF ${ft.attemptsTotal}`;
        this.emitFoulUI(1, msg, 'PENDING', 'PENDING', 'PENDING', { canShoot: isGSW });
      }
    } else if (ft.stage === 'ROUTINE_1' || ft.stage === 'ROUTINE_2' || ft.stage === 'ROUTINE_3') {
      const attempt = ft.stage === 'ROUTINE_1' ? 1 : ft.stage === 'ROUTINE_2' ? 2 : 3;
      ft.currentAttempt = attempt;
      this.handleFreeThrowRoutineStage(dt, ft, attempt, isGSW, ftZ);
    } else if (ft.stage === 'SHOT_1') {
      const isFinalAttempt = ft.attemptsTotal === 1;
      this.handleFreeThrowShotStage(dt, ft, 1, ft.shot1Made, isFinalAttempt, isGSW, rimZ);
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
        ft.currentAttempt = 2;
        ft.routineAction = 'NONE';
        ft.hasFocused = false;
        ft.isCharging = false;
        ft.chargeTime = 0;
        const msg = isGSW
          ? 'HOLD [SPACE] TO SHOOT • [F] DRIBBLE • [R] SPIN • [C] FOCUS'
          : 'FREE THROW 2 OF 2';
        this.emitFoulUI(2, msg, ft.shot1Made ? 'MADE' : 'MISSED', 'PENDING', 'PENDING', { canShoot: isGSW });
      }
    } else if (ft.stage === 'SHOT_2') {
      const isFinalAttempt = ft.attemptsTotal === 2;
      this.handleFreeThrowShotStage(dt, ft, 2, ft.shot2Made, isFinalAttempt, isGSW, rimZ);
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
        ft.currentAttempt = 3;
        ft.routineAction = 'NONE';
        ft.hasFocused = false;
        ft.isCharging = false;
        ft.chargeTime = 0;
        const msg = isGSW
          ? 'HOLD [SPACE] TO SHOOT • [F] DRIBBLE • [R] SPIN • [C] FOCUS'
          : 'FREE THROW 3 OF 3';
        this.emitFoulUI(
          3,
          msg,
          ft.shot1Made ? 'MADE' : 'MISSED',
          ft.shot2Made ? 'MADE' : 'MISSED',
          'PENDING',
          { canShoot: isGSW }
        );
      }
    } else if (ft.stage === 'SHOT_3') {
      this.handleFreeThrowShotStage(dt, ft, 3, ft.shot3Made, true, isGSW, rimZ);
    }
  }

  private handleFreeThrowShotStage(
    dt: number,
    ft: FreeThrowState,
    attempt: number,
    isMade: boolean,
    isFinalAttempt: boolean,
    isGSW: boolean,
    rimZ: number
  ) {
    const flightDuration = 0.92;
    const shooter = ft.fouledPlayer;
    const hasScoredFlag = attempt === 1 ? ft.hasScoredAttempt1 : attempt === 2 ? ft.hasScoredAttempt2 : ft.hasScoredAttempt3;

    if (isMade) {
      // -------------------------------------------------------------
      // 1. MADE FREE THROW: HIGH ARC SWISH & SMOOTH DROP THROUGH NET
      // -------------------------------------------------------------
      if (ft.timer < flightDuration) {
        const prog = Math.min(1.0, ft.timer / flightDuration);
        this.ballPos.lerpVectors(ft.startPos, ft.targetRim, prog);
        this.ballPos.y = ft.startPos.y + (this.RIM_HEIGHT - ft.startPos.y) * prog + Math.sin(prog * Math.PI) * 1.55;
        this.ball.position.copy(this.ballPos);
        this.ball.rotation.x -= dt * 14;
      } else {
        if (!hasScoredFlag) {
          if (attempt === 1) ft.hasScoredAttempt1 = true;
          else if (attempt === 2) ft.hasScoredAttempt2 = true;
          else ft.hasScoredAttempt3 = true;

          sounds.playSwish();
          sounds.playCrowdCheer();
          if (isGSW) this.gswNetWobble = 1.25; else this.houNetWobble = 1.25;
          this.awardFreeThrowPoint(shooter.data.team);
          this.spawnFloatingStatus('+1 FREE THROW', ft.targetRim, '#10b981');

          const shot1 = attempt === 1 ? 'MADE' : (ft.shot1Made ? 'MADE' : 'MISSED');
          const shot2 = attempt === 2 ? 'MADE' : (attempt > 2 ? (ft.shot2Made ? 'MADE' : 'MISSED') : 'PENDING');
          const shot3 = attempt === 3 ? 'MADE' : 'PENDING';

          const statusMsg = ft.attemptsTotal === 1
            ? 'AND-ONE FREE THROW: GOOD!'
            : `FREE THROW ${attempt}: GOOD!`;
          this.emitFoulUI(attempt, statusMsg, shot1, shot2, shot3, { quality: ft.quality, isGreen: ft.isGreen });
        }

        // Drop down through the net and bounce on the court floor
        const dropTime = ft.timer - flightDuration;
        this.ballPos.x = ft.targetRim.x;
        this.ballPos.z = ft.targetRim.z;
        this.ball.rotation.x -= dt * 6;

        const freeFallY = this.RIM_HEIGHT - 0.5 * 10.8 * dropTime * dropTime;
        if (freeFallY <= this.BALL_RADIUS) {
          if (!ft.hasBouncedFloor) {
            ft.hasBouncedFloor = true;
            sounds.playDribble();
          }
          const groundTime = dropTime - Math.sqrt((this.RIM_HEIGHT - this.BALL_RADIUS) * 2 / 10.8);
          if (groundTime > 0 && groundTime < 0.45) {
            this.ballPos.y = this.BALL_RADIUS + Math.sin((groundTime / 0.45) * Math.PI) * 0.40;
          } else {
            this.ballPos.y = this.BALL_RADIUS;
          }
        } else {
          this.ballPos.y = freeFallY;
        }
        this.ball.position.copy(this.ballPos);
      }

      if (ft.timer >= 1.85) {
        const shot1 = ft.shot1Made ? 'MADE' : 'MISSED';
        const shot2 = attempt >= 2 ? (ft.shot2Made ? 'MADE' : 'MISSED') : 'PENDING';
        const shot3 = attempt >= 3 ? (ft.shot3Made ? 'MADE' : 'MISSED') : 'PENDING';

        if (isFinalAttempt) {
          const defendingTeam = shooter.data.team === 'GSW' ? 'HOU' : 'GSW';
          this.resetAllPlayerPoses();
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.executeInbound(defendingTeam);
        } else {
          ft.stage = attempt === 1 ? 'RESET_2' : 'RESET_3';
          ft.timer = 0;
          ft.hasBouncedFloor = false;
          const nextAttempt = attempt + 1;
          this.emitFoulUI(nextAttempt, `FREE THROW ${nextAttempt} OF ${ft.attemptsTotal}`, shot1, shot2, shot3);
        }
      }
    } else {
      // -------------------------------------------------------------
      // 2. MISSED FREE THROW: METALLIC RIM CLANG & BOUNCE OFF IRON
      // -------------------------------------------------------------
      const impactPos = ft.missTargetPos || new THREE.Vector3(0, 3.06, rimZ + (isGSW ? 0.22 : -0.22));

      if (ft.timer < flightDuration) {
        const prog = Math.min(1.0, ft.timer / flightDuration);
        this.ballPos.lerpVectors(ft.startPos, impactPos, prog);
        this.ballPos.y = ft.startPos.y + (impactPos.y - ft.startPos.y) * prog + Math.sin(prog * Math.PI) * 1.55;
        this.ball.position.copy(this.ballPos);
        this.ball.rotation.x -= dt * 14;
      } else {
        if (!hasScoredFlag) {
          if (attempt === 1) ft.hasScoredAttempt1 = true;
          else if (attempt === 2) ft.hasScoredAttempt2 = true;
          else ft.hasScoredAttempt3 = true;

          sounds.playRimClang();
          if (isGSW) this.gswNetWobble = 0.4; else this.houNetWobble = 0.4;
          this.spawnFloatingStatus('MISSED', impactPos, '#ef4444');

          const shot1 = attempt === 1 ? 'MISSED' : (ft.shot1Made ? 'MADE' : 'MISSED');
          const shot2 = attempt === 2 ? 'MISSED' : (attempt > 2 ? (ft.shot2Made ? 'MADE' : 'MISSED') : 'PENDING');
          const shot3 = attempt === 3 ? 'MISSED' : 'PENDING';

          const statusMsg = isFinalAttempt
            ? `FREE THROW ${attempt}: MISSED — LIVE BALL!`
            : `FREE THROW ${attempt}: MISSED`;
          this.emitFoulUI(attempt, statusMsg, shot1, shot2, shot3, { quality: ft.quality, isGreen: false });
        }

        if (isFinalAttempt) {
          // Final attempt miss: Immediately transition to live rebound off the iron!
          this.resetAllPlayerPoses();
          this.emitFoulUI(null);
          this.activeFoul = null;
          this.ballState = 'REBOUND';
          this.activeShot = null;
          this.reboundMarker.position.set(0, 0.02, rimZ);
          this.reboundMarker.visible = true;
          this.ballPos.copy(impactPos);
          this.ballVel.set((Math.random() - 0.5) * 3.2, 3.2, isGSW ? 2.8 : -2.8);
          this.shotClock = 24.0;
          return;
        }

        // Non-final attempt miss: ball bounces off the rim into the lane and settles
        const bounceTime = ft.timer - flightDuration;
        this.ballPos.x = impactPos.x + Math.sin(bounceTime * 3) * 0.15;
        this.ballPos.z = impactPos.z + (isGSW ? 1.3 : -1.3) * bounceTime;
        const reboundY = 3.06 + bounceTime * 1.6 - 0.5 * 10.5 * bounceTime * bounceTime;
        if (reboundY <= this.BALL_RADIUS) {
          this.ballPos.y = this.BALL_RADIUS;
          if (!ft.hasBouncedFloor) {
            ft.hasBouncedFloor = true;
            sounds.playDribble();
          }
        } else {
          this.ballPos.y = reboundY;
        }
        this.ball.position.copy(this.ballPos);
        this.ball.rotation.x += dt * 8;
      }

      if (ft.timer >= 1.85 && !isFinalAttempt) {
        shooter.rightHandMesh.rotation.x = 0;
        const shot1 = ft.shot1Made ? 'MADE' : 'MISSED';
        const shot2 = attempt >= 2 ? (ft.shot2Made ? 'MADE' : 'MISSED') : 'PENDING';
        const shot3 = attempt >= 3 ? (ft.shot3Made ? 'MADE' : 'MISSED') : 'PENDING';

        ft.stage = attempt === 1 ? 'RESET_2' : 'RESET_3';
        ft.timer = 0;
        ft.hasBouncedFloor = false;
        const nextAttempt = attempt + 1;
        this.emitFoulUI(nextAttempt, `FREE THROW ${nextAttempt} OF ${ft.attemptsTotal}`, shot1, shot2, shot3);
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
  // INJURY & TACTICAL SUBSTITUTION SYSTEM
  // --------------------------------------------------------------------------
  public triggerInjury(
    injuredPlayer: PlayerMesh,
    type: string = 'HAMSTRING STRAIN',
    desc?: string
  ) {
    if (this.activeInjuryState || this.ballState === 'FREE_THROW') return;

    const isGSW = injuredPlayer.data.team === 'GSW';
    const benchRoster = isGSW ? this.gswBenchRoster : this.houBenchRoster;
    if (benchRoster.length === 0) {
      benchRoster.push({
        id: `bench_${Date.now()}`,
        name: isGSW ? 'M. SPEIGHTS' : 'G. GREEN',
        number: isGSW ? '5' : '14',
        team: isGSW ? 'GSW' : 'HOU',
        position: injuredPlayer.data.position || 'SG',
        threePointRating: 84,
        midRangeRating: 85,
        speed: 4.2,
        personalFouls: 0,
        skinColor: '#5a3825',
        hairColor: '#120b07',
        hairStyle: 'buzz',
        hasBeard: true,
        beardStyle: 'goatee',
        heightScale: 1.0,
        widthScale: 1.0,
        shoePrimaryColor: isGSW ? 0xffffff : 0xce1141,
        shoeAccentColor: isGSW ? 0x0053bc : 0xffffff,
      });
    }

    // Determine possession team before clearing state
    const possessionTeam = this.ballHolder?.data.team ||
      (this.ballState === 'SHOT' ? this.activeShot?.shooterTeam : null) ||
      injuredPlayer.data.team;

    // Tactical substitute selection: match position if possible, otherwise first available
    const subIdx = benchRoster.findIndex(p => p.position === injuredPlayer.data.position);
    const subData = subIdx !== -1 ? benchRoster.splice(subIdx, 1)[0] : benchRoster.shift()!;

    // Mark player injured
    injuredPlayer.isInjured = true;
    injuredPlayer.injuryType = type;

    sounds.playWhistle();
    this.ballState = 'INJURY_SUB';
    this.activeShot = null;
    this.isChargingShot = false;
    this.ballHolder = null;
    this.ballVel.set(0, 0, 0);

    // Stop and settle ball on court floor near injured player
    this.ballPos.set(
      injuredPlayer.position.x + 0.6,
      this.BALL_RADIUS,
      injuredPlayer.position.z + (isGSW ? 0.6 : -0.6)
    );
    this.ball.position.copy(this.ballPos);

    // Spawn 3D substitute player at the team bench sideline (scorer's table)
    const benchSidelinePos = new THREE.Vector3(
      isGSW ? -7.6 : 7.6,
      0,
      isGSW ? -2.5 : 2.5
    );
    const subMesh = this.createPlayerMesh(subData);
    subMesh.position.copy(benchSidelinePos);
    subMesh.lookAt(injuredPlayer.position.x, 0, injuredPlayer.position.z);
    subMesh.visible = false; // Becomes visible when running onto the court in Stage 2

    const initialInjuredPos = injuredPlayer.position.clone();
    const courtTargetPos = initialInjuredPos.clone();
    courtTargetPos.x = THREE.MathUtils.clamp(courtTargetPos.x, -5.5, 5.5);
    courtTargetPos.z = THREE.MathUtils.clamp(courtTargetPos.z, -11.5, 11.5);

    const description = desc || `${injuredPlayer.data.name} sustained a ${type.toLowerCase()} and requires immediate tactical substitution.`;

    this.activeInjuryState = {
      injuredPlayer,
      substituteMesh: subMesh,
      substituteData: subData,
      injuryType: type,
      description,
      stage: 'COLLAPSE',
      timer: 0,
      benchSidelinePos,
      courtTargetPos,
      initialInjuredPos,
      possessionTeam,
    };

    // Broadcast 3D floating alert
    this.spawnFloatingStatus(`INJURY TIMEOUT: ${injuredPlayer.data.name}`, injuredPlayer.position, '#ef4444');

    this.emitInjuryUI('COLLAPSE', 0);
  }

  public triggerManualTacticalSubstitution(player?: PlayerMesh) {
    const target = player || this.controlledPlayer;
    if (!target || this.activeInjuryState || this.ballState === 'FREE_THROW') return;

    this.triggerInjury(
      target,
      'TACTICAL REST / FATIGUE SUBSTITUTION',
      `Head coach called a tactical substitution to bring fresh legs onto the hardwood for ${target.data.name}.`
    );
  }

  public skipInjurySequence() {
    if (!this.activeInjuryState) return;
    this.completeInjurySubstitution();
  }

  private emitInjuryUI(stage: 'COLLAPSE' | 'SUB_ENTRY' | 'TAG_OUT' | 'RESUME', timer: number) {
    if (!this.activeInjuryState) return;
    this.onInjuryEvent?.({
      injuredPlayer: this.activeInjuryState.injuredPlayer.data,
      substitutePlayer: this.activeInjuryState.substituteData,
      injuryType: this.activeInjuryState.injuryType,
      injuryDescription: this.activeInjuryState.description,
      stage,
      timer,
    });
  }

  private updateInjurySequence(dt: number) {
    if (!this.activeInjuryState) return;
    const s = this.activeInjuryState;
    s.timer += dt;

    const injured = s.injuredPlayer;
    const sub = s.substituteMesh;
    const isGSW = injured.data.team === 'GSW';

    // STAGE 1: COLLAPSE & MEDICAL TIMEOUT (0.0s to 1.8s)
    if (s.timer < 1.8) {
      s.stage = 'COLLAPSE';
      // Injured player posture: kneeling/doubled over clutching leg/knee
      injured.position.y = 0;
      injured.torsoMesh.rotation.x = 0.65;
      injured.torsoMesh.rotation.z = 0.22;
      injured.leftLegPivot.rotation.x = 1.35;
      injured.leftKneePivot.rotation.x = -1.45;
      injured.rightLegPivot.rotation.x = 0.45;
      injured.rightArmPivot.rotation.x = -1.15;
      injured.leftArmPivot.rotation.x = -0.90;

      // Nearest teammate rushes over in concern
      const teammates = this.players.filter(p => p.data.team === injured.data.team && p !== injured);
      if (teammates.length > 0) {
        const tm = teammates[0];
        tm.lookAt(injured.position.x, 0, injured.position.z);
        tm.torsoMesh.rotation.x = 0.35;
        tm.leftArmPivot.rotation.x = -0.7;
        tm.rightArmPivot.rotation.x = -0.7;
      }
      this.emitInjuryUI('COLLAPSE', s.timer);
      return;
    }

    // STAGE 2: SUB ENTERS FROM BENCH & INJURED PLAYER LIMPS OFF (1.8s to 4.2s)
    if (s.timer < 4.2) {
      s.stage = 'SUB_ENTRY';
      sub.visible = true;

      const subProgress = Math.min(1.0, (s.timer - 1.8) / 2.4);

      // Substitute jogs enthusiastically onto the court
      sub.position.lerpVectors(s.benchSidelinePos, s.courtTargetPos, subProgress);
      sub.lookAt(s.courtTargetPos.x, 0, s.courtTargetPos.z);
      sub.runCycle += dt * 11.5;
      const subSwing = Math.sin(sub.runCycle) * 0.75;
      sub.leftLegPivot.rotation.x = subSwing;
      sub.rightLegPivot.rotation.x = -subSwing;
      sub.leftKneePivot.rotation.x = Math.max(0, -subSwing * 1.5);
      sub.rightKneePivot.rotation.x = Math.max(0, subSwing * 1.5);
      sub.leftArmPivot.rotation.x = -subSwing * 0.85;
      sub.rightArmPivot.rotation.x = subSwing * 0.85;

      // Injured player hobbles / limps toward the team bench
      const limpProgress = Math.min(1.0, (s.timer - 1.8) / 2.4);
      injured.position.lerpVectors(s.initialInjuredPos, s.benchSidelinePos, limpProgress);
      injured.lookAt(s.benchSidelinePos.x, 0, s.benchSidelinePos.z);
      injured.torsoMesh.rotation.x = 0.35;
      injured.torsoMesh.rotation.z = isGSW ? -0.25 : 0.25;

      // Heavy limping stride animation
      injured.runCycle += dt * 5.2;
      const limpSwing = Math.sin(injured.runCycle) * 0.45;
      injured.leftLegPivot.rotation.x = limpSwing;
      injured.rightLegPivot.rotation.x = 0.2;
      injured.rightKneePivot.rotation.x = 0.85; // Dragging bad knee
      injured.leftArmPivot.rotation.x = -0.5;
      injured.rightArmPivot.rotation.x = -1.1; // Holding side/leg

      this.emitInjuryUI('SUB_ENTRY', s.timer);
      return;
    }

    // STAGE 3: SIDELINE TAG & HIGH-FIVE (4.2s to 5.2s)
    if (s.timer < 5.2) {
      s.stage = 'TAG_OUT';
      sub.position.copy(s.courtTargetPos);
      sub.lookAt(s.benchSidelinePos.x, 0, s.benchSidelinePos.z);

      // High-five / Fist-bump gesture
      sub.rightArmPivot.rotation.x = -1.35;
      sub.rightArmPivot.rotation.z = 0.3;
      injured.leftArmPivot.rotation.x = -1.35;
      injured.leftArmPivot.rotation.z = -0.3;

      if (!injured.isShootingAnim) {
        injured.isShootingAnim = true; // flag to only play audio once
        sounds.playCrowdCheer();
        this.spawnFloatingStatus(`CHECKING IN: #${s.substituteData.number} ${s.substituteData.name}`, s.courtTargetPos, '#38bdf8');
      }

      this.emitInjuryUI('TAG_OUT', s.timer);
      return;
    }

    // STAGE 4: COMPLETE SUBSTITUTION & RESUME PLAY (>= 5.2s)
    this.completeInjurySubstitution();
  }

  private completeInjurySubstitution() {
    if (!this.activeInjuryState) return;
    const s = this.activeInjuryState;

    sounds.playWhistle();

    // 1. Remove injured player from scene
    this.scene.remove(s.injuredPlayer as unknown as THREE.Object3D);

    // 2. Add substitute to scene and replace in players array
    s.substituteMesh.position.copy(s.courtTargetPos);
    s.substituteMesh.visible = true;
    const playerIdx = this.players.indexOf(s.injuredPlayer);
    if (playerIdx !== -1) {
      this.players[playerIdx] = s.substituteMesh;
    } else {
      this.players.push(s.substituteMesh);
    }

    // 3. If controlled player was injured, switch control to substitute with 100% fresh stamina
    if (this.controlledPlayer === s.injuredPlayer) {
      this.setControlledPlayer(s.substituteMesh);
      this.stamina = 1.0;
      this.onStaminaUpdate?.(1.0);
    }

    // 4. Reset all player poses to pristine baseline
    this.resetAllPlayerPoses();

    const subTeam = s.possessionTeam;
    this.activeInjuryState = null;
    this.onInjuryEvent?.(null);

    // 5. Resume game with clean sideline inbound at the substitution spot
    const sideX = subTeam === 'GSW' ? -7.15 : 7.15;
    const sideZ = THREE.MathUtils.clamp(s.courtTargetPos.z, -12.5, 12.5);
    this.executeInbound(subTeam, { x: sideX, z: sideZ }, s.substituteMesh);
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

    const startElevation = (isDunk ? 3.35 : 2.05) * (shooter.data.heightScale || 1.0);
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
  private initiatePass(passer: PlayerMesh, preferredReceiver?: PlayerMesh) {
    if (this.ballState === 'FREE_THROW') return;

    const teammates = this.players.filter(p => p.data.team === passer.data.team && p !== passer);
    if (teammates.length === 0) return;

    let receiver = preferredReceiver;

    if (!receiver) {
      // Determine user directional aim (from keyboard WASD or joystick)
      let inputX = 0;
      let inputY = 0;
      if (this.keys['a'] || this.keys['arrowleft']) inputX -= 1;
      if (this.keys['d'] || this.keys['arrowright']) inputX += 1;
      if (this.keys['w'] || this.keys['arrowup']) inputY += 1;
      if (this.keys['s'] || this.keys['arrowdown']) inputY -= 1;
      if (this.joystickVector.lengthSq() > 0.01) {
        inputX += this.joystickVector.x;
        inputY -= this.joystickVector.y;
      }

      if (Math.hypot(inputX, inputY) > 0.15) {
        const camForward = new THREE.Vector3();
        this.camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();
        const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
        const aimDir = new THREE.Vector3().addScaledVector(camRight, inputX).addScaledVector(camForward, inputY).normalize();

        let bestDot = -999;
        teammates.forEach(tm => {
          const toTm = new THREE.Vector3().subVectors(tm.position, passer.position);
          toTm.y = 0;
          const dist = toTm.length();
          toTm.normalize();
          // Score based on aim angle alignment and proximity
          const dot = aimDir.dot(toTm) - (dist > 18 ? 0.35 : 0);
          if (dot > bestDot) {
            bestDot = dot;
            receiver = tm;
          }
        });
      }

      // Fallback: Pick the most open teammate
      if (!receiver) {
        let bestScore = -999;
        teammates.forEach(tm => {
          const distToPasser = tm.position.distanceTo(passer.position);
          const opp = this.getNearestDefender(tm);
          const distToOpp = opp ? opp.position.distanceTo(tm.position) : 99;
          const score = distToOpp * 1.5 - distToPasser * 0.1;
          if (score > bestScore) {
            bestScore = score;
            receiver = tm;
          }
        });
      }
    }

    if (!receiver) {
      receiver = teammates[0];
    }

    this.ballHolder = null;
    this.passTargetPlayer = receiver;
    this.floorBounceCount = 0;
    this.isBallRolling = false;
    this.activeShot = null;

    // Visual chest pass follow-through on the passer
    passer.rightArmPivot.rotation.x = -1.45;
    passer.leftArmPivot.rotation.x = -1.45;
    passer.rightElbowPivot.rotation.x = -0.2;
    passer.leftElbowPivot.rotation.x = -0.2;

    const passDist = passer.position.distanceTo(receiver.position);
    const passTime = THREE.MathUtils.clamp(0.32 + passDist * 0.026, 0.36, 0.58);

    this.passReceiverPosLead.copy(receiver.position);

    const isBouncePass = passDist > 4.5 && Math.random() < 0.25;
    this.ballState = isBouncePass ? 'BOUNCE_PASS' : 'PASS';

    const forward = new THREE.Vector3().subVectors(this.passReceiverPosLead, passer.position).normalize();
    this.ballPos.set(passer.position.x, 1.25, passer.position.z).addScaledVector(forward, 0.4);
    this.ballPrevPos.copy(this.ballPos);
    this.ball.position.copy(this.ballPos);

    sounds.playSneakerSqueak();
    this.spawnFloatingStatus(`PASS TO ${receiver.data.name}`, receiver.position, '#38bdf8');

    if (!isBouncePass) {
      const targetPos = this.passReceiverPosLead.clone().setY(1.22);
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
      const maxHandY = THREE.MathUtils.lerp(0.80, 1.02, speedFrac) * (holder.data.heightScale || 1.0);
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
      const receiver = this.passTargetPlayer;

      // Animate receiver turning toward incoming pass and raising hands to catch
      receiver.lookAt(this.ballPos.x, receiver.position.y, this.ballPos.z);
      receiver.leftArmPivot.rotation.x = -1.1;
      receiver.rightArmPivot.rotation.x = -1.1;
      receiver.leftElbowPivot.rotation.x = -0.55;
      receiver.rightElbowPivot.rotation.x = -0.55;

      const toChest = new THREE.Vector3(receiver.position.x, 1.22, receiver.position.z).sub(this.ballPos);
      const distXZ = Math.hypot(this.ballPos.x - receiver.position.x, this.ballPos.z - receiver.position.z);

      // Adaptive magnetic homing so passes don't fly past moving teammates
      if (distXZ > 0.4 && this.ballState === 'PASS') {
        this.ballVel.x = THREE.MathUtils.lerp(this.ballVel.x, toChest.x * 4.5, dt * 6.5);
        this.ballVel.z = THREE.MathUtils.lerp(this.ballVel.z, toChest.z * 4.5, dt * 6.5);
      }

      // Realistic catch window (1.85m wingspan reach)
      if (distXZ < 1.85 && this.ballPos.y < 2.5) {
        this.ballHolder = receiver;
        this.ballState = 'DRIBBLE';
        this.passTargetPlayer = null;
        this.floorBounceCount = 0;
        this.isBallRolling = false;
        this.isInboundPlay = false;
        this.inboundTimer = 0;
        sounds.playDribble();

        if (receiver.data.team === 'GSW') {
          this.setControlledPlayer(receiver);
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
    } else {
      this.reboundMarker.visible = false;
    }

    // Active loose ball / rebound pursuit whenever there is no ball holder!
    if (!this.ballHolder && this.ballState !== 'MADE_DROP') {
      this.updateReboundPursuit(dt);
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
    if ((this.activeShot?.willMake || this.activeShot?.isGreen) && !this.activeShot.hasScored) return;

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
      const insideCylinder = distXZ <= (this.RIM_RADIUS + 0.08);

      // Ball is descending downwards
      const isDescending = this.ballVel.y < 0.15 || this.ballPos.y < this.ballPrevPos.y;

      // Vertical scoring band: passing down through the rim opening (between 2.50m and 3.25m)
      const inHeightZone = this.ballPos.y <= (this.RIM_HEIGHT + 0.14) && this.ballPos.y >= (this.RIM_HEIGHT - 0.55);
      const crossedDownward = (this.ballPrevPos.y >= (this.RIM_HEIGHT - 0.10) && this.ballPos.y <= (this.RIM_HEIGHT + 0.14)) ||
                              (this.ballVel.y < 0 && Math.abs(this.ballPos.y - this.RIM_HEIGHT) < 0.35);

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

        if (this.pendingShootingFoul) {
          const foul = this.pendingShootingFoul;
          this.pendingShootingFoul = null;
          this.nextPossessionTeam = null;
          sounds.playCrowdCheer();
          this.spawnFloatingStatus('AND-ONE! BASKET COUNTS!', h.pos, '#10b981');
          setTimeout(() => {
            this.triggerFoul(foul.shooter, foul.fouler, 'AND-ONE', 1, true);
          }, 850);
          break;
        }

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

      if (this.activeShot) {
        this.activeShot.hasHitFloor = true;
      }

      // Handle Bounce Pass floor contact: First bounce arcs up to the target player
      if (this.ballState === 'BOUNCE_PASS' && this.passTargetPlayer && this.floorBounceCount === 0) {
        this.floorBounceCount = 1;
        sounds.playDribble();
        const distLeft = this.ballPos.distanceTo(this.passTargetPlayer.position);
        const secondLegTime = THREE.MathUtils.clamp(distLeft * 0.08, 0.24, 0.42);
        this.ballVel.x = (this.passTargetPlayer.position.x - this.ballPos.x) / secondLegTime;
        this.ballVel.z = (this.passTargetPlayer.position.z - this.ballPos.z) / secondLegTime;
        this.ballVel.y = (1.15 - this.BALL_RADIUS - 0.5 * this.GRAVITY * secondLegTime * secondLegTime) / secondLegTime;
        return;
      }

      if (this.pendingShootingFoul && (this.ballState === 'SHOT' || this.ballState === 'REBOUND') && !this.activeShot?.hasScored) {
        const foul = this.pendingShootingFoul;
        this.pendingShootingFoul = null;
        this.triggerFoul(foul.shooter, foul.fouler, 'SHOOTING FOUL', foul.attempts);
        return;
      }

      if (this.ballState === 'PASS' && this.passTargetPlayer) {
        const receiver = this.passTargetPlayer;
        const distToReceiver = Math.hypot(this.ballPos.x - receiver.position.x, this.ballPos.z - receiver.position.z);
        if (distToReceiver < 2.5) {
          this.ballHolder = receiver;
          this.ballState = 'DRIBBLE';
          this.passTargetPlayer = null;
          this.floorBounceCount = 0;
          this.isBallRolling = false;
          this.isInboundPlay = false;
          this.inboundTimer = 0;
          sounds.playDribble();
          if (receiver.data.team === 'GSW') {
            this.setControlledPlayer(receiver);
            this.onPossessionChange?.(true);
          } else {
            this.onPossessionChange?.(false);
          }
          return;
        }
      }

      if ((this.ballState === 'SHOT' || this.ballState === 'PASS' || this.ballState === 'BOUNCE_PASS') && !this.activeShot?.hasScored) {
        if (this.ballState === 'SHOT' && this.rimBounceCount === 0) {
          // Ball hit the floor without touching the rim: Airball
          this.spawnFloatingStatus('AIRBALL!', this.ballPos, '#94a3b8');
        }
        this.ballState = 'REBOUND';
        this.passTargetPlayer = null;
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
    // 1. Give human player instant first-priority pickup if within range
    if (this.controlledPlayer) {
      const distXZ = Math.hypot(
        this.controlledPlayer.position.x - this.ballPos.x,
        this.controlledPlayer.position.z - this.ballPos.z
      );
      const isControlledJumping = this.controlledPlayer.isDefendingAnim || !!this.keys[' '];
      const maxCatchDist = isControlledJumping ? 1.75 : 1.45;
      const maxCatchY = isControlledJumping ? 2.75 : 2.10;

      if (distXZ < maxCatchDist && this.ballPos.y < maxCatchY) {
        this.claimBallPossession(this.controlledPlayer);
        return;
      }
    }

    // 2. Sort players across both teams by horizontal proximity to the ball
    const sortedPlayers = [...this.players].sort((a, b) => {
      const da = Math.hypot(a.position.x - this.ballPos.x, a.position.z - this.ballPos.z);
      const db = Math.hypot(b.position.x - this.ballPos.x, b.position.z - this.ballPos.z);
      return da - db;
    });

    // High-traffic tip-out scramble on contested aerial rebounds
    const highContenders = sortedPlayers.filter(r => r.position.distanceTo(this.ballPos) < 1.35);
    if (highContenders.length >= 2 && Math.random() < 0.12 && this.ballPos.y > 1.8) {
      const tipper = highContenders[Math.floor(Math.random() * highContenders.length)];
      const tipDir = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        1.8,
        tipper.data.team === 'GSW' ? 5.0 : -5.0
      );
      this.ballVel.copy(tipDir);
      sounds.playBlock();
      this.spawnFloatingStatus('TIP-OUT!', tipper.position, '#38bdf8');
      return;
    }

    // AI players actively pursue and scoop up the loose ball
    for (const p of sortedPlayers.slice(0, 6)) {
      if (p !== this.controlledPlayer) {
        const toBall = new THREE.Vector3(this.ballPos.x - p.position.x, 0, this.ballPos.z - p.position.z);
        if (toBall.length() > 0.15) {
          toBall.normalize();
          p.position.addScaledVector(toBall, p.data.speed * 0.92 * dt);
          p.lookAt(this.ballPos.x, p.position.y, this.ballPos.z);
        }
      }

      const distXZ = Math.hypot(p.position.x - this.ballPos.x, p.position.z - this.ballPos.z);
      const maxCatchDist = 1.35;
      const maxCatchY = 2.10;

      if (distXZ < maxCatchDist && this.ballPos.y < maxCatchY) {
        this.claimBallPossession(p);
        break;
      }
    }
  }

  private claimBallPossession(p: PlayerMesh) {
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
    this.passTargetPlayer = null;
    this.floorBounceCount = 0;
    this.houPassCount = 0;
    this.houCarrierDribbleTime = 0;

    // Official NBA Shot Clock rule: 14s on offensive rebound, 24s on defensive rebound
    if (isOffensiveRebound) {
      this.shotClock = 14.0;
      const label = p.data.team === 'GSW' ? 'OFFENSIVE REBOUND' : 'OFFENSIVE REBOUND (HOU)';
      this.spawnFloatingStatus(label, p.position, '#ffd700');
    } else {
      this.shotClock = 24.0;
      const label = p.data.team === 'GSW' ? 'REBOUND / LOOSE BALL' : 'REBOUND / LOOSE BALL (HOU)';
      this.spawnFloatingStatus(label, p.position, '#38bdf8');
    }

    sounds.playSneakerSqueak();

    if (p.data.team === 'GSW') {
      this.setControlledPlayer(p);
      this.onPossessionChange?.(true);
    } else {
      this.onPossessionChange?.(false);
    }
  }

  private executeInbound(team: 'GSW' | 'HOU', spot?: { x: number; z: number }, preferredInbounder?: PlayerMesh) {
    const inbounder = (preferredInbounder && preferredInbounder.data.team === team)
      ? preferredInbounder
      : this.players.find(p => p.data.team === team);
    if (!inbounder) return;

    const isGSW = team === 'GSW';
    const courtDir = isGSW ? -1 : 1;

    // Fully reset all player poses so nobody has arms/knees locked from previous plays
    this.resetAllPlayerPoses();

    if (spot) {
      // Side-out inbound near the foul / violation location
      inbounder.position.set(spot.x, 0, spot.z);
      inbounder.lookAt(0, 0, spot.z);

      const teammates = this.players.filter(p => p.data.team === team && p !== inbounder);
      const tmOffsets = [
        new THREE.Vector3(spot.x * 0.5, 0, spot.z + courtDir * 2.0),
        new THREE.Vector3(-spot.x * 0.4, 0, spot.z + courtDir * 3.8),
        new THREE.Vector3(0, 0, spot.z - courtDir * 2.5),
        new THREE.Vector3(spot.x * 0.2, 0, spot.z + courtDir * 5.8),
      ];
      teammates.forEach((tm, idx) => {
        if (tmOffsets[idx]) {
          tm.position.copy(tmOffsets[idx]);
          tm.lookAt(spot.x, 0, spot.z);
          tm.lastPos.copy(tm.position);
        }
      });

      const opponents = this.players.filter(p => p.data.team !== team);
      const oppOffsets = [
        new THREE.Vector3(spot.x * 0.65, 0, spot.z + courtDir * 1.8),
        new THREE.Vector3(spot.x * 0.35, 0, spot.z + courtDir * 3.5),
        new THREE.Vector3(-spot.x * 0.3, 0, spot.z + courtDir * 4.2),
        new THREE.Vector3(0, 0, spot.z + courtDir * 6.5),
        new THREE.Vector3(0, 0, isGSW ? -10.5 : 10.5),
      ];
      opponents.forEach((opp, idx) => {
        if (oppOffsets[idx]) {
          opp.position.copy(oppOffsets[idx]);
          opp.lookAt(spot.x, 0, spot.z);
          opp.lastPos.copy(opp.position);
        }
      });
    } else {
      const baselineZ = isGSW ? 13.8 : -13.8;
      inbounder.position.set(0, 0, baselineZ);
      inbounder.lookAt(0, 0, 0);

      // Space teammates in the backcourt/midcourt ready for inbound play
      const teammates = this.players.filter(p => p.data.team === team && p !== inbounder);
      const tmOffsets = [
        new THREE.Vector3(2.4, 0, baselineZ + courtDir * 3.5),
        new THREE.Vector3(-3.8, 0, baselineZ + courtDir * 5.5),
        new THREE.Vector3(4.2, 0, baselineZ + courtDir * 7.5),
        new THREE.Vector3(0, 0, baselineZ + courtDir * 10.5),
      ];
      teammates.forEach((tm, idx) => {
        if (tmOffsets[idx]) {
          tm.position.copy(tmOffsets[idx]);
          tm.lookAt(0, 0, 0);
          tm.lastPos.copy(tm.position);
        }
      });

      // Space defending opponents in transition defense
      const opponents = this.players.filter(p => p.data.team !== team);
      const oppOffsets = [
        new THREE.Vector3(2.2, 0, baselineZ + courtDir * 5.0),
        new THREE.Vector3(-3.4, 0, baselineZ + courtDir * 7.0),
        new THREE.Vector3(3.5, 0, baselineZ + courtDir * 9.5),
        new THREE.Vector3(-1.8, 0, baselineZ + courtDir * 12.0),
        new THREE.Vector3(0, 0, baselineZ + courtDir * 15.0),
      ];
      opponents.forEach((opp, idx) => {
        if (oppOffsets[idx]) {
          opp.position.copy(oppOffsets[idx]);
          opp.lookAt(0, 0, baselineZ);
          opp.lastPos.copy(opp.position);
        }
      });
    }

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

    if (isGSW) {
      this.setControlledPlayer(inbounder);
      this.onPossessionChange?.(true);
    } else {
      const userDef = this.players.find(p => p.data.team === 'GSW');
      if (userDef) this.setControlledPlayer(userDef);
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

    // 1. FREE THROW BROADCAST PERSPECTIVE (Directly behind the shooter facing rim)
    if (this.ballState === 'FREE_THROW' && this.activeFoul) {
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      if (this.playerFloorRing) this.playerFloorRing.visible = false;

      const shooter = this.activeFoul.fouledPlayer;
      const isGSW = shooter.data.team === 'GSW';
      const rimZ = isGSW ? -13.0 : 13.0;
      const camZ = isGSW ? shooter.position.z + 4.35 : shooter.position.z - 4.35;
      const camY = 3.35;
      const camX = shooter.position.x * 0.35;

      this.cameraTargetPos.set(camX, camY, camZ);
      this.cameraLookTarget.set(0, 2.9, rimZ);

      const followSpeed = dt * 6.5;
      this.camera.position.lerp(this.cameraTargetPos, followSpeed);
      this.cameraCurrentLook.lerp(this.cameraLookTarget, followSpeed);
      this.camera.lookAt(this.cameraCurrentLook);
      return;
    }

    // 1B. NBA INJURY & TACTICAL SUBSTITUTION BROADCAST CAMERA
    if (this.ballState === 'INJURY_SUB' && this.activeInjuryState) {
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      if (this.playerFloorRing) this.playerFloorRing.visible = false;

      const s = this.activeInjuryState;
      const target = s.injuredPlayer;

      if (s.stage === 'COLLAPSE') {
        // Dramatic low-angle medical timeout broadcast view focusing on fallen player
        const offsetX = target.position.x >= 0 ? 3.8 : -3.8;
        this.cameraTargetPos.set(target.position.x + offsetX, 2.2, target.position.z + 3.6);
        this.cameraLookTarget.set(target.position.x, 0.45, target.position.z);
      } else if (s.stage === 'SUB_ENTRY') {
        // Sideline tracking perspective showing substitute running in and injured player limping off
        const midX = (s.benchSidelinePos.x + s.courtTargetPos.x) * 0.5;
        const midZ = (s.benchSidelinePos.z + s.courtTargetPos.z) * 0.5;
        const offsetX = midX >= 0 ? 6.5 : -6.5;
        this.cameraTargetPos.set(midX + offsetX, 3.6, midZ + 4.8);
        this.cameraLookTarget.set(midX, 1.3, midZ);
      } else if (s.stage === 'TAG_OUT') {
        // Sideline tag & high-five celebration framing
        const offsetX = s.benchSidelinePos.x >= 0 ? 3.5 : -3.5;
        this.cameraTargetPos.set(s.benchSidelinePos.x + offsetX, 2.5, s.courtTargetPos.z + 3.2);
        this.cameraLookTarget.set(s.benchSidelinePos.x * 0.5 + s.courtTargetPos.x * 0.5, 1.4, s.courtTargetPos.z);
      }

      const followSpeed = dt * 4.5;
      this.camera.position.lerp(this.cameraTargetPos, followSpeed);
      this.cameraCurrentLook.lerp(this.cameraLookTarget, followSpeed);
      this.camera.lookAt(this.cameraCurrentLook);
      return;
    }

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
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = color;
    ctx.font = '900 40px Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 10;
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.2, 0.55, 1);
    const startY = pos.y && pos.y > 0.5 ? pos.y + 0.4 : 2.5;
    sprite.position.set(pos.x, startY, pos.z);
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
  // HOUSTON AI OFFENSE & DEFENSE (ADVANCED NBA TACTICAL PLAYBOOK)
  // --------------------------------------------------------------------------
  private updateHoustonAI(dt: number) {
    if (this.ballState === 'FREE_THROW') return;

    const houPlayers = this.players.filter(p => p.data.team === 'HOU');
    const gswPlayers = this.players.filter(p => p.data.team === 'GSW');
    const isHouOffense = this.ballHolder && this.ballHolder.data.team === 'HOU';

    this.aiDecisionTimer += dt;
    this.aiPassTimer += dt;
    this.houPlayTimer += dt;

    // Rotate tactical playcall every 6.5s or on turnover
    if (this.houPlayTimer > 6.5) {
      this.houPlayTimer = 0;
      const plays: Array<'PICK_AND_ROLL' | 'ISOLATION' | 'DRIVE_AND_KICK' | 'MOTION'> = [
        'PICK_AND_ROLL',
        'DRIVE_AND_KICK',
        'ISOLATION',
        'MOTION',
      ];
      this.houPlayType = plays[Math.floor(Math.random() * plays.length)];
      this.houScreener = null;
    }

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

      // Identify Houston Center (Alperen Sengun) and Wings (Jalen Green, Jabari Smith)
      const center = houPlayers.find(p => p.data.position === 'C') || houPlayers[4] || houPlayers[0];
      const wings = houPlayers.filter(p => p !== carrier && p !== center);

      // -----------------------------------------------------------------------
      // TACTIC A: HIGH PICK & ROLL (SENGUN SCREEN & ROLL)
      // -----------------------------------------------------------------------
      if (this.houPlayType === 'PICK_AND_ROLL' && center && center !== carrier) {
        this.houScreener = center;
        const screenTime = this.houPlayTimer;

        if (screenTime < 3.2) {
          // Phase 1: Center sets solid on-ball screen next to carrier's defender
          if (defender) {
            const screenSide = carrier.position.x >= 0 ? -0.85 : 0.85;
            const screenSpot = new THREE.Vector3(defender.position.x + screenSide, 0, defender.position.z - 0.25);
            const toScreen = new THREE.Vector3().subVectors(screenSpot, center.position);
            toScreen.y = 0;
            if (toScreen.length() > 0.25) {
              toScreen.normalize();
              center.position.addScaledVector(toScreen, center.data.speed * 1.15 * dt);
            }
            center.lookAt(defender.position.x, center.position.y, defender.position.z);
            // Screening stance
            center.leftArmPivot.rotation.x = -0.3;
            center.rightArmPivot.rotation.x = -0.3;
          }

          // Carrier rubs defender off the screen
          const driveDir = new THREE.Vector3(carrier.position.x >= 0 ? -1.0 : 1.0, 0, 1.4).normalize();
          carrier.position.addScaledVector(driveDir, carrier.data.speed * 1.05 * dt);
          carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
          carrier.dribbleHand = Math.sin(this.gameClock * 6) > 0 ? 'left' : 'right';
        } else {
          // Phase 2: Screener rolls hard to the basket for a dunk/layup!
          const rollSpot = new THREE.Vector3(0, 0, 11.2);
          const toRoll = new THREE.Vector3().subVectors(rollSpot, center.position);
          toRoll.y = 0;
          if (toRoll.length() > 0.3) {
            toRoll.normalize();
            center.position.addScaledVector(toRoll, center.data.speed * 1.25 * dt);
            center.lookAt(targetRim.x, center.position.y, targetRim.z);
            // Hands raised calling for pocket pass / alley-oop
            center.leftArmPivot.rotation.x = -1.4;
            center.rightArmPivot.rotation.x = -1.4;
          }

          // Carrier reads defense: Pocket pass to rolling Sengun if open!
          const centerDefender = this.getNearestDefender(center);
          const centerDefDist = centerDefender ? centerDefender.position.distanceTo(center.position) : 99;
          if (centerDefDist > 1.6 && toRoll.length() < 3.5 && this.aiPassTimer > 0.75) {
            this.aiPassTimer = 0;
            this.initiatePass(carrier, center);
            return;
          }
        }
      }

      // -----------------------------------------------------------------------
      // TACTIC B: 5-OUT CORNER SPACING & DRIVE-AND-KICK
      // -----------------------------------------------------------------------
      const offBallSpots: Record<string, THREE.Vector3> = {
        PG: new THREE.Vector3(0, 0, 5.0),
        SG: new THREE.Vector3(-5.4, 0, 9.2),  // Left corner / wing 3
        SF: new THREE.Vector3(5.4, 0, 9.2),   // Right corner / wing 3
        PF: new THREE.Vector3(-4.6, 0, 6.4),  // Left slot 3
        C: new THREE.Vector3(4.6, 0, 6.4),    // Right slot 3
      };

      houPlayers.forEach(p => {
        if (p === carrier || p === this.houScreener) return;
        const base = offBallSpots[p.data.position] || new THREE.Vector3(p.position.x > 0 ? 5.2 : -5.2, 0, 8.5);
        const sway = Math.sin(this.gameClock * 2.2 + p.position.x) * 0.35;
        const target = new THREE.Vector3(base.x + sway, 0, base.z);

        // Relocate away from carrier's driving lane to clear driving space
        if (target.distanceTo(carrier.position) < 2.2) {
          target.x = target.x > 0 ? target.x + 1.2 : target.x - 1.2;
        }

        const toTarget = new THREE.Vector3().subVectors(target, p.position);
        toTarget.y = 0;
        if (toTarget.length() > 0.3) {
          toTarget.normalize();
          p.position.addScaledVector(toTarget, p.data.speed * 0.90 * dt);
        }
        p.lookAt(carrier.position.x, p.position.y, carrier.position.z);
      });

      // -----------------------------------------------------------------------
      // CARRIER DRIVING & CROSSOVER FOOTWORK
      // -----------------------------------------------------------------------
      if (this.houPlayType !== 'PICK_AND_ROLL' || this.houPlayTimer >= 3.2) {
        if (distToRim > 1.2) {
          toRim.normalize();
          carrier.dribbleHand = Math.sin(this.gameClock * 6.5) > 0 ? 'left' : 'right';
          const driveSpeedMult = defDist < 1.3 ? 1.05 : 1.28;
          carrier.position.addScaledVector(toRim, carrier.data.speed * driveSpeedMult * dt);
          carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
        }
      }

      // -----------------------------------------------------------------------
      // HIGH-IQ SHOT DECISIONS
      // -----------------------------------------------------------------------
      // 1. RIM FINISH: High-percentage Dunk / Layup within 3.6m
      if (distToRim <= 3.6 && this.ballState === 'DRIBBLE') {
        this.houCarrierDribbleTime = 0;
        this.aiDecisionTimer = 0;
        this.executeShot(carrier, 0.65);
        return;
      }

      // 2. OPEN 3-POINTER / RHYTHM PULL-UP JUMPER
      // If defender is sagging > 1.6m away and carrier is near 3-pt line (distToRim 6.4m - 8.2m)
      const isPerimeterOpen = defDist > 1.6 && distToRim >= 6.2 && distToRim <= 8.2 && this.houCarrierDribbleTime > 0.6;
      const isMidRangeOpen = defDist > 1.8 && distToRim >= 4.0 && distToRim < 6.2;
      const clockExpiring = this.shotClock <= 3.5;

      if ((isPerimeterOpen || isMidRangeOpen || clockExpiring) && this.ballState === 'DRIBBLE') {
        this.houCarrierDribbleTime = 0;
        this.aiDecisionTimer = 0;
        this.executeShot(carrier, 0.65);
        return;
      }

      // 3. DRIVE-AND-KICK PASS (Find open perimeter shooter when defense collapses)
      const isDefenseCollapsed = defDist < 1.35 && distToRim < 5.8;
      if ((isDefenseCollapsed || this.houPlayType === 'DRIVE_AND_KICK') && this.aiPassTimer > 1.1 && this.ballState === 'DRIBBLE') {
        // Find most open shooter outside the 3-point line
        let openShooter: PlayerMesh | null = null;
        let maxOpenSpace = 1.6;
        wings.forEach(w => {
          const wDef = this.getNearestDefender(w);
          const wDefDist = wDef ? wDef.position.distanceTo(w.position) : 99;
          if (wDefDist > maxOpenSpace) {
            maxOpenSpace = wDefDist;
            openShooter = w;
          }
        });

        if (openShooter) {
          this.houPassCount++;
          this.houCarrierDribbleTime = 0;
          this.aiPassTimer = 0;
          this.initiatePass(carrier, openShooter);
          return;
        }
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

            // Controlled contest foul check on GSW shooter in flight
            if (this.ballState === 'SHOT' && this.activeShot && distToShooter < 1.45 && this.foulCooldownTimer <= 0 && Math.random() < 0.12) {
              if (shooter && !this.pendingShootingFoul) {
                const attempts = this.activeShot.points === 3 ? 3 : 2;
                this.pendingShootingFoul = { shooter, fouler: p, attempts };
                this.foulCooldownTimer = 7.0;
                sounds.playWhistle();
                this.spawnFloatingStatus('FOUL ON CONTEST!', p.position, '#f59e0b');
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

      // =======================================================================
      // HIGH-IQ NBA DEFENSIVE SCHEME: DROP COVERAGE, ANGLE CUT-OFFS & HELP DEFENSE
      // =======================================================================
      if (gswCarrier) {
        const distToCarrier = p.position.distanceTo(gswCarrier.position);
        const distCarrierToHoop = gswCarrier.position.distanceTo(this.gswHoopPos);
        const isCenter = p.data.position === 'C';
        const isPrimaryDefender = p === this.getNearestDefender(gswCarrier);
        const isBackcourt = gswCarrier.position.z > 2.0;

        // -------------------------------------------------------------------
        // ROLE 1: PRIMARY ON-BALL DEFENDER (SHADES & CUTS OFF ANGLES, NEVER CHASES)
        // -------------------------------------------------------------------
        if (isPrimaryDefender) {
          let targetDefPos: THREE.Vector3;

          if (isBackcourt) {
            // TRANSITION PICK-UP: Don't chase into opponent's backcourt!
            // Wait at the timeline/3-point arc in a wide defensive stance
            const pickUpZ = Math.min(1.0, gswCarrier.position.z - 2.5);
            targetDefPos = new THREE.Vector3(gswCarrier.position.x * 0.7, 0, pickUpZ);
          } else {
            // HALF-COURT DROP & SHADOW: Stay strictly between player and basket
            const dirToHoop = new THREE.Vector3().subVectors(this.gswHoopPos, gswCarrier.position);
            dirToHoop.y = 0;
            dirToHoop.normalize();

            // Desired cushion (1.45m - 1.8m)
            const cushion = distCarrierToHoop < 5.0 ? 1.15 : 1.55;
            targetDefPos = gswCarrier.position.clone().addScaledVector(dirToHoop, cushion);

            // Anticipatory Lateral Shading: Cut off driver's movement lane
            const carrierMoveX = gswCarrier.position.x - gswCarrier.lastPos.x;
            const carrierMoveZ = gswCarrier.position.z - gswCarrier.lastPos.z;
            targetDefPos.x += carrierMoveX * 8.0;
            targetDefPos.z += carrierMoveZ * 4.0;
          }

          // Slide laterally toward target defensive spot
          const toTarget = new THREE.Vector3().subVectors(targetDefPos, p.position);
          toTarget.y = 0;
          const distToTarget = toTarget.length();

          if (distToTarget > 0.15) {
            toTarget.normalize();
            // Faster lateral slide when carrier is moving fast
            const slideSpeed = Math.min(p.data.speed * 1.15, distToTarget * 4.5);
            p.position.addScaledVector(toTarget, slideSpeed * dt);
          }

          // Face the ball handler with active defensive stance
          p.lookAt(gswCarrier.position.x, p.position.y, gswCarrier.position.z);
          p.leftArmPivot.rotation.x = -1.15;
          p.rightArmPivot.rotation.x = -1.15;
          p.leftKneePivot.rotation.x = 0.28;
          p.rightKneePivot.rotation.x = 0.28;

          // Poke check / contest steal attempt (only when ball handler exposes ball close up)
          if (distToCarrier < 1.30 && Math.random() < 0.015 && this.ballState === 'DRIBBLE') {
            p.rightArmPivot.rotation.x = -1.6;

            // 15% chance of reach-in foul
            if (Math.random() < 0.15) {
              this.triggerFoul(gswCarrier, p, 'REACH-IN FOUL');
              return;
            }

            if (Math.random() < 0.22) {
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

        // -------------------------------------------------------------------
        // ROLE 2: RIM PROTECTOR / DROP ANCHOR (CENTER e.g. SENGUN)
        // -------------------------------------------------------------------
        if (isCenter) {
          let rimAnchorPos: THREE.Vector3;

          if (distCarrierToHoop < 5.8 && gswCarrier.position.z < -6.0) {
            // STEP UP AND MEET DRIVER AT THE RIM: Help defense wall!
            const stepOut = new THREE.Vector3().subVectors(gswCarrier.position, this.gswHoopPos).normalize();
            rimAnchorPos = this.gswHoopPos.clone().addScaledVector(stepOut, 1.3);
            p.rightArmPivot.rotation.x = -1.5;
            p.leftArmPivot.rotation.x = -1.5;
          } else {
            // DROP COVERAGE: Guard the paint and deter drives
            rimAnchorPos = new THREE.Vector3(
              THREE.MathUtils.clamp(gswCarrier.position.x * 0.35, -1.8, 1.8),
              0,
              -10.4
            );
            p.rightArmPivot.rotation.x = -0.7;
            p.leftArmPivot.rotation.x = -0.7;
          }

          const toAnchor = new THREE.Vector3().subVectors(rimAnchorPos, p.position);
          toAnchor.y = 0;
          if (toAnchor.length() > 0.2) {
            toAnchor.normalize();
            p.position.addScaledVector(toAnchor, p.data.speed * 0.85 * dt);
          }
          p.lookAt(gswCarrier.position.x, p.position.y, gswCarrier.position.z);
          return;
        }

        // -------------------------------------------------------------------
        // ROLE 3: OFF-BALL HELP & DENIAL (BALL-YOU-MAN TRIANGLE)
        // -------------------------------------------------------------------
        const myMatchup = gswPlayers.find(opp => opp.data.position === p.data.position) || gswPlayers[0];
        const matchupToBall = myMatchup.position.distanceTo(gswCarrier.position);
        const isWeakside = (myMatchup.position.x * gswCarrier.position.x < 0) || matchupToBall > 6.5;

        let idealSpot: THREE.Vector3;

        if (isWeakside) {
          // WEAK-SIDE HELP (ONE FOOT IN THE PAINT):
          // Sag into the lane to protect against drives, while keeping eye on matchup
          idealSpot = myMatchup.position.clone().lerp(this.gswHoopPos, 0.45);
          idealSpot.x = THREE.MathUtils.clamp(idealSpot.x, -2.5, 2.5);
          idealSpot.z = THREE.MathUtils.clamp(idealSpot.z, -11.0, -4.5);
        } else {
          // STRONG-SIDE PASS DENIAL:
          // Position between matchup and ball to deny direct passing lane
          const toHoop = new THREE.Vector3().subVectors(this.gswHoopPos, myMatchup.position).normalize();
          const toCarrier = new THREE.Vector3().subVectors(gswCarrier.position, myMatchup.position).normalize();
          const blendedDir = new THREE.Vector3().addVectors(toHoop, toCarrier).normalize();
          idealSpot = myMatchup.position.clone().addScaledVector(blendedDir, 1.4);
        }

        // Keep inside the court boundaries
        idealSpot.x = THREE.MathUtils.clamp(idealSpot.x, -6.8, 6.8);
        idealSpot.z = THREE.MathUtils.clamp(idealSpot.z, -13.0, 1.0);

        const moveDir = new THREE.Vector3().subVectors(idealSpot, p.position);
        moveDir.y = 0;
        if (moveDir.length() > 0.25) {
          moveDir.normalize();
          p.position.addScaledVector(moveDir, p.data.speed * 0.90 * dt);
        }

        // Defensive Triangle Vision: Look toward the midpoint between man and ball
        const midVision = new THREE.Vector3().addVectors(myMatchup.position, gswCarrier.position).multiplyScalar(0.5);
        p.lookAt(midVision.x, p.position.y, midVision.z);
        p.leftArmPivot.rotation.x = -0.8;
        p.rightArmPivot.rotation.x = -0.8;
      }
    });
  }

  // --------------------------------------------------------------------------
  // GOLDEN STATE WARRIORS AI BOT TEAMMATES (ACTIVE DEFENSE & MOTION OFFENSE)
  // --------------------------------------------------------------------------
  private updateGSWTeammatesAI(dt: number) {
    if (this.ballState === 'FREE_THROW') return;

    const gswTeammates = this.players.filter(
      p => p.data.team === 'GSW' && p !== this.controlledPlayer
    );
    if (gswTeammates.length === 0) return;

    const houPlayers = this.players.filter(p => p.data.team === 'HOU');
    const isHouOffense = this.ballHolder && this.ballHolder.data.team === 'HOU';
    const isHouShotActive =
      this.ballState === 'SHOT' && this.activeShot?.shooterTeam === 'HOU';
    const isGswOffense = this.ballHolder && this.ballHolder.data.team === 'GSW';

    this.gswCutTimer += dt;
    this.gswScreenTimer += dt;

    // ------------------------------------------------------------------------
    // 1. GSW DEFENSIVE AI (WHEN HOUSTON HAS POSSESSION OR SHOOTS)
    // ------------------------------------------------------------------------
    if (isHouOffense || isHouShotActive) {
      const houCarrier = this.ballHolder && this.ballHolder.data.team === 'HOU' ? this.ballHolder : null;
      const houShooter = isHouShotActive ? (this.activeShot?.shooter || houCarrier) : null;
      const primaryTarget = houShooter || houCarrier;

      // Find which GSW player is closest to the primary target
      let primaryGswDefender: PlayerMesh | null = null;
      if (primaryTarget) {
        let minDist = 999;
        this.players
          .filter(p => p.data.team === 'GSW')
          .forEach(p => {
            const d = p.position.distanceTo(primaryTarget.position);
            if (d < minDist) {
              minDist = d;
              primaryGswDefender = p;
            }
          });
      }

      gswTeammates.forEach(p => {
        if (p.isDunking || p.isShootingAnim) return;

        // A. CONTESTING HOUSTON SHOTS (LEAP, CONTEST & BLOCK)
        if (isHouShotActive && houShooter) {
          const distToShooter = p.position.distanceTo(houShooter.position);
          const isNearestToShooter = p === primaryGswDefender || distToShooter < 2.2;

          if (isNearestToShooter) {
            // Close out fast toward the shooter!
            const toShooter = new THREE.Vector3().subVectors(houShooter.position, p.position);
            toShooter.y = 0;
            if (toShooter.length() > 0.8) {
              toShooter.normalize();
              p.position.addScaledVector(toShooter, p.data.speed * 1.18 * dt);
            }
            p.lookAt(houShooter.position.x, p.position.y, houShooter.position.z);

            // Leaping defensive block contest!
            if (!p.isDefendingAnim && distToShooter < 2.2) {
              p.isDefendingAnim = true;
              p.defendAnimTimer = 0;

              // Elite GSW shot blocking (Draymond Green, Wiggins, Looney)
              const isEliteShotBlocker =
                p.data.position === 'PF' || p.data.position === 'C' || p.data.name.includes('GREEN') || p.data.name.includes('WIGGINS');
              const blockChance = isEliteShotBlocker ? 0.26 : 0.16;

              if (this.activeShot && Math.random() < blockChance && this.ballPos.y < 3.25 && distToShooter < 1.6) {
                sounds.playBlock();
                this.spawnFloatingStatus(`BLOCKED BY ${p.data.name}!`, p.position, '#0053bc');
                this.ballState = 'REBOUND';
                this.activeShot = null;
                this.ballVel.set((Math.random() - 0.5) * 4.0, 1.8, -3.5);
                return;
              }

              // Controlled contest foul risk on Houston shooter in flight
              if (this.activeShot && distToShooter < 1.35 && this.foulCooldownTimer <= 0 && Math.random() < 0.10) {
                if (!this.pendingShootingFoul) {
                  const attempts = this.activeShot.points === 3 ? 3 : 2;
                  this.pendingShootingFoul = { shooter: houShooter, fouler: p, attempts };
                  this.foulCooldownTimer = 7.0;
                  sounds.playWhistle();
                  this.spawnFloatingStatus('FOUL ON CONTEST!', p.position, '#f59e0b');
                  return;
                }
              }
            }
            return;
          } else {
            // Off-ball GSW defenders immediately box out near Houston's target hoop
            const boxZ = 11.6 + Math.sin(p.runCycle) * 0.4;
            const boxX = (p.position.x > 0 ? 1 : -1) * 1.8;
            const toBox = new THREE.Vector3(boxX - p.position.x, 0, boxZ - p.position.z);
            if (toBox.length() > 0.35) {
              toBox.normalize();
              p.position.addScaledVector(toBox, p.data.speed * 0.92 * dt);
              p.lookAt(this.houHoopPos.x, p.position.y, this.houHoopPos.z);
            }
            return;
          }
        }

        // B. ON-BALL ACTIVE PERIMETER & DRIVE DEFENSE
        if (houCarrier) {
          const distToCarrier = p.position.distanceTo(houCarrier.position);
          const isPrimaryOnBall = p === primaryGswDefender && this.controlledPlayer !== primaryGswDefender;

          if (isPrimaryOnBall) {
            // Position directly between carrier and the basket Houston is attacking
            const dirToHoop = new THREE.Vector3().subVectors(this.houHoopPos, houCarrier.position);
            dirToHoop.y = 0;
            dirToHoop.normalize();

            // Give a 1.15m athletic cushion
            const idealPos = houCarrier.position.clone().addScaledVector(dirToHoop, 1.15);
            const toIdeal = new THREE.Vector3().subVectors(idealPos, p.position);
            toIdeal.y = 0;

            if (toIdeal.length() > 0.15) {
              toIdeal.normalize();
              p.position.addScaledVector(toIdeal, p.data.speed * 1.05 * dt);
            }
            p.lookAt(houCarrier.position.x, p.position.y, houCarrier.position.z);

            // Active on-ball defensive stance: arms up
            p.leftArmPivot.rotation.x = -1.1;
            p.rightArmPivot.rotation.x = -1.1;

            // Active poke-check strip attempts by GSW defenders (Draymond, Wiggins, Looney, Klay)
            if (distToCarrier < 1.35 && Math.random() < 0.016 && this.ballState === 'DRIBBLE') {
              p.rightArmPivot.rotation.x = -1.6;

              // 15% reach-in foul risk
              if (Math.random() < 0.15) {
                this.triggerFoul(houCarrier, p, 'REACH-IN FOUL');
                return;
              }

              // 22% clean on-ball strip
              if (Math.random() < 0.22) {
                this.ballHolder = null;
                this.ballState = 'REBOUND';
                this.activeShot = null;
                this.ballVel.set((Math.random() - 0.5) * 3.5, 1.3, -2.8);
                sounds.playSneakerSqueak();
                this.spawnFloatingStatus(`STEAL BY ${p.data.name}!`, p.position, '#0053bc');
                this.onPossessionChange?.(false);
                return;
              }
            }
            return;
          }

          // C. RIM PROTECTION / HELP DEFENSE IN THE PAINT
          const distCarrierToRim = Math.hypot(
            houCarrier.position.x - this.houHoopPos.x,
            houCarrier.position.z - this.houHoopPos.z
          );
          const isBigMan = p.data.position === 'C' || p.data.position === 'PF';

          if (distCarrierToRim <= 3.8 && isBigMan) {
            // Help defender drops into paint to wall up at the rim!
            const helpX = THREE.MathUtils.clamp(houCarrier.position.x * 0.65, -1.3, 1.3);
            const helpZ = 11.8;
            const toHelp = new THREE.Vector3(helpX - p.position.x, 0, helpZ - p.position.z);
            if (toHelp.length() > 0.2) {
              toHelp.normalize();
              p.position.addScaledVector(toHelp, p.data.speed * 1.02 * dt);
            }
            p.lookAt(houCarrier.position.x, p.position.y, houCarrier.position.z);
            p.leftArmPivot.rotation.x = -1.5;
            p.rightArmPivot.rotation.x = -1.5;
            return;
          }
        }

        // D. OFF-BALL MATCHUP SHADOWING & PASSING LANE DENIAL
        const myMatchup = houPlayers.find(opp => opp.data.position === p.data.position) || houPlayers[0];
        const dirToHoop = new THREE.Vector3().subVectors(this.houHoopPos, myMatchup.position);
        dirToHoop.y = 0;
        dirToHoop.normalize();

        const idealGuardPos = myMatchup.position.clone().addScaledVector(dirToHoop, 1.35);
        const moveDir = new THREE.Vector3().subVectors(idealGuardPos, p.position);
        moveDir.y = 0;
        if (moveDir.length() > 0.25) {
          moveDir.normalize();
          p.position.addScaledVector(moveDir, p.data.speed * 0.90 * dt);
        }
        p.lookAt(myMatchup.position.x, p.position.y, myMatchup.position.z);
      });
      return;
    }

    // ------------------------------------------------------------------------
    // 2. GSW OFFENSIVE MOTION & FLOOR SPACING (WHEN USER/GSW HAS BALL)
    // ------------------------------------------------------------------------
    if (isGswOffense && this.ballHolder) {
      const user = this.ballHolder;
      const targetRim = this.gswHoopPos;

      // Authentic Golden State Motion Offense Base Spots:
      // SG (Klay): Left Wing / Corner
      // SF (Wiggins): Right Wing / Corner
      // PF (Draymond): High Post / Screen Partner
      // C (Looney): Low Block / Dunker Spot
      const offBallSpots: Record<string, THREE.Vector3> = {
        SG: new THREE.Vector3(-5.2, 0, -8.2),
        SF: new THREE.Vector3(5.2, 0, -8.2),
        PF: new THREE.Vector3(-0.6, 0, -6.4),
        C: new THREE.Vector3(2.4, 0, -11.2),
      };

      // Check if user is trapped by Houston defenders (distance < 1.4m)
      const userDefender = this.getNearestDefender(user);
      const isUserTrapped = userDefender ? userDefender.position.distanceTo(user.position) < 1.35 : false;

      // Find closest teammate to provide emergency safety valve pass option
      let closestTeammate: PlayerMesh = gswTeammates[0];
      let minTmDist = 999;
      gswTeammates.forEach(tm => {
        const d = tm.position.distanceTo(user.position);
        if (d < minTmDist) {
          minTmDist = d;
          closestTeammate = tm;
        }
      });

      gswTeammates.forEach(p => {
        if (p.isDunking || p.isShootingAnim) return;

        // A. EMERGENCY OUTLET PASS: Flash toward trapped ball carrier
        if (isUserTrapped && p === closestTeammate) {
          const toUser = new THREE.Vector3().subVectors(user.position, p.position);
          toUser.y = 0;
          const dist = toUser.length();
          if (dist > 2.6) {
            toUser.normalize();
            p.position.addScaledVector(toUser, p.data.speed * 1.12 * dt);
          }
          p.lookAt(user.position.x, p.position.y, user.position.z);
          // Raise hands calling for pass
          p.leftArmPivot.rotation.x = -1.25;
          p.rightArmPivot.rotation.x = -1.25;
          return;
        }

        // B. WARRIORS OFF-BALL PIN-DOWN SCREEN (Draymond screens for Klay)
        const isDraymond = p.data.position === 'PF';
        const isKlay = p.data.position === 'SG';
        const klay = gswTeammates.find(t => t.data.position === 'SG');

        if (this.gswCutTimer < 3.8 && isDraymond && klay) {
          // Draymond plants a down-screen at the left elbow
          const screenSpot = new THREE.Vector3(-2.6, 0, -7.2);
          const toScreen = new THREE.Vector3().subVectors(screenSpot, p.position);
          toScreen.y = 0;
          if (toScreen.length() > 0.25) {
            toScreen.normalize();
            p.position.addScaledVector(toScreen, p.data.speed * 1.05 * dt);
          }
          p.lookAt(screenSpot.x, p.position.y, screenSpot.z);
          p.leftArmPivot.rotation.x = -0.3;
          p.rightArmPivot.rotation.x = -0.3;
          return;
        }

        if (this.gswCutTimer < 3.8 && isKlay) {
          // Klay rubs defender off Draymond's pin-down and flares to the 3-point wing!
          const flareTarget = new THREE.Vector3(-5.4, 0, -8.2);
          const toFlare = new THREE.Vector3().subVectors(flareTarget, p.position);
          toFlare.y = 0;
          if (toFlare.length() > 0.3) {
            toFlare.normalize();
            p.position.addScaledVector(toFlare, p.data.speed * 1.2 * dt);
          }
          p.lookAt(user.position.x, p.position.y, user.position.z);
          // Hands raised calling for the catch-and-shoot pass!
          p.leftArmPivot.rotation.x = -1.35;
          p.rightArmPivot.rotation.x = -1.35;
          return;
        }

        // C. ON-BALL PICK & ROLL / PICK & POP (Draymond Green or Kevon Looney)
        const isScreener = p.data.position === 'C' || (p.data.position === 'PF' && this.gswCutTimer >= 3.8);
        const userInPerimeter = user.position.z > -10.5;

        if (isScreener && userInPerimeter && this.gswScreenTimer > 2.5 && userDefender) {
          const screenPhase = this.gswScreenTimer - 2.5;

          if (screenPhase < 2.8) {
            // Phase 1: Set solid on-ball screen adjacent to the user's defender
            const screenSide = user.position.x >= 0 ? -0.85 : 0.85;
            const screenTarget = new THREE.Vector3(userDefender.position.x + screenSide, 0, userDefender.position.z + 0.35);
            const toScreen = new THREE.Vector3().subVectors(screenTarget, p.position);
            toScreen.y = 0;

            if (toScreen.length() > 0.25) {
              toScreen.normalize();
              p.position.addScaledVector(toScreen, p.data.speed * 1.1 * dt);
            }
            p.lookAt(userDefender.position.x, p.position.y, userDefender.position.z);
            p.leftArmPivot.rotation.x = -0.35;
            p.rightArmPivot.rotation.x = -0.35;
          } else {
            // Phase 2: Roll hard to the rim or Pop out to the 3-point line!
            const shouldPop = p.data.position === 'PF'; // Draymond pops, Looney rolls
            const target = shouldPop ? new THREE.Vector3(0, 0, -6.8) : new THREE.Vector3(1.2, 0, -11.2);
            const toAction = new THREE.Vector3().subVectors(target, p.position);
            toAction.y = 0;
            if (toAction.length() > 0.3) {
              toAction.normalize();
              p.position.addScaledVector(toAction, p.data.speed * 1.15 * dt);
            }
            p.lookAt(user.position.x, p.position.y, user.position.z);
            // Hands ready to catch
            p.leftArmPivot.rotation.x = -1.2;
            p.rightArmPivot.rotation.x = -1.2;

            if (this.gswScreenTimer > 6.5) {
              this.gswScreenTimer = 0;
            }
          }
          return;
        }

        // D. BACKDOOR BASELINE CUT TO BASKET (Andrew Wiggins)
        const isWiggins = p.data.position === 'SF';
        if (isWiggins && this.gswCutTimer > 4.5 && this.gswCutTimer < 6.8) {
          // Sprint backdoor behind the defense toward the rim!
          const cutTarget = new THREE.Vector3(1.8, 0, -11.4);
          const toCut = new THREE.Vector3().subVectors(cutTarget, p.position);
          toCut.y = 0;
          if (toCut.length() > 0.3) {
            toCut.normalize();
            p.position.addScaledVector(toCut, p.data.speed * 1.22 * dt);
            p.lookAt(targetRim.x, p.position.y, targetRim.z);
            // Hands raised calling for alley-oop or bounce pass!
            p.leftArmPivot.rotation.x = -1.45;
            p.rightArmPivot.rotation.x = -1.45;
          }
          if (this.gswCutTimer >= 6.8) {
            this.gswCutTimer = 0;
          }
          return;
        }

        // E. 5-OUT DYNAMIC PERIMETER MOTION & PASSING LANE RELOCATION
        const baseSpot = offBallSpots[p.data.position] || new THREE.Vector3(-4.5, 0, -8.0);
        const dynamicSway = Math.sin(this.gameClock * 2.2 + p.position.x) * 0.42;
        const targetSpot = new THREE.Vector3(baseSpot.x + dynamicSway, 0, baseSpot.z);

        // If user drives toward this spot, flare away along the 3-point line to preserve spacing!
        const userDistToSpot = targetSpot.distanceTo(user.position);
        if (userDistToSpot < 2.8) {
          targetSpot.x = targetSpot.x > 0 ? targetSpot.x + 1.4 : targetSpot.x - 1.4;
        }

        const toSpot = new THREE.Vector3().subVectors(targetSpot, p.position);
        toSpot.y = 0;
        if (toSpot.length() > 0.28) {
          toSpot.normalize();
          p.position.addScaledVector(toSpot, p.data.speed * 0.92 * dt);
        }
        // Always face the ball carrier ready for catch-and-shoot!
        p.lookAt(user.position.x, p.position.y, user.position.z);
      });
    }

    // Enforce out-of-bounds boundary clamping for all GSW teammates
    gswTeammates.forEach(p => {
      p.position.x = THREE.MathUtils.clamp(p.position.x, -7.05, 7.05);
      p.position.z = THREE.MathUtils.clamp(p.position.z, -13.68, 13.68);
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
      if (isTryingSprint && move.lengthSq() > 0) {
        if (this.stamina > 0.15) {
          speedMult = 1.4;
        } else if (this.stamina > 0.0) {
          speedMult = 1.15; // Fatigued sprint
        }
        this.stamina = Math.max(0, this.stamina - dt * 0.22);
      } else if (!isTryingSprint) {
        this.stamina = Math.min(1.0, this.stamina + dt * 0.32);
      }
      this.onStaminaUpdate?.(this.stamina);

      // Zero Stamina Exhaustion Injury: Sustained sprinting until stamina reaches zero leads to muscle failure/collapse
      if (isTryingSprint && this.stamina <= 0.001 && move.lengthSq() > 0 && !this.activeInjuryState && this.ballState !== 'INJURY_SUB') {
        const fatigueInjuries = [
          { type: 'ACUTE HAMSTRING STRAIN (FATIGUE COLLAPSE)', desc: `${this.controlledPlayer.data.name} pushed through 0% stamina and collapsed on the hardwood with an acute hamstring pull!` },
          { type: 'SEVERE QUADRICEPS / GROIN CRAMP', desc: `${this.controlledPlayer.data.name} exhausted all energy reserves and dropped to the floor with debilitating muscle cramps.` },
          { type: 'EXHAUSTION MUSCLE FAILURE', desc: `${this.controlledPlayer.data.name} hit 0% stamina and suffered total neuromuscular exhaustion, unable to stand.` },
          { type: 'ACHILLES TENDINITIS FLARE-UP', desc: `${this.controlledPlayer.data.name} sprinted through severe fatigue and aggravated their Achilles tendon.` }
        ];
        const pick = fatigueInjuries[Math.floor(Math.random() * fatigueInjuries.length)];
        this.triggerInjury(this.controlledPlayer, pick.type, pick.desc);
        return;
      }

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

        // Physical Collision Detection & Heavy Collision Interaction
        const isSprinting = isTryingSprint && speedMult > 1.0;
        this.players.forEach(other => {
          if (other === this.controlledPlayer) return;
          const dist = this.controlledPlayer.position.distanceTo(other.position);
          const minDist = 0.62;
          if (dist < minDist && dist > 0.001) {
            // Elastic pushback so players don't interpenetrate
            const pushDir = new THREE.Vector3().subVectors(this.controlledPlayer.position, other.position);
            pushDir.y = 0;
            pushDir.normalize();
            const overlap = minDist - dist;
            this.controlledPlayer.position.addScaledVector(pushDir, overlap * 0.6);
            other.position.addScaledVector(pushDir, -overlap * 0.4);

            // Heavy Collision Interaction (High-velocity body contact)
            const isHeavyImpact = isSprinting || other.currentSpeed > 1.8;
            if (isHeavyImpact && this.collisionCooldownTimer <= 0 && !this.activeInjuryState && this.ballState !== 'INJURY_SUB') {
              this.collisionCooldownTimer = 2.0;
              sounds.playCollisionImpact();
              const contactPoint = this.controlledPlayer.position.clone().add(other.position).multiplyScalar(0.5);
              this.spawnFloatingStatus('HEAVY COLLISION!', contactPoint, '#ef4444');

              // 45% chance of triggering an injury on heavy collision interaction
              if (Math.random() < 0.45) {
                const injured = Math.random() < 0.65 ? this.controlledPlayer : other;
                const collisionInjuries = [
                  { type: 'LOWER BACK CONTUSION / HARD IMPACT', desc: `${injured.data.name} took a violent crash to the floor on a heavy body collision.` },
                  { type: 'CHEST / RIB CONTUSION', desc: `${injured.data.name} absorbed severe full-speed impact in a physical collision.` },
                  { type: 'ANKLE SPRAIN (AWKWARD LANDING / TRIPPED)', desc: `${injured.data.name} rolled their ankle during heavy traffic contact.` },
                  { type: 'HYPEREXTENDED KNEE / HARD IMPACT', desc: `${injured.data.name} suffered knee hyperextension during a severe full-speed collision.` },
                  { type: 'SHOULDER CONTUSION / STINGER', desc: `${injured.data.name} took a vicious blow to the shoulder in a physical collision.` }
                ];
                const injury = collisionInjuries[Math.floor(Math.random() * collisionInjuries.length)];
                setTimeout(() => {
                  if (!this.activeInjuryState && this.ballState !== 'INJURY_SUB') {
                    this.triggerInjury(injured, injury.type, injury.desc);
                  }
                }, 300);
              }
            }
          }
        });

        // Real-World NBA Driving Contact: Offensive Charge vs Defensive Blocking Foul
        if (
          this.ballHolder === this.controlledPlayer &&
          this.ballState === 'DRIBBLE' &&
          speedMult > 1.15 &&
          this.foulCooldownTimer <= 0
        ) {
          const nearestDef = this.getNearestDefender(this.controlledPlayer);
          if (nearestDef) {
            const dist = this.controlledPlayer.position.distanceTo(nearestDef.position);
            const hoopDist = new THREE.Vector2(
              this.gswHoopPos.x - nearestDef.position.x,
              this.gswHoopPos.z - nearestDef.position.z
            ).length();

            // Direct chest-to-chest collision outside restricted area
            if (dist < 0.62 && hoopDist > 1.3 && Math.random() < 0.30) {
              this.foulCooldownTimer = 7.0;
              // If defender is planted and not sprinting (speed < 0.6) -> Offensive Charge!
              if (nearestDef.currentSpeed < 0.6) {
                this.triggerFoul(nearestDef, this.controlledPlayer, 'CHARGING FOUL');
                if (Math.random() < 0.35 && !this.activeInjuryState) {
                  const injured = Math.random() < 0.65 ? this.controlledPlayer : nearestDef;
                  const injury = injured === this.controlledPlayer
                    ? { type: 'LOWER BACK CONTUSION / HARD IMPACT', desc: `${injured.data.name} took a violent crash to the floor on a charging collision.` }
                    : { type: 'CHEST / RIB CONTUSION', desc: `${injured.data.name} absorbed heavy full-speed body contact drawing the charge.` };
                  setTimeout(() => this.triggerInjury(injured, injury.type, injury.desc), 400);
                }
                return;
              } else {
                // Defender was sliding laterally or into the path -> Defensive Blocking Foul!
                this.triggerFoul(this.controlledPlayer, nearestDef, 'BLOCKING FOUL');
                if (Math.random() < 0.30 && !this.activeInjuryState) {
                  const injured = Math.random() < 0.5 ? this.controlledPlayer : nearestDef;
                  const injury = { type: 'ANKLE SPRAIN (AWKWARD LANDING)', desc: `${injured.data.name} rolled their ankle in heavy driving traffic contact.` };
                  setTimeout(() => this.triggerInjury(injured, injury.type, injury.desc), 400);
                }
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
      if (this.ballState === 'INJURY_SUB') {
        this.updateInjurySequence(dt);
        this.updateCamera(dt);
        this.updateVFX(dt);
        this.renderer.render(this.scene, this.camera);
        return;
      }

      if (this.ballState !== 'FREE_THROW') {
        this.shotClock = Math.max(0, this.shotClock - dt);
        this.gameClock = Math.max(0, this.gameClock - dt);
        this.onShotClockUpdate?.(Math.ceil(this.shotClock));
        if (this.foulCooldownTimer > 0) {
          this.foulCooldownTimer = Math.max(0, this.foulCooldownTimer - dt);
        }
        if (this.collisionCooldownTimer > 0) {
          this.collisionCooldownTimer = Math.max(0, this.collisionCooldownTimer - dt);
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
        if (this.shotHoldTime >= 1.25) {
          // Apex of jump reached: auto-release shot
          this.releaseShooting();
        } else {
          const progress = Math.min(1.15, this.shotHoldTime / 0.65);
          const isGreen = Math.abs(this.shotHoldTime - 0.65) < 0.055;
          this.onShotMeterUpdate?.({
            value: progress,
            isCharging: true,
            isGreen,
            isFrozen: false,
          });
        }
      }

      this.updatePlayerMovement(dt);
      this.updateHoustonAI(dt);
      this.updateGSWTeammatesAI(dt);
      this.updateBallPhysics(dt);
      this.checkOfficialNBARules(dt);

      // Keep 2K Floor Indicator Ring locked to the controlled player's feet
      if (this.controlledPlayer && this.playerFloorRing) {
        if (this.ballState === 'FREE_THROW') {
          this.playerFloorRing.visible = false;
        } else {
          this.playerFloorRing.visible = true;
          this.playerFloorRing.position.set(
            this.controlledPlayer.position.x,
            0.02,
            this.controlledPlayer.position.z
          );
          this.playerFloorRing.rotation.z = -this.controlledPlayer.rotation.y;
          const isGSW = this.controlledPlayer.data.team === 'GSW';
          (this.playerFloorRing.material as THREE.MeshBasicMaterial).color.setHex(isGSW ? 0xfdb927 : 0xce1141);
          if (this.playerFloorArrow) {
            (this.playerFloorArrow.material as THREE.MeshBasicMaterial).color.setHex(isGSW ? 0xfdb927 : 0xffffff);
          }
        }
      }

      // Hide overhead billboard during free throw, shot release, and shot charging so rim sightline is 100% clean
      if (this.nameplateSprite) {
        const hideNameplate =
          this.ballState === 'FREE_THROW' ||
          this.ballState === 'SHOT' ||
          this.ballState === 'REBOUND' ||
          this.isChargingShot;
        this.nameplateSprite.visible = !hideNameplate;
      }

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
  leftFootMesh: THREE.Mesh | THREE.Object3D;
  rightFootMesh: THREE.Mesh | THREE.Object3D;
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
  isInjured?: boolean;
  injuredAnimTimer?: number;
  injuryType?: string;
}
