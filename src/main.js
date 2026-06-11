import { projects } from './projects/registry.js';
import { ProjectRunner } from './core/ProjectRunner.js';
import { DebugPanel } from './core/DebugPanel.js';

const menuContainer = document.getElementById('menu-container');
const projectContainer = document.getElementById('project-container');
const projectGrid = document.getElementById('project-grid');
const backBtn = document.getElementById('back-btn');
const fpsCounter = document.getElementById('fps-counter');
const loadingOverlay = document.getElementById('loading-overlay');
const debugPanelEl = document.getElementById('debug-panel');

let runner = null;
let fpsInterval = null;
const debugPanel = new DebugPanel(debugPanelEl);
debugPanel.onRestart(() => {
  if (runner) runner.restartProject();
});

// --- URL param helpers ---

/** Parse hash like "#liquid-rings?baseHue=300&speed=1.5" into { id, params } */
function parseHash(hash) {
  const raw = hash.slice(1); // remove #
  const qIdx = raw.indexOf('?');
  if (qIdx === -1) return { id: raw, params: null };

  const id = raw.slice(0, qIdx);
  const search = raw.slice(qIdx + 1);
  const params = {};
  for (const pair of search.split('&')) {
    const [key, val] = pair.split('=');
    if (key && val !== undefined) {
      params[decodeURIComponent(key)] = parseFloat(val);
    }
  }
  return { id, params };
}

/** Build a hash string with only non-default param values */
function buildHash(projectId, descriptors, stateParams) {
  const parts = [];
  for (const [key, desc] of Object.entries(descriptors)) {
    if (stateParams[key] !== desc.value) {
      parts.push(`${key}=${stateParams[key]}`);
    }
  }
  return '#' + projectId + (parts.length > 0 ? '?' + parts.join('&') : '');
}

// Build menu
function renderMenu() {
  projectGrid.innerHTML = '';
  for (const project of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `<h2>${project.name}</h2><p>${project.description}</p>`;
    card.addEventListener('click', () => {
      window.location.hash = project.id;
    });
    projectGrid.appendChild(card);
  }
}

function showMenu() {
  // Cleanup runner
  if (runner) {
    runner.destroy();
    runner = null;
  }
  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }
  debugPanel.hide();
  menuContainer.style.display = '';
  projectContainer.style.display = 'none';
  fpsCounter.textContent = '';
}

async function showProject(projectId, urlParams) {
  const projectMeta = projects.find(p => p.id === projectId);
  if (!projectMeta) {
    window.location.hash = '';
    return;
  }

  menuContainer.style.display = 'none';
  projectContainer.style.display = '';
  loadingOverlay.classList.remove('hidden');
  loadingOverlay.querySelector('.loading-text').textContent = 'Initializing camera...';

  try {
    // Load the project module
    const project = await projectMeta.load();

    // Create runner
    const canvas = document.getElementById('output-canvas');
    runner = new ProjectRunner(canvas);

    // Load MediaPipe if needed
    if (projectMeta.mediapipe && projectMeta.mediapipe.length > 0) {
      loadingOverlay.querySelector('.loading-text').textContent = 'Loading AI models...';
      const { MediaPipeManager } = await import('./core/MediaPipeManager.js');
      const mpManager = new MediaPipeManager();
      await runner.setMediaPipeManager(mpManager);
    }

    loadingOverlay.querySelector('.loading-text').textContent = 'Starting...';
    await runner.loadProject(project);
    runner.start();

    // Apply URL params if present (before loading debug panel so sliders reflect them)
    const stateParams = runner.getStateParams();
    const descriptors = runner.getParamDescriptors();
    if (urlParams && descriptors && stateParams) {
      for (const [key, val] of Object.entries(urlParams)) {
        if (key in stateParams && !isNaN(val)) {
          stateParams[key] = val;
        }
      }
    }

    // FPS display
    fpsInterval = setInterval(() => {
      fpsCounter.textContent = `${runner.fps} fps`;
    }, 500);

    // Load debug panel with presets
    const presets = runner.getProjectPresets();
    if (descriptors && stateParams) {
      debugPanel.load(runner.getProjectName(), descriptors, stateParams, presets);

      // Sync URL when params change via sliders
      debugPanel.onParamsChange(() => {
        // Update hash silently (without triggering hashchange)
        const newHash = buildHash(projectId, descriptors, stateParams);
        history.replaceState(null, '', newHash);
      });
    }

    loadingOverlay.classList.add('hidden');
  } catch (err) {
    console.error('Failed to load project:', err);
    loadingOverlay.querySelector('.loading-text').textContent =
      `Error: ${err.message}. Please allow camera access and reload.`;
  }
}

// Routing
function handleRoute() {
  const { id, params } = parseHash(window.location.hash);
  if (id && projects.some(p => p.id === id)) {
    showProject(id, params);
  } else {
    showMenu();
  }
}

// Events
backBtn.addEventListener('click', () => {
  window.location.hash = '';
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    if (runner) debugPanel.toggle();
  }
  if (e.key === 'r' || e.key === 'R') {
    if (runner) runner.restartProject();
  }
});

window.addEventListener('hashchange', handleRoute);

// Init
renderMenu();
handleRoute();
