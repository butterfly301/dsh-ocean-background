const EDGE = 1.28;

export function smoothstep(min, max, value) {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function lerp(from, to, blend) {
  return from + (to - from) * blend;
}

export function createWindLine({ band, startDelay = 0, pointCount = 33, random = Math.random }) {
  const pick = ([min, max]) => min + random() * (max - min);
  const sample = { points: new Float32Array(pointCount * 2), visible: false, opacity: 0, centerY: 0 };
  let wait = Math.max(0, startDelay);
  let age = 0;
  let gust;

  function nextGust() {
    const travel = (band[1] - band[0]) * pick([0.60, 0.85]);
    const low = pick([band[0], band[1] - travel]);
    const upwards = random() < 0.5;
    const from = upwards ? low : low + travel;
    const to = upwards ? low + travel : low;
    const direction = random() < 0.5 ? -1 : 1;
    gust = {
      duration: pick([4.2, 6.2]),
      lag: pick([0.9, 1.6]),
      left: { from: from + pick([-0.012, 0.012]), to: to + pick([-0.012, 0.012]) },
      right: { from: from + pick([-0.012, 0.012]), to: to + pick([-0.012, 0.012]) },
      bow: {
        from: direction * pick([0.035, 0.055]),
        peak: direction * pick([0.070, 0.100]),
        to: direction * pick([0.035, 0.065]),
      },
      skew: { from: pick([-0.24, 0.24]), to: pick([-0.24, 0.24]) },
    };
    age = 0;
  }

  nextGust();

  return {
    advance(dt) {
      let remaining = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      while (remaining > 0) {
        if (wait > 0) {
          const step = Math.min(wait, remaining);
          wait -= step;
          remaining -= step;
          if (wait > 0) break;
        }
        const step = Math.min(gust.duration - age, remaining);
        age += step;
        remaining -= step;
        if (age >= gust.duration) {
          nextGust();
          wait = pick([0.6, 1.8]);
        }
      }
      if (wait > 0) {
        sample.visible = false;
        sample.opacity = 0;
        return sample;
      }

      const left = lerp(gust.left.from, gust.left.to, smoothstep(gust.lag, gust.duration, age));
      const right = lerp(gust.right.from, gust.right.to, smoothstep(0, gust.duration - gust.lag, age));
      const peakAt = gust.duration * 0.52;
      const bow = age < peakAt
        ? lerp(gust.bow.from, gust.bow.peak, smoothstep(0, peakAt, age))
        : lerp(gust.bow.peak, gust.bow.to, smoothstep(peakAt, gust.duration, age));
      const skew = lerp(gust.skew.from, gust.skew.to, smoothstep(0, gust.duration, age));
      for (let i = 0; i < pointCount; i += 1) {
        const t = i / (pointCount - 1);
        const x = t * 2 - 1;
        sample.points[i * 2] = x * EDGE;
        sample.points[i * 2 + 1] = lerp(left, right, t)
          + bow * (1 - x * x) * (1 + skew * x);
      }
      sample.centerY = (left + right) * 0.5 + bow;
      sample.opacity = smoothstep(0, 0.7, age) * (1 - smoothstep(gust.duration - 1.0, gust.duration, age));
      sample.visible = sample.opacity > 0.001;
      return sample;
    },
  };
}
