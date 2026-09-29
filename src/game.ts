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

export type BallState = 'DRIBBLE' | 'SHOT' | 'PASS' | 'BOUNCE_PASS' | 'FREE';

export class BasketballGame {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Real scale constants (meters)
  private readonly GRAVITY = -18.5; // Tuned for realistic basketball arc
  private readonly RIM_HEIGHT = 3.05; // 10 ft
  private readonly RIM_RADIUS = 0.23; // 0.75 ft
  private readonly RIM_TUBE_RADIUS = 0.02;
  private readonly BALL_RADIUS = 0.12; // 0.39 ft

  // Scores & Clocks
  private homeScore = 10;
  private awayScore = 8;
  private shotClock = 24.0;
  private gameClock = 720.0;
  private isGameOver = false;

  // Ball physics state
  private ball!: THREE.Mesh;
  private ballPos = new THREE.Vector3(0, 0.95, 0);
  private ballVel = new THREE.Vector3(0, 0, 0);
  private ballState: BallState = 'DRIBBLE';
  private floorBounceCount = 0;
  private isBallRolling = false;

  // Possession & Pass Tracking
  private ballHolder: PlayerMesh | null = null;
  private passTargetPlayer: PlayerMesh | null = null;
  private passReceiverPosLead = new THREE.Vector3();
  private inboundTimer = 0;
  private nextPossessionTeam: 'GSW' | 'HOU' | null = null;

  // Active Shot Metadata
  private activeShotMeta: {
    isGreen: boolean;
    points: number;
    shooterTeam: 'GSW' | 'HOU';
    hoopPos: THREE.Vector3;
    rimZ: number;
    hasScored: boolean;
  } | null = null;

  // Hoops & Nets
  private gswHoopPos = new THREE.Vector3(0, 3.05, -13.0); // Houston defends
  private houHoopPos = new THREE.Vector3(0, 3.05, 13.0);  // GSW defends
  private gswNetMesh!: THREE.Mesh;
  private houNetMesh!: THREE.Mesh;
  private gswNetWobble = 0;
  private houNetWobble = 0;

  // Teams & Players
  private players: PlayerMesh[] = [];
  private controlledPlayer!: PlayerMesh;

  // Single Global Nameplate
  private nameplateSprite!: THREE.Sprite;
  private nameplateCanvas!: HTMLCanvasElement;
  private nameplateContext!: CanvasRenderingContext2D;

  // Visual FX
  private floatingTexts: { sprite: THREE.Sprite; lifetime: number; maxLife: number }[] = [];
  private confettiParticles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  // Dribble State
  private dribbleCycle = 0;

  // AI Timers
  private aiDecisionTimer = 0;
  private aiPassTimer = 0;

  // Controls
  private keys: { [key: string]: boolean } = {};
  private shotHoldTime = 0;
  private isChargingShot = false;

  // UI Callbacks
  public onScoreUpdate?: (home: number, away: number, points: number, team: string) => void;
  public onShotMeterUpdate?: (value: number, isOpen: boolean) => void;
  public onShotReleased?: (quality: string, isGreen: boolean) => void;
  public onShotClockUpdate?: (seconds: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene setup
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

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Initializations
    this.setupLighting();
    this.createCourt();
    this.createHoopsAndNets();
    this.createBall();
    this.createSingleNameplate();
    this.spawnTeams();

    // Default possession: Curry starts with ball
    this.ballHolder = this.controlledPlayer;
    this.ballState = 'DRIBBLE';

    // Event listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Run game loop
    this.animate(0);
  }

  // ----------------------------------------------------
  // LIGHTING & COURT
  // ----------------------------------------------------
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
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x7fb2ff, 0.35);
    rimLight.position.set(-16, 20, -16);
    this.scene.add(rimLight);
  }

  private createCourt() {
    // Hardwood Floor
    const courtGeo = new THREE.PlaneGeometry(15.24, 28.65);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0xc8965a,
      roughness: 0.38,
      metalness: 0.08,
    });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    this.scene.add(court);

    // Court Boundary & Lines
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

    // 3-point lines
    [-13.0, 13.0].forEach(zCenter => {
      const arcPoints = new THREE.Path().absarc(0, 0, 6.75, 0, Math.PI, zCenter > 0).getPoints(36);
      const threePtGeo = new THREE.BufferGeometry().setFromPoints(
        arcPoints.map(p => new THREE.Vector3(p.x, 0.01, zCenter + (zCenter > 0 ? -p.y : p.y)))
      );
      this.scene.add(new THREE.Line(threePtGeo, lineMat));
    });
  }

  private createHoopsAndNets() {
    const buildHoop = (zPos: number, isAway: boolean) => {
      const hoopGroup = new THREE.Group();
      hoopGroup.position.set(0, 0, zPos);
      if (isAway) hoopGroup.rotation.y = Math.PI;

      // Pole
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e2430 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 1.9, 1.25);
      hoopGroup.add(pole);

      // Backboard (1.8m x 1.05m at z = 0.4 relative to hoop)
      const bbGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
      const bbMat = new THREE.MeshStandardMaterial({
        color: 0xf5f8fa,
        roughness: 0.15,
        metalness: 0.1,
      });
      const bb = new THREE.Mesh(bbGeo, bbMat);
      bb.position.set(0, 3.3, 0.4);
      bb.castShadow = true;
      hoopGroup.add(bb);

      // Backboard Inner Target Box
      const targetBoxGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.29, 3.1, 0.37),
        new THREE.Vector3(0.29, 3.1, 0.37),
        new THREE.Vector3(0.29, 3.55, 0.37),
        new THREE.Vector3(-0.29, 3.55, 0.37),
        new THREE.Vector3(-0.29, 3.1, 0.37),
      ]);
      const targetBox = new THREE.Line(targetBoxGeo, new THREE.LineBasicMaterial({ color: 0xce1141, linewidth: 2 }));
      hoopGroup.add(targetBox);

      // Torus Rim
      const rimGeo = new THREE.TorusGeometry(this.RIM_RADIUS, this.RIM_TUBE_RADIUS, 12, 32);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xee4b2b, roughness: 0.3, metalness: 0.2 });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, this.RIM_HEIGHT, 0);
      rim.castShadow = true;
      hoopGroup.add(rim);

      // Net (Cylinder with open ends)
      const netGeo = new THREE.CylinderGeometry(this.RIM_RADIUS * 0.96, this.RIM_RADIUS * 0.58, 0.48, 16, 3, true);
      const netMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        wireframe: true,
        roughness: 0.8,
        transparent: true,
        opacity: 0.85,
      });
      const net = new THREE.Mesh(netGeo, netMat);
      net.position.set(0, this.RIM_HEIGHT - 0.24, 0);
      hoopGroup.add(net);

      this.scene.add(hoopGroup);
      return net;
    };

    this.gswNetMesh = buildHoop(-13.0, false);
    this.houNetMesh = buildHoop(13.0, true);
  }

  // ----------------------------------------------------
  // (1) 3D BALL WITH BACKSPIN & ROLLING
  // ----------------------------------------------------
  private createBall() {
    const ballGeo = new THREE.SphereGeometry(this.BALL_RADIUS, 28, 28);
    
    // Ball texture with seam ribbing
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

    ctx.fillStyle = player.data.team === 'GSW' ? 'rgba(0, 83, 188, 0.88)' : 'rgba(206, 17, 65, 0.88)';
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

  // ----------------------------------------------------
  // PLAYERS CREATION WITH LEGS/ARMS PIVOTS
  // ----------------------------------------------------
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

    // Legs with Hip Pivots
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

    // Arms with Shoulder Pivots
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

  // ----------------------------------------------------
  // CONTROLS & INPUT
  // ----------------------------------------------------
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

  // ----------------------------------------------------
  // (2) SHOT TRAJECTORIES & BALLISTIC LAUNCH CALCULATION
  // ----------------------------------------------------
  private executeShot(shooter: PlayerMesh, holdDuration: number) {
    if (this.ballHolder !== shooter) return;

    // Release possession to ballistic simulation
    this.ballHolder = null;
    this.ballState = 'SHOT';
    this.floorBounceCount = 0;
    this.isBallRolling = false;

    // Hoop and distance
    const targetHoop = shooter.data.team === 'GSW' ? this.gswHoopPos : this.houHoopPos;
    const rimZ = targetHoop.z;
    const toHoopFlat = new THREE.Vector2(targetHoop.x - shooter.position.x, targetHoop.z - shooter.position.z);
    const distToHoop = toHoopFlat.length();
    const isThree = distToHoop > 6.75;
    const points = isThree ? 3 : 2;

    // Shot timing evaluation (Ideal: 0.65s)
    const ideal = 0.65;
    const diff = Math.abs(holdDuration - ideal);
    const isGreen = diff < 0.05; // Perfect Green Release

    // Defender contest
    const defender = this.getNearestDefender(shooter);
    const defDist = defender ? defender.position.distanceTo(shooter.position) : 99;
    const isContested = defDist < 1.8;

    // Determine trajectory target point based on timing/contest
    const shotDir = new THREE.Vector3(targetHoop.x - shooter.position.x, 0, targetHoop.z - shooter.position.z).normalize();
    const sideDir = new THREE.Vector3(-shotDir.z, 0, shotDir.x); // Perpendicular horizontal

    const targetPoint = new THREE.Vector3(targetHoop.x, this.RIM_HEIGHT, rimZ);
    let quality = 'LATE';

    if (isGreen) {
      // 100% Guaranteed Make: Clean swish right down the center
      quality = 'GREEN RELEASE! PERFECT';
      // target is exact center: targetPoint remains (0, 3.05, rimZ)
    } else if (diff < 0.12 && !isContested) {
      // High chance make or slight rim rattle
      const makeChance = (isThree ? shooter.data.threePointRating : shooter.data.midRangeRating) / 100 * 0.85;
      if (Math.random() < makeChance) {
        quality = 'SLIGHTLY EARLY / LATE (GOOD)';
        targetPoint.addScaledVector(shotDir, (Math.random() - 0.5) * 0.06);
      } else {
        // Miss: slightly early hits front rim, slightly late hits back rim
        quality = holdDuration < ideal ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE';
        const rimOffset = holdDuration < ideal ? -this.RIM_RADIUS * 0.95 : this.RIM_RADIUS * 0.95;
        targetPoint.addScaledVector(shotDir, rimOffset);
      }
    } else if (isContested) {
      // Contested: miss off the side rim or front lip
      quality = 'CONTESTED';
      const sideOffset = (Math.random() > 0.5 ? 1 : -1) * this.RIM_RADIUS * 0.9;
      targetPoint.addScaledVector(sideDir, sideOffset);
      targetPoint.addScaledVector(shotDir, -this.RIM_RADIUS * 0.5);
    } else {
      // Poor timing: front-rim short or back-rim long miss
      quality = holdDuration < ideal ? 'VERY EARLY' : 'VERY LATE';
      const rimOffset = holdDuration < ideal ? -this.RIM_RADIUS * 1.05 : this.RIM_RADIUS * 1.05;
      targetPoint.addScaledVector(shotDir, rimOffset);
      targetPoint.addScaledVector(sideDir, (Math.random() - 0.5) * 0.18);
    }

    if (shooter === this.controlledPlayer) {
      this.onShotReleased?.(quality, isGreen);
    }

    // Launch position (shooter hand height)
    this.ballPos.set(shooter.position.x, 2.05, shooter.position.z).addScaledVector(shotDir, 0.25);
    this.ball.position.copy(this.ballPos);

    // Calculate exact ballistic launch velocity under gravity:
    // T = Flight time (~0.95s to 1.15s depending on distance)
    const flightDuration = Math.max(0.92, Math.min(1.2, 0.85 + distToHoop * 0.038));
    
    // v_xz = delta_xz / T
    const deltaXZ = new THREE.Vector3(targetPoint.x - this.ballPos.x, 0, targetPoint.z - this.ballPos.z);
    this.ballVel.x = deltaXZ.x / flightDuration;
    this.ballVel.z = deltaXZ.z / flightDuration;

    // delta_y = v_y * T + 0.5 * g * T^2 => v_y = (delta_y - 0.5 * g * T^2) / T
    const deltaY = targetPoint.y - this.ballPos.y;
    this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * flightDuration * flightDuration) / flightDuration;

    // Store shot metadata
    this.activeShotMeta = {
      isGreen,
      points,
      shooterTeam: shooter.data.team,
      hoopPos: targetHoop.clone(),
      rimZ,
      hasScored: false,
    };
  }

  // ----------------------------------------------------
  // (7) PASSES & BOUNCE-PASS VARIANT
  // ----------------------------------------------------
  private initiatePass(passer: PlayerMesh) {
    const teammates = this.players.filter(p => p.data.team === passer.data.team && p !== passer);
    if (teammates.length === 0) return;

    // Find best open teammate
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

    // Distance and flight time (0.4s to 0.65s)
    const passDist = passer.position.distanceTo(receiver.position);
    const passTime = THREE.MathUtils.clamp(0.38 + passDist * 0.032, 0.42, 0.65);

    // Lead the receiver slightly based on receiver movement
    const recvVel = new THREE.Vector3().subVectors(receiver.position, receiver.lastPos).multiplyScalar(60);
    this.passReceiverPosLead.copy(receiver.position).addScaledVector(recvVel, passTime * 0.4);

    // Randomly choose bounce-pass for mid-distance (35% probability if > 4m)
    const isBouncePass = passDist > 3.8 && Math.random() < 0.35;
    this.ballState = isBouncePass ? 'BOUNCE_PASS' : 'PASS';

    // Start position (chest height)
    const forward = new THREE.Vector3().subVectors(this.passReceiverPosLead, passer.position).normalize();
    this.ballPos.set(passer.position.x, 1.25, passer.position.z).addScaledVector(forward, 0.35);
    this.ball.position.copy(this.ballPos);

    if (!isBouncePass) {
      // Direct pass with slight natural arc
      const targetPos = this.passReceiverPosLead.clone().setY(1.2);
      this.ballVel.x = (targetPos.x - this.ballPos.x) / passTime;
      this.ballVel.z = (targetPos.z - this.ballPos.z) / passTime;
      const deltaY = targetPos.y - this.ballPos.y;
      this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * passTime * passTime) / passTime;
    } else {
      // Bounce pass: hits floor at ~55% of distance, bounces to waist height
      const bounceSpot = new THREE.Vector3().lerpVectors(this.ballPos, this.passReceiverPosLead, 0.55);
      bounceSpot.y = this.BALL_RADIUS;
      const firstLegTime = passTime * 0.55;

      this.ballVel.x = (bounceSpot.x - this.ballPos.x) / firstLegTime;
      this.ballVel.z = (bounceSpot.z - this.ballPos.z) / firstLegTime;
      const deltaY = bounceSpot.y - this.ballPos.y;
      this.ballVel.y = (deltaY - 0.5 * this.GRAVITY * firstLegTime * firstLegTime) / firstLegTime;
    }
  }

  // ----------------------------------------------------
  // (3), (4), (5), (6) BALLISTIC INTEGRATION & COLLISIONS
  // ----------------------------------------------------
  private updateBallPhysics(dt: number) {
    // 1. DRIBBLE STATE
    if (this.ballState === 'DRIBBLE' && this.ballHolder) {
      const holder = this.ballHolder;
      this.dribbleCycle += dt * 14.0; // ~2.2 bounces per second

      // Player forward & right vectors
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(holder.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(holder.quaternion);

      // Bounce between hand (0.95m) and floor (BALL_RADIUS)
      const bounceNorm = Math.abs(Math.sin(this.dribbleCycle));
      const handY = 0.95;
      const dribbleY = this.BALL_RADIUS + (handY - this.BALL_RADIUS) * Math.pow(bounceNorm, 1.4);

      // Position slightly to side and ahead
      const offset = right.clone().multiplyScalar(0.38).add(forward.clone().multiplyScalar(0.22));
      this.ballPos.copy(holder.position).add(offset);
      this.ballPos.y = dribbleY;
      this.ball.position.copy(this.ballPos);

      // Spin ball while dribbling
      this.ball.rotation.x += dt * 8;
      return;
    }

    // 2. BALLISTIC INTEGRATION: v = v + g*dt, p = p + v*dt
    if (!this.isBallRolling) {
      this.ballVel.y += this.GRAVITY * dt;
    }

    this.ballPos.addScaledVector(this.ballVel, dt);

    // 3. (5) ROTATIONAL SPIN
    if (this.ballState === 'SHOT') {
      // 2 full backspin rotations per second during shot flight
      const horizVel = new THREE.Vector2(this.ballVel.x, this.ballVel.z);
      if (horizVel.length() > 0.05) {
        const shotAngle = Math.atan2(this.ballVel.x, this.ballVel.z);
        this.ball.rotation.x -= dt * (Math.PI * 4); // Backspin
        this.ball.rotation.y = shotAngle;
      }
    } else if (this.isBallRolling) {
      // Rolling forward on the floor around transverse horizontal axis
      const speed = new THREE.Vector2(this.ballVel.x, this.ballVel.z).length();
      if (speed > 0.01) {
        const rollRate = speed / this.BALL_RADIUS;
        this.ball.rotation.x += rollRate * dt;
      }
    }

    // 4. (3) RIM & BACKBOARD COLLISIONS
    this.checkHoopCollisions();

    // 5. (6) MADE BASKET DETECTION
    this.checkMadeBasket();

    // 6. (4) FLOOR BOUNCING & ROLLING TRANSITION
    if (this.ballPos.y <= this.BALL_RADIUS) {
      this.ballPos.y = this.BALL_RADIUS;

      if (Math.abs(this.ballVel.y) > 0.45 && this.floorBounceCount < 5) {
        // Restitution ~0.78 on bounce
        this.ballVel.y = -this.ballVel.y * 0.78;
        // Reduce horizontal velocity by 20% per bounce
        this.ballVel.x *= 0.80;
        this.ballVel.z *= 0.80;
        this.floorBounceCount++;
      } else {
        // Transition to rolling with kinetic friction
        this.ballVel.y = 0;
        this.isBallRolling = true;
        this.ballVel.x *= Math.max(0, 1 - 2.8 * dt);
        this.ballVel.z *= Math.max(0, 1 - 2.8 * dt);

        if (this.ballVel.lengthSq() < 0.005) {
          this.ballVel.set(0, 0, 0);
        }
      }
    }

    // 7. (7) PASS CATCHING (Ball can only be caught when it actually reaches receiver)
    if ((this.ballState === 'PASS' || this.ballState === 'BOUNCE_PASS') && this.passTargetPlayer) {
      const distToReceiver = this.ballPos.distanceTo(this.passTargetPlayer.position);
      if (distToReceiver < 0.75 && this.ballPos.y > 0.4) {
        // Caught cleanly by receiver
        this.ballHolder = this.passTargetPlayer;
        this.ballState = 'DRIBBLE';
        this.passTargetPlayer = null;
        if (this.ballHolder.data.team === 'GSW') {
          this.controlledPlayer = this.ballHolder;
          this.updateControlledNameplate(this.controlledPlayer);
        }
      }
    }

    // 8. Sync 3D Mesh
    this.ball.position.copy(this.ballPos);

    // Inbound handling after made basket
    if (this.nextPossessionTeam && this.ballPos.y <= this.BALL_RADIUS + 0.05) {
      this.inboundTimer += dt;
      if (this.inboundTimer > 1.4) {
        this.executeInbound(this.nextPossessionTeam);
        this.nextPossessionTeam = null;
        this.inboundTimer = 0;
      }
    }
  }

  // ----------------------------------------------------
  // (3) RIM TORUS & BACKBOARD COLLISION LOGIC
  // ----------------------------------------------------
  private checkHoopCollisions() {
    const hoops = [this.gswHoopPos, this.houHoopPos];

    hoops.forEach(hoop => {
      // 1. Backboard collision
      const isGSW = hoop.z < 0;
      const bbZ = isGSW ? hoop.z - 0.4 : hoop.z + 0.4;
      const bbXMin = -0.9, bbXMax = 0.9;
      const bbYMin = 2.75, bbYMax = 3.85;

      const nearBBZ = Math.abs(this.ballPos.z - bbZ) < (this.BALL_RADIUS + 0.03);
      const insideBBX = this.ballPos.x >= bbXMin && this.ballPos.x <= bbXMax;
      const insideBBY = this.ballPos.y >= bbYMin && this.ballPos.y <= bbYMax;

      if (nearBBZ && insideBBX && insideBBY) {
        // Bounce off backboard with restitution ~0.70
        this.ballVel.z = -this.ballVel.z * 0.70;
        this.ballVel.x *= 0.88;
        this.ballVel.y *= 0.88;
        this.ballPos.z = bbZ + (isGSW ? (this.BALL_RADIUS + 0.035) : -(this.BALL_RADIUS + 0.035));
        return;
      }

      // 2. Torus Rim collision
      const toHoopX = this.ballPos.x - hoop.x;
      const toHoopZ = this.ballPos.z - hoop.z;
      const distToHoopXZ = Math.sqrt(toHoopX * toHoopX + toHoopZ * toHoopZ);

      // Nearest point on circular ring tube
      if (distToHoopXZ > 0.001) {
        const ringPointX = hoop.x + (toHoopX / distToHoopXZ) * this.RIM_RADIUS;
        const ringPointY = this.RIM_HEIGHT;
        const ringPointZ = hoop.z + (toHoopZ / distToHoopXZ) * this.RIM_RADIUS;

        const distToRing = Math.hypot(
          this.ballPos.x - ringPointX,
          this.ballPos.y - ringPointY,
          this.ballPos.z - ringPointZ
        );

        const contactThreshold = this.BALL_RADIUS + this.RIM_TUBE_RADIUS;
        if (distToRing < contactThreshold) {
          // Normal vector pointing from rim tube to ball center
          const normal = new THREE.Vector3(
            (this.ballPos.x - ringPointX) / distToRing,
            (this.ballPos.y - ringPointY) / distToRing,
            (this.ballPos.z - ringPointZ) / distToRing
          );

          // Dot product: only bounce if moving toward rim tube
          const dot = this.ballVel.dot(normal);
          if (dot < 0) {
            // Restitution ~0.62 with slight variance for authentic rattle
            const restitution = 0.62;
            this.ballVel.subScaledVector(normal, (1 + restitution) * dot);

            // Add slight bounce variance for rim rattle
            this.ballVel.x += (Math.random() - 0.5) * 0.35;
            this.ballVel.z += (Math.random() - 0.5) * 0.35;

            // Push ball outside collision volume
            this.ballPos.set(
              ringPointX + normal.x * (contactThreshold + 0.006),
              ringPointY + normal.y * (contactThreshold + 0.006),
              ringPointZ + normal.z * (contactThreshold + 0.006)
            );
          }
        }
      }
    });
  }

  // ----------------------------------------------------
  // (6) MADE BASKET DETECTION & NET WOBBLE ANIMATION
  // ----------------------------------------------------
  private checkMadeBasket() {
    if (!this.activeShotMeta || this.activeShotMeta.hasScored) return;

    const meta = this.activeShotMeta;
    const hoop = meta.hoopPos;
    const distToHoopXZ = Math.hypot(this.ballPos.x - hoop.x, this.ballPos.z - hoop.z);

    // Ball passes downward through rim cylinder
    const isPassingDown = this.ballVel.y < -0.1;
    const withinRimRadius = distToHoopXZ < (this.RIM_RADIUS - 0.04);
    const atRimLevel = this.ballPos.y <= this.RIM_HEIGHT && this.ballPos.y >= (this.RIM_HEIGHT - 0.32);

    if (isPassingDown && withinRimRadius && atRimLevel) {
      meta.hasScored = true;

      // 1. Decelerate slightly through net with small forward drift
      this.ballVel.y *= 0.72;
      this.ballVel.x *= 0.65;
      const forwardDrift = meta.shooterTeam === 'GSW' ? -0.4 : 0.4;
      this.ballVel.z = this.ballVel.z * 0.65 + forwardDrift;

      // 2. Trigger net animation
      if (meta.hoopPos.z < 0) {
        this.gswNetWobble = 0.35;
      } else {
        this.houNetWobble = 0.35;
      }

      // 3. Update scores & notify UI
      if (meta.shooterTeam === 'GSW') {
        this.homeScore += meta.points;
      } else {
        this.awayScore += meta.points;
      }
      this.onScoreUpdate?.(this.homeScore, this.awayScore, meta.points, meta.shooterTeam);

      // 4. Floating +2 / +3 text
      this.spawnFloatingScore(meta.points, hoop);

      // 5. Small confetti burst ONLY for green releases
      if (meta.isGreen) {
        this.spawnGreenConfetti(hoop);
      }

      // 6. Queue inbound after ball drops and bounces
      this.nextPossessionTeam = meta.shooterTeam === 'GSW' ? 'HOU' : 'GSW';
      this.shotClock = 24.0;
    }
  }

  private updateNetAnimation(dt: number) {
    if (this.gswNetWobble > 0) {
      this.gswNetWobble = Math.max(0, this.gswNetWobble - dt);
      const wobble = Math.sin(this.gswNetWobble * 28) * (this.gswNetWobble / 0.35) * 0.28;
      this.gswNetMesh.scale.set(1 + wobble, 1 - wobble * 0.5, 1 + wobble);
    } else {
      this.gswNetMesh.scale.set(1, 1, 1);
    }

    if (this.houNetWobble > 0) {
      this.houNetWobble = Math.max(0, this.houNetWobble - dt);
      const wobble = Math.sin(this.houNetWobble * 28) * (this.houNetWobble / 0.35) * 0.28;
      this.houNetMesh.scale.set(1 + wobble, 1 - wobble * 0.5, 1 + wobble);
    } else {
      this.houNetMesh.scale.set(1, 1, 1);
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
    this.activeShotMeta = null;

    if (team === 'GSW') {
      this.controlledPlayer = inbounder;
      this.updateControlledNameplate(this.controlledPlayer);
    }
  }

  // ----------------------------------------------------
  // VISUAL FX: FLOATING SCORE & GREEN CONFETTI
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

  // ----------------------------------------------------
  // HOUSTON ACTIVE AI & MAN-TO-MAN DEFENSE
  // ----------------------------------------------------
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

      // Dribble toward scoring range
      if (distToRim > 5.5) {
        toRim.normalize();
        carrier.position.addScaledVector(toRim, carrier.data.speed * 0.75 * dt);
        carrier.lookAt(targetRim.x, carrier.position.y, targetRim.z);
      }

      const defender = this.getNearestDefender(carrier);
      const defDist = defender ? defender.position.distanceTo(carrier.position) : 99;

      // Pass between teammates if contested or possession flows
      if (this.aiPassTimer > 3.2 || (defDist < 1.7 && this.aiDecisionTimer > 1.2)) {
        this.aiPassTimer = 0;
        this.initiatePass(carrier);
      }

      // Shoot when open or when shot clock drops below 4s
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

  // ----------------------------------------------------
  // RUNNING ANIMATIONS & MAIN GAME LOOP
  // ----------------------------------------------------
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

    // Leg & arm swinging animation
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

    // Update single active nameplate position
    if (this.controlledPlayer && this.nameplateSprite) {
      this.nameplateSprite.position.set(
        this.controlledPlayer.position.x,
        this.controlledPlayer.position.y + 2.55,
        this.controlledPlayer.position.z
      );
    }
  }

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
