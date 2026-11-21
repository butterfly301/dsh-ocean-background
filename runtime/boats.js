import * as THREE from 'three';
import { waveHeightAt, waveSlopeAt } from './wave-field.js';
import { toWorldX } from './world-motion.js';
import {
  createBerthAllocator,
  isTerminal,
  normalizeStatus,
  phaseFor,
  rowsOars,
} from './fleet.js';

// Crew boats sail in from off the left edge, hold station off the ship's bows,
// and leave to the right. Every lane is outside the hull's beam, so a boat
// never crosses the ship it belongs to.
const ENTER_X = -34;
const EXIT_X = 40;
const BERTH_SPEED = 5.6;

export function createFleet({ scene, makeDinghy, getView }) {
  const boats = new Map();
  const berthAllocator = createBerthAllocator();
  let rootId = null;

  // The camera may move between frames, so the usable span is read live. A
  // caller that never supplies getView keeps the plugin's default span.
  function readView() {
    if (typeof getView !== 'function') return undefined;
    try {
      return getView() ?? undefined;
    } catch {
      return undefined;
    }
  }

  function findPaddles(group) {
    const found = [];
    group.traverse((node) => {
      if (node.isMesh && /paddle/i.test(node.material?.name ?? node.name)) found.push(node);
    });
    return found;
  }

  function spawn(id, shipX, phase, view) {
    const group = makeDinghy();
    const berth = berthAllocator.reserve(id, shipX, view);
    // Enter along the boat's own lane, not across the fleet: the z coordinate is
    // fixed for the whole approach.
    group.position.set(ENTER_X, 0, berth.z);
    group.rotation.y = Math.PI;
    scene.add(group);
    const boat = {
      id,
      group,
      status: 'unavailable',
      shipX,
      berth: new THREE.Vector3(berth.x, berth.y, berth.z),
      yaw: berth.yaw ?? 0,
      phase,
      speed: BERTH_SPEED * (0.88 + Math.random() * 0.24),
      row: 0,
      targetRow: 0,
      bob: Math.random() * 6.28,
      paddles: findPaddles(group),
    };
    group.scale.setScalar(berth.scale ?? 1);
    boats.set(id, boat);
    return boat;
  }

  // Removes a boat without touching its model: every boat shares the dinghy
  // geometry and materials, which live until the fleet itself is disposed.
  function despawn(boat) {
    scene.remove(boat.group);
    berthAllocator.remove(boat.id);
  }

  function clear() {
    for (const boat of boats.values()) despawn(boat);
    boats.clear();
    berthAllocator.clear();
  }

  function sync(entries, { shipX = 0, rootId: nextRootId = null } = {}) {
    // A different root session is a different fleet; no boat carries over.
    if (nextRootId !== rootId) {
      clear();
      rootId = nextRootId;
    }

    const present = new Set();
    const view = readView();
    if (view) berthAllocator.setView(view);
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || !entry.id) continue;
      const id = String(entry.id);
      const status = normalizeStatus(entry);
      // A finished child's turn is closed; its boat leaves the water instead of
      // holding a berth. Waiting and unknown children keep their place afloat.
      if (isTerminal(status)) continue;
      present.add(id);

      let boat = boats.get(id);
      if (!boat) boat = spawn(id, shipX, 'entering', view);
      boat.status = status;
      boat.shipX = shipX;
      boat.targetRow = rowsOars(status) ? 1 : 0;

      const berth = berthAllocator.reserve(id, shipX, view);
      boat.berth.set(berth.x, berth.y, berth.z);
      const nextPhase = phaseFor(status, boat.phase);
      if (nextPhase !== boat.phase) {
        boat.phase = nextPhase;
        // A boat that was sailing out and is working again comes back in from
        // the left edge, not from wherever it had already drifted to.
        if (nextPhase === 'entering') {
          boat.group.position.set(ENTER_X, 0, berth.z);
          boat.group.rotation.y = Math.PI;
        }
      }
    }

    for (const [id, boat] of boats) {
      if (present.has(id) || boat.phase === 'leaving') continue;
      boat.phase = 'leaving';
      boat.targetRow = 0;
    }
  }

  function update(dt, { time, flow, sea, worldOffset = 0 }) {
    const view = readView();
    if (view) berthAllocator.setView(view);
    for (const [id, boat] of boats) {
      const group = boat.group;

      // Re-derive the berth every frame: the camera may have been dragged, and
      // the formation must follow the visible water rather than a frozen span.
      // A slow drift around the berth keeps the fleet alive without letting a
      // boat wander away from the visible band.
      const berth = berthAllocator.reserve(id, boat.shipX, view);
      const driftX = Math.sin(time * 0.43 + boat.bob) * 0.22;
      const driftZ = Math.cos(time * 0.31 + boat.bob * 1.7) * 0.16;
      boat.berth.set(berth.x + driftX, berth.y, berth.z + driftZ);

      if (boat.phase === 'entering') {
        // Hold the lane while closing in x, then settle onto the berth.
        const dx = boat.berth.x - group.position.x;
        const dz = boat.berth.z - group.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.9) {
          boat.phase = 'berthed';
        } else {
          const step = Math.min(dist, boat.speed * dt);
          group.position.x += (dx / dist) * step;
          group.position.z += (dz / dist) * step;
          group.rotation.y = Math.PI + boat.yaw * Math.min(1, dt * 1.2) + Math.max(-0.2, Math.min(0.2, (dz / Math.max(dist, 0.001)) * 0.6));
        }
      } else if (boat.phase === 'berthed') {
        const follow = Math.min(1, dt * 0.8);
        group.position.x += (boat.berth.x - group.position.x) * follow;
        group.position.z += (boat.berth.z - group.position.z) * follow;
        group.rotation.y = Math.PI + boat.yaw + Math.sin(time * 0.3 + boat.bob) * 0.04;
      } else {
        // Depart straight out along the same lane, clear of the hull.
        group.position.x += boat.speed * 1.2 * dt;
        group.rotation.y = Math.PI;
        if (group.position.x > EXIT_X) {
          despawn(boat);
          boats.delete(id);
          continue;
        }
      }

      const worldX = toWorldX(group.position.x, worldOffset);
      const h = waveHeightAt(worldX, group.position.z, time, flow, sea);
      const slope = waveSlopeAt(worldX, group.position.z, time, flow, sea);
      group.position.y = h * 0.95;
      group.rotation.z = -slope.dx * 2.6 + Math.sin(time * 1.3 + boat.bob) * 0.015;
      group.rotation.x = slope.dz * 2.8;

      // A working boat rocks its oars; a waiting or finished boat ships them.
      boat.row += (boat.targetRow - boat.row) * Math.min(1, dt * 1.5);
      for (const paddle of boat.paddles) {
        paddle.rotation.z = Math.sin(time * 2.4 + boat.bob) * 0.16 * boat.row;
      }
    }
  }

  function dispose() {
    clear();
  }

  return {
    sync,
    update,
    clear,
    dispose,
    get count() { return boats.size; },
  };
}
