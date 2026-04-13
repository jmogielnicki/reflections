export class DebugPanel {
  constructor(containerElement) {
    this.container = containerElement;
    this.visible = false;
    this._descriptors = null;
    this._stateParams = null;
    this._rows = {};
  }

  /** Load param descriptors and live state.params for the active project */
  load(projectName, descriptors, stateParams) {
    this._descriptors = descriptors;
    this._stateParams = stateParams;
    this._rebuild(projectName);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.classList.toggle('visible', this.visible);
  }

  hide() {
    this.visible = false;
    this.container.classList.remove('visible');
  }

  _rebuild(projectName) {
    this.container.innerHTML = '';
    this._rows = {};

    if (!this._descriptors || !this._stateParams) return;

    // Header
    const header = document.createElement('div');
    header.className = 'debug-header';
    header.textContent = projectName;
    this.container.appendChild(header);

    const hint = document.createElement('div');
    hint.className = 'debug-hint';
    hint.textContent = 'Press D to close';
    this.container.appendChild(hint);

    // One row per param
    for (const [key, desc] of Object.entries(this._descriptors)) {
      const row = document.createElement('div');
      row.className = 'debug-row';

      const label = document.createElement('label');
      label.className = 'debug-label';
      label.textContent = desc.label || key;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'debug-slider';
      slider.min = desc.min;
      slider.max = desc.max;
      slider.step = desc.step;
      slider.value = this._stateParams[key];

      const valueDisplay = document.createElement('span');
      valueDisplay.className = 'debug-value';
      valueDisplay.textContent = this._formatValue(this._stateParams[key], desc.step);

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        this._stateParams[key] = val;
        valueDisplay.textContent = this._formatValue(val, desc.step);
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueDisplay);
      this.container.appendChild(row);

      this._rows[key] = { slider, valueDisplay, desc };
    }
  }

  _formatValue(val, step) {
    if (step >= 1) return String(Math.round(val));
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return val.toFixed(decimals);
  }
}
