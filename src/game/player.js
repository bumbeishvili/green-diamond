import * as THREE from 'three';
import { WORLD, settings } from '../config.js';
import { pointInPoly } from '../world/geom.js';

const PLAYER_SKIP = { pool: true }; // the pool edge only fences zombies

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
    this.stepDist = 0;
    this.onStep = null;        // footstep callback(surface)
    this.speedMul = 1;
    this.ads = 0;
    this.fovBase = 72;
    this.bounds = null;        // play area polygon (x,z) for the invisible gate barriers
    this.pools = [];           // [{pts: [[x, y(map)]...], water}] set by the game
    this.inWater = false;
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
    const zoom = this.adsZoom ?? 0.22;
    const sens = 0.0021 * settings.sens * (1 - this.ads * Math.max(0.45, zoom));
    if (allowControl) {
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    }

    // movement intent
    let fx = 0, fz = 0;
    if (allowControl && !this.dead) {
      if (input.down('KeyW') || input.down('ArrowUp')) fz -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) fz += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const wantCrouch = allowControl && input.down('KeyC');
    this.crouch = THREE.MathUtils.damp(this.crouch, wantCrouch ? 1 : 0, 12, dt);
    this.sprinting = allowControl && input.down('ShiftLeft') && fz < 0 && this.crouch < 0.3 && this.ads < 0.3;
    this.inWater = this.pools.some((pl) => this.pos.y < pl.water - 0.3 && pointInPoly(this.pos.x, -this.pos.z, pl.pts));
    if (this.inWater) this.sprinting = false;
    const speed = (this.crouch > 0.5 ? WORLD.crouchSpeed : this.sprinting ? WORLD.sprintSpeed : WORLD.walkSpeed)
      * this.speedMul * (1 - this.ads * 0.35) * (this.inWater ? 0.55 : 1);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos + fz * sin, wishZ = -fx * sin + fz * cos;
    const accel = this.onGround ? 14 : 3;
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
      const gNew = this.hm.maxAround(p.x, -p.z, 0.2);
      if (gNew - this.pos.y > WORLD.maxStep && this.onGround) { p.x = ox; p.z = oz; }
      this.col.resolve(p, WORLD.playerRadius, this.pos.y + 0.25, this.pos.y + this.eyeHeight + 0.1, 3, PLAYER_SKIP);
    }
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    this.pos.x = p.x;
    this.pos.z = p.z;

    // vertical
    const ground = this.hm.maxAround(this.pos.x, -this.pos.z, 0.18);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -7) this.shake = Math.min(1, this.shake + 0.25);
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.05) {
      this.onGround = false;
    }
    // the eye follows the feet with a little lag so curbs and steps don't pop
    this.viewY = this.onGround ? THREE.MathUtils.damp(this.viewY ?? this.pos.y, this.pos.y, 16, dt) : this.pos.y;

    // footsteps + head bob
    if (this.onGround && this.moving) {
      this.bob += moved * (this.sprinting ? 1.25 : 1.55);
      this.stepDist += moved;
      const stride = this.sprinting ? 2.1 : this.crouch > 0.5 ? 1.2 : 1.7;
      if (this.stepDist > stride) { this.stepDist = 0; if (this.onStep) this.onStep(); }
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

  applyCamera() {
    const eye = this.eyeHeight;
    const bobY = Math.abs(Math.sin(this.bob * Math.PI)) * 0.055 * this.bobAmount * (1 - this.ads * 0.8);
    const bobX = Math.cos(this.bob * Math.PI) * 0.035 * this.bobAmount * (1 - this.ads * 0.8);
    const sh = this.shake * this.shake;
    const t = performance.now() / 1000;
    const sx = (Math.sin(t * 43) + Math.sin(t * 71)) * 0.01 * sh, sy = (Math.cos(t * 37) + Math.sin(t * 59)) * 0.01 * sh;
    this.camera.position.set(this.pos.x, (this.viewY ?? this.pos.y) + eye + bobY, this.pos.z);
    this.camera.position.x += Math.cos(this.yaw) * bobX;
    this.camera.position.z -= Math.sin(this.yaw) * bobX;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.punch.y + sx;
    this.camera.rotation.x = this.pitch + this.punch.x + sy;
    this.camera.rotation.z = -bobX * 0.4;
    const fov = this.fovBase * (1 - this.ads * (this.adsZoom ?? 0.22)) * (this.sprinting ? 1.05 : 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 0.25);
      this.camera.updateProjectionMatrix();
    }
  }

  kick(pitch, yaw) {
    this.punchVel.x += pitch;
    this.punchVel.y += yaw;
  }

  damage(amount, fromX, fromZ) {
    if (this.dead) return false;
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
