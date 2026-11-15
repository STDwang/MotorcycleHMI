import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideSession, obstacles } from '../web/ride.mjs';

test('ready and paused sessions do not advance; resume is explicit', () => {
  const ride = new RideSession(3000); ride.vehicle.throttle = 1; ride.step(1);
  assert.equal(ride.distance, 0); assert.equal(ride.time, 0);
  ride.start(); ride.vehicle.throttle = 1; ride.step(1); assert.ok(ride.distance > 0);
  ride.pause(); const distance = ride.distance, time = ride.time; ride.step(10);
  assert.equal(ride.distance, distance); assert.equal(ride.time, time); assert.equal(ride.vehicle.throttle, 0);
  ride.start(); ride.vehicle.throttle = 1; ride.step(1); assert.ok(ride.distance > distance);
});
test('steering moves across road, shoulder slows vehicle and guardrail penalizes once per cooldown', () => {
  const ride = new RideSession(3000); ride.start(); ride.vehicle.speed = 80; ride.steering = 1;
  for (let i = 0; i < 8; i++) ride.step(.1);
  assert.ok(ride.lateral > 0); ride.lateral = 4.3; ride.step(.05);
  assert.equal(ride.collisions, 1); assert.equal(ride.penalty, 3); assert.ok(ride.vehicle.speed < 40);
  ride.lateral = 4.3; ride.step(.05); assert.equal(ride.collisions, 1);
});
test('obstacle crossing checks lateral hitbox and does not penalize a clear lane', () => {
  for (const hit of [true, false]) {
    const ride = new RideSession(3000); ride.start(); ride.vehicle.speed = 100;
    ride.distance = obstacles[0].fraction * ride.length - .4; ride.lateral = hit ? obstacles[0].lane : 0;
    ride.step(.05); assert.equal(ride.collisions, hit ? 1 : 0);
    assert.equal(ride.hitObstacles.size, 1);
  }
});
test('lap checkpoint progression and finish clamp; reset clears session state', () => {
  const ride = new RideSession(100); ride.start(); ride.vehicle.auto = true;
  for (let i = 0; i < 1000 && ride.state !== 'finished'; i++) ride.step(.05);
  assert.equal(ride.state, 'finished'); assert.equal(ride.distance, 100); assert.equal(ride.checkpoint, 4);
  const time = ride.time; ride.step(10); assert.equal(ride.time, time); assert.equal(ride.vehicle.speed, 0);
  ride.reset(); assert.equal(ride.state, 'ready'); assert.equal(ride.distance, 0); assert.equal(ride.penalty, 0); assert.equal(ride.hitObstacles.size, 0);
});
