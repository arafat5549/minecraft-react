import * as THREE from 'three';

const GRAVITY = 26;
const JUMP_SPEED = 9;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 7.2;
const FLY_SPEED = 11;
const TERMINAL_VELOCITY = -55;

export class Player {
  constructor(x, y, z) {
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.halfWidth = 0.3;
    this.height = 1.8;
    this.eyeHeight = 1.62;
  }

  get eyePosition() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeHeight,
      this.position.z,
    );
  }

  _collides(world, offsetY = 0) {
    const minX = Math.floor(this.position.x - this.halfWidth);
    const maxX = Math.floor(this.position.x + this.halfWidth);
    const minY = Math.floor(this.position.y + offsetY);
    const maxY = Math.floor(this.position.y + offsetY + this.height);
    const minZ = Math.floor(this.position.z - this.halfWidth);
    const maxZ = Math.floor(this.position.z + this.halfWidth);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (world.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  collides(world) {
    return this._collides(world, 0);
  }

  _moveAxis(world, axis, delta) {
    if (delta === 0) return;
    this.position[axis] += delta;
    if (this._collides(world)) {
      this.position[axis] -= delta;
      if (axis === 'y') {
        this.velocity.y = 0;
        if (delta < 0) this.onGround = true;
      } else {
        this.velocity[axis] = 0;
      }
    }
  }

  update(dt, input, world) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (input.forward) move.add(forward);
    if (input.back) move.sub(forward);
    if (input.left) move.sub(right);
    if (input.right) move.add(right);

    if (move.lengthSq() > 0) move.normalize();

    if (this.flying) {
      const speed = input.sprint ? FLY_SPEED * 1.45 : FLY_SPEED;
      const target = move.multiplyScalar(speed);
      if (input.jump) target.y += speed;
      if (input.down) target.y -= speed;

      const blend = 1 - Math.exp(-12 * dt);
      this.velocity.x += (target.x - this.velocity.x) * blend;
      this.velocity.y += (target.y - this.velocity.y) * blend;
      this.velocity.z += (target.z - this.velocity.z) * blend;
      this.onGround = false;
    } else {
      const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      this.velocity.x = move.x * speed;
      this.velocity.z = move.z * speed;
      this.velocity.y = Math.max(TERMINAL_VELOCITY, this.velocity.y - GRAVITY * dt);

      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // 分轴移动，避免高速穿墙
    const maxStep = 0.45;
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, maxStep / Math.max(1, Math.abs(this.velocity.y) + Math.abs(this.velocity.x) + Math.abs(this.velocity.z)));
      this._moveAxis(world, 'y', this.velocity.y * step);
      this._moveAxis(world, 'x', this.velocity.x * step);
      this._moveAxis(world, 'z', this.velocity.z * step);
      remaining -= step;
    }

    if (!this.flying) {
      this.onGround = this._collides(world, -0.02);
    }
  }

  toggleFly() {
    this.flying = !this.flying;
    if (this.flying) {
      this.velocity.set(0, 0, 0);
      this.onGround = false;
    }
    return this.flying;
  }
}
