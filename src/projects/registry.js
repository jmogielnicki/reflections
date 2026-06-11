export const projects = [
  {
    id: 'particle-vibration',
    name: 'Particle Vibration',
    description: 'Particles float in calm areas and vibrate intensely in darker regions of your image.',
    mediapipe: [],
    load: () => import('./particle-vibration/index.js').then(m => m.default),
  },
  {
    id: 'watercolor-drops',
    name: 'Watercolor Drops',
    description: 'Drops of color fall like rain, building a pointillist portrait that fades and reforms.',
    mediapipe: [],
    load: () => import('./watercolor-drops/index.js').then(m => m.default),
  },
  {
    id: 'paint-smear',
    name: 'Paint Smear',
    description: 'Your silhouette smears colorful paint across the canvas. Step away and it slowly retracts.',
    mediapipe: ['segmentation'],
    load: () => import('./paint-smear/index.js').then(m => m.default),
  },
  {
    id: 'dissolution',
    name: 'Dissolution',
    description: 'Gaze at your reflection; after a countdown it freezes and gently dissolves into drifting dust.',
    mediapipe: ['segmentation'],
    load: () => import('./dissolution/index.js').then(m => m.default),
  },
  {
    id: 'implode-explode',
    name: 'Implode / Explode',
    description: 'Particles rush in from off-screen to form your silhouette, hold, then burst apart.',
    mediapipe: ['segmentation', 'pose'],
    load: () => import('./implode-explode/index.js').then(m => m.default),
  },
];
