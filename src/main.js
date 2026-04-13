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

async function showProject(projectId) {
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

    // FPS display
    fpsInterval = setInterval(() => {
      fpsCounter.textContent = `${runner.fps} fps`;
    }, 500);

    // Load debug panel
    const descriptors = runner.getParamDescriptors();
    const stateParams = runner.getStateParams();
    if (descriptors && stateParams) {
      debugPanel.load(runner.getProjectName(), descriptors, stateParams);
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
  const hash = window.location.hash.slice(1);
  if (hash && projects.some(p => p.id === hash)) {
    showProject(hash);
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
});

window.addEventListener('hashchange', handleRoute);

// Init
renderMenu();
handleRoute();
