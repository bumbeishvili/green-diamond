import * as THREE from 'three';
import { WORLD, settings } from '../config.js';
import { pointInPoly } from '../world/geom.js';

const PLAYER_SKIP = { pool: true }; // the pool edge only fences zombies

// The pharmacy's body armour: max health, and the share of each hit that still gets through.
export const ARMOUR = [
  { name: 'I', max: 125, take: 0.88, price: 1500 },
  { name: 'II', max: 150, take: 0.76, price: 3000 },
  { name: 'III', max: 175, take: 0.65, price: 5000 },
  { name: 'IV', max: 200, take: 0.55, price: 8000 },
];

// First-person controller: walking, sprinting, crouching, jumping, curb step-up,
// collision against the static world, head bob and view punch.
export class Player {
  constructor(camera, heightmap, colliders) {
    this.camera = camera;
    this.hm = heightmap;
    this.col = colliders;
    this.pos = new THREE.Vector3();   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.crouch = 0;           // 0..1 blend
    this.sprinting = false;
    this.moving = false;
    this.bob = 0;
    this.bobAmount = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.regenDelay = 0;
    this.dead = false;
    this.punch = new THREE.Vector2();      // recoil / hit view kick (radians)
    this.punchVel = new THREE.Vector2();
    this.shake = 0;
    this.tumble = 0;                       // thrown off a bike: no control, the view rolls, until you've landed and stopped
    this.armour = 0;                       // body armour level (the pharmacy): more health, less damage taken
    this.stepDist = 0;
    this.onStep = null;        // footstep callback(surface)
    this.speedMul = 1;
    this.ads = 0;
    this.fovBase = 72;
    this.bounds = null;        // play area polygon (x,z) for the invisible gate barriers
    this.pools = [];           // [{pts: [[x, y(map)]...], water}] set by the game
    this.inWater = false;
    this.roofs = [];           // [{pts, top}] flat roofs you can stand on (reachable by drone)
    this.vehicle = null;       // set while driving/flying; the vehicle then places the camera
    this.roof = null;          // the roof you're standing on (with its stairwell, if any)
    this.underground = null;   // the car parks under the courtyards (set by the game)
    this.parking = null;       // the one you're down in
    this.onFall = null;        // callback(damage) for a hard landing
    this.speedWeapon = 1;      // heavy guns slow you down, the knife speeds you up
    this.quiet = false;        // co-op: replaying ticks, no footsteps or landing thumps
  }

  roofObj(x, z) {
    for (const r of this.roofs) if (pointInPoly(x, -z, r.pts)) return r;
    return null;
  }

  roofAt(x, z) {
    const r = this.roofObj(x, z);
    return r ? r.top : -Infinity;
  }

  // ground under the feet: terrain, the car-park floor if we're down there, or a roof if we're up on one
  groundAt(x, z, y) {
    const u = this.underground && this.underground.at(x, z, y + 0.05);
    if (u) return u.floor;
    let g = this.sample(x, z, y);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g = Math.max(g, this.sample(x + Math.cos(a) * 0.18, z + Math.sin(a) * 0.18, y)); }
    const r = this.roofAt(x, z);
    return y >= r - 0.6 ? Math.max(g, r) : g;
  }

  sample(x, z, y) {
    const u = this.underground && this.underground.at(x, z, y + 0.05);
    return u ? u.floor : this.hm.atWorld(x, z);
  }

  // mouse look only (used while in a vehicle)
  look(input, allowControl) {
    if (!allowControl) return;
    const zoom = this.adsZoom ?? 0.22;
    const sens = 0.0021 * settings.sens * (1 - this.ads * Math.max(0.45, zoom));
    this.yaw -= input.mouse.dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouse.dy * sens, -1.45, 1.45);
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, this.hm.atWorld(x, z), z);
    this.viewY = this.pos.y;
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.dead = false;
  }

  get eyeHeight() { return THREE.MathUtils.lerp(WORLD.eyeHeight, WORLD.crouchEye, this.crouch); }

  update(dt, input, allowControl = true) {
    if (this.vehicle) {
      this.roof = null;
      this.look(input, allowControl);
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.regenDelay -= dt;
      if (!this.dead && this.regenDelay <= 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 22 * dt);
      return;
    }
    const zoom = this.adsZoom ?? 0.22;
    const sens = 0.0021 * settings.sens * (1 - this.ads * Math.max(0.45, zoom));
    if (allowControl) {
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    }

    // movement intent (none while you tumble through the air, or slide along the road after)
    const tumbling = this.tumble > 0.25;
    if (this.tumble > 0) this.tumble = Math.max(0, this.tumble - dt * (this.onGround ? 1.1 : 0.3));
    let fx = 0, fz = 0;
    if (allowControl && !this.dead && !tumbling) {
      if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) fz += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const wantCrouch = allowControl && (input.down('ControlLeft') || input.down('ControlRight'));   // (Ctrl, Mac or PC)
    this.crouch = THREE.MathUtils.damp(this.crouch, wantCrouch ? 1 : 0, 12, dt);
    this.sprinting = allowControl && input.down('ShiftLeft') && fz < 0 && this.crouch < 0.3 && this.ads < 0.3;
    this.inWater = this.pools.some((pl) => this.pos.y < pl.water - 0.3 && pointInPoly(this.pos.x, -this.pos.z, pl.pts));
    if (this.inWater) this.sprinting = false;
    const speed = (this.crouch > 0.5 ? WORLD.crouchSpeed : this.sprinting ? WORLD.sprintSpeed : WORLD.walkSpeed)
      * this.speedMul * this.speedWeapon * (1 - this.ads * 0.35) * (this.inWater ? 0.55 : 1);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos + fz * sin, wishZ = -fx * sin + fz * cos;
    const accel = this.onGround ? (tumbling ? 2.5 : 14) : (tumbling ? 0.25 : 3);
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wishX * speed, accel, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wishZ * speed, accel, dt);

    if (allowControl && this.onGround && input.hit('Space') && !this.dead) {
      // in the pool, a jump at the edge hauls you out onto the deck
      this.vel.y = this.inWater ? 8.6 : WORLD.jumpSpeed;
      this.onGround = false;
    }
    this.vel.y -= WORLD.gravity * dt;

    // horizontal move + collision (sub-stepped for fast motion)
    const steps = Math.ceil((Math.hypot(this.vel.x, this.vel.z) * dt) / 0.25) || 1;
    const p = { x: this.pos.x, z: this.pos.z };
    for (let i = 0; i < steps; i++) {
      const ox = p.x, oz = p.z;
      p.x += (this.vel.x * dt) / steps;
      p.z += (this.vel.z * dt) / steps;
      // curbs: refuse steps higher than maxStep
      const gNew = this.groundAt(p.x, p.z, this.pos.y);
      if (gNew - this.pos.y > WORLD.maxStep && this.onGround) { p.x = ox; p.z = oz; }
      this.col.resolve(p, WORLD.playerRadius, this.pos.y + 0.25, this.pos.y + this.eyeHeight + 0.1, 3, PLAYER_SKIP);
    }
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    this.pos.x = p.x;
    this.pos.z = p.z;

    // vertical
    const ground = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -7) this.shake = Math.min(1, this.shake + 0.25);
      if (!this.onGround && tumbling) { this.shake = 1; this.kick(-2.2, (Math.random() - 0.5) * 2); if (this.onLand && !this.quiet) this.onLand(); }
      // falling more than about two storeys hurts; off a 9-storey roof it kills
      if (!this.onGround && this.vel.y < -13 && !this.inWater) {
        const dmg = (-this.vel.y - 13) * 9;
        this.health -= dmg;
        this.regenDelay = 4;
        if (this.health <= 0) { this.health = 0; this.dead = true; }
        if (this.onFall && !this.quiet) this.onFall(dmg);
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.05) {
      this.onGround = false;
    }
    const r = this.roofObj(this.pos.x, this.pos.z);
    this.roof = r && this.pos.y > r.top - 0.4 ? r : null;
    // the car-park ceiling stops a jump
    this.parking = this.underground ? this.underground.at(this.pos.x, this.pos.z, this.pos.y + 0.05) : null;
    if (this.parking && this.pos.y + this.eyeHeight + 0.15 > this.parking.ceiling) {
      this.pos.y = this.parking.ceiling - this.eyeHeight - 0.15;
      if (this.vel.y > 0) this.vel.y = 0;
    }
    // the eye follows the feet with a little lag so curbs and steps don't pop
    this.viewY = this.onGround ? THREE.MathUtils.damp(this.viewY ?? this.pos.y, this.pos.y, 16, dt) : this.pos.y;

    // footsteps + head bob
    if (this.onGround && this.moving) {
      this.bob += moved * (this.sprinting ? 1.25 : 1.55);
      this.stepDist += moved;
      const stride = this.sprinting ? 2.1 : this.crouch > 0.5 ? 1.2 : 1.7;
      if (this.stepDist > stride) { this.stepDist = 0; if (this.onStep && !this.quiet) this.onStep(); }
    }
    this.bobAmount = THREE.MathUtils.damp(this.bobAmount, this.onGround && this.moving ? (this.sprinting ? 1.4 : 1) : 0, 8, dt);

    // view punch spring
    this.punchVel.x += (-this.punch.x * 120 - this.punchVel.x * 16) * dt;
    this.punchVel.y += (-this.punch.y * 120 - this.punchVel.y * 16) * dt;
    this.punch.x += this.punchVel.x * dt;
    this.punch.y += this.punchVel.y * dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    // health regen (CoD style)
    if (!this.dead) {
      this.regenDelay -= dt;
      if (this.regenDelay <= 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 22 * dt);
    }
    this.applyCamera();
  }

  // at: {x, y, z} to put the eye somewhere else than the feet (co-op: between two ticks)
  applyCamera(at = null) {
    // (co-op: down on the ground until you're back)
    const eye = this.dead ? 0.32 : this.eyeHeight;
    const bobY = Math.abs(Math.sin(this.bob * Math.PI)) * 0.055 * this.bobAmount * (1 - this.ads * 0.8);
    const bobX = Math.cos(this.bob * Math.PI) * 0.035 * this.bobAmount * (1 - this.ads * 0.8);
    const sh = this.shake * this.shake;
    const t = performance.now() / 1000;
    const sx = (Math.sin(t * 43) + Math.sin(t * 71)) * 0.01 * sh, sy = (Math.cos(t * 37) + Math.sin(t * 59)) * 0.01 * sh;
    if (at) this.camera.position.set(at.x, at.y + eye + bobY, at.z);
    else this.camera.position.set(this.pos.x, (this.viewY ?? this.pos.y) + eye + bobY, this.pos.z);
    this.camera.position.x += Math.cos(this.yaw) * bobX;
    this.camera.position.z -= Math.sin(this.yaw) * bobX;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.punch.y + sx;
    this.camera.rotation.x = this.pitch + this.punch.x + sy;
    // (thrown: the world turns over as you go)
    const tb = this.tumble * this.tumble;
    this.camera.rotation.z = this.dead ? 0.45 : -bobX * 0.4 + tb * 0.95 * Math.sin(t * 5.5);
    if (tb > 0) this.camera.rotation.x += tb * 0.4 * Math.sin(t * 3.7);
    const fov = this.fovBase * (1 - this.ads * (this.adsZoom ?? 0.22)) * (this.sprinting ? 1.05 : 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 0.25);
      this.camera.updateProjectionMatrix();
    }
  }

  // Which way you face on the map: driving a car or riding a bike, the way it points (your own
  // yaw is held at zero in there, so you get out facing forward).
  get mapYaw() {
    const v = this.vehicle;
    return v && v.type !== 'drone' ? v.heading - Math.PI / 2 + (v.fwdSign < 0 ? Math.PI : 0) : this.yaw;
  }

  kick(pitch, yaw) {
    this.punchVel.x += pitch;
    this.punchVel.y += yaw;
  }

  // Body armour, level 0..4: every level more health and less of every hit.
  setArmour(level) {
    this.armour = Math.max(0, Math.min(ARMOUR.length, level));
    this.maxHealth = this.armour ? ARMOUR[this.armour - 1].max : 100;
    this.health = this.maxHealth;
  }
  get armourTake() { return this.armour ? ARMOUR[this.armour - 1].take : 1; }

  damage(amount, fromX, fromZ) {
    if (this.dead) return false;
    amount *= this.armourTake;
    this.health -= amount;
    this.regenDelay = 4.0;
    this.shake = Math.min(1, this.shake + 0.35);
    const ang = Math.atan2(fromX - this.pos.x, fromZ - this.pos.z);
    this.kick(-1.2, Math.sin(ang - this.yaw) * 1.2);
    if (this.health <= 0) { this.health = 0; this.dead = true; }
    return true;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyEuler(this.camera.rotation);
  }
}
