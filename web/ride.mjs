import { VehicleSimulator } from './model.mjs';

export const obstacles = [
  { fraction: .115, lane: -1.65 }, { fraction: .235, lane: 1.75 },
  { fraction: .395, lane: -1.8 }, { fraction: .555, lane: 1.8 },
  { fraction: .715, lane: -1.6 }, { fraction: .855, lane: 1.65 },
];

// Arcade road-relative driving, not a rigid body or real motorcycle dynamics model.
export class RideSession {
  constructor(length) {
    this.length = length;
    this.vehicle = new VehicleSimulator();
    this.reset();
  }
  reset() {
    this.vehicle.reset(); this.vehicle.auto = false;
    this.state = 'ready'; this.distance = 0; this.lateral = 0; this.steering = 0;
    this.time = 0; this.penalty = 0; this.collisions = 0; this.checkpoint = 0;
    this.cooldown = 0; this.lastEvent = ''; this.hitObstacles = new Set(); this.offroad = false;
  }
  start() { if (this.state === 'ready' || this.state === 'paused') this.state = 'running'; }
  pause() {
    if (this.state === 'running') this.state = 'paused';
    this.vehicle.throttle = 0; this.vehicle.brake = 0; this.steering = 0;
  }
  collide(label) {
    if (this.cooldown > 0) return;
    this.vehicle.speed *= .36; this.penalty += 3; this.collisions++;
    this.cooldown = 1.5; this.lastEvent = `${label} · +3 秒`;
  }
  step(dt) {
    if (this.state !== 'running') return;
    this.time += dt; this.cooldown = Math.max(0, this.cooldown - dt);
    const previousDistance = this.distance;
    this.vehicle.step(dt);
    const speed = this.vehicle.speed / 3.6;
    this.lateral += this.steering * (1.1 + Math.min(4.8, speed * .16)) * dt;
    if (this.vehicle.auto && this.steering === 0) this.lateral *= Math.exp(-dt * 1.8);
    this.offroad = Math.abs(this.lateral) > 3.45;
    if (this.offroad) this.vehicle.speed *= Math.exp(-dt * .65);
    if (Math.abs(this.lateral) > 4.25) {
      this.collide('碰到护栏'); this.lateral = Math.sign(this.lateral) * 3.8;
    }
    this.distance = Math.min(this.length, this.distance + this.vehicle.speed / 3.6 * dt);
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i], position = obstacle.fraction * this.length;
      if (!this.hitObstacles.has(i) && previousDistance <= position && this.distance >= position) {
        this.hitObstacles.add(i);
        if (Math.abs(this.lateral - obstacle.lane) < .9) this.collide('碰到路障');
      }
    }
    const checkpoint = Math.min(4, Math.floor(this.distance / this.length * 4));
    if (checkpoint > this.checkpoint) { this.checkpoint = checkpoint; this.lastEvent = checkpoint === 4 ? '完成山湖环线' : `通过检查点 ${checkpoint} / 4`; }
    if (this.distance >= this.length) {
      this.state = 'finished'; this.vehicle.throttle = 0; this.vehicle.brake = 0;
      this.vehicle.speed = 0; this.vehicle.gear = 0; this.vehicle.auto = false;
    }
  }
}
