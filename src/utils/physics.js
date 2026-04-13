/** Gravitational attraction toward a point */
export function attract(px, py, targetX, targetY, strength, minDist = 10) {
  const dx = targetX - px;
  const dy = targetY - py;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  if (dist < minDist) {
    const f = strength / (minDist * minDist);
    return { fx: (dx / minDist) * f, fy: (dy / minDist) * f };
  }
  const f = strength / distSq;
  return { fx: (dx / dist) * f, fy: (dy / dist) * f };
}

/** Spring force toward anchor point */
export function spring(px, py, anchorX, anchorY, stiffness, damping = 0, vx = 0, vy = 0) {
  const dx = anchorX - px;
  const dy = anchorY - py;
  return {
    fx: dx * stiffness - vx * damping,
    fy: dy * stiffness - vy * damping,
  };
}

/** Repulsion force away from a point */
export function repel(px, py, sourceX, sourceY, strength, maxDist = 200) {
  const dx = px - sourceX;
  const dy = py - sourceY;
  const distSq = dx * dx + dy * dy;
  if (distSq > maxDist * maxDist) return { fx: 0, fy: 0 };
  const dist = Math.sqrt(distSq) || 1;
  const f = strength / distSq;
  return { fx: (dx / dist) * f, fy: (dy / dist) * f };
}

/** Apply friction/damping to velocity */
export function friction(vx, vy, coefficient) {
  return { vx: vx * coefficient, vy: vy * coefficient };
}
