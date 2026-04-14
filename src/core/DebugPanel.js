export class DebugPanel {
  constructor(containerElement) {
    this.container = containerElement;
    this.visible = false;
    this._descriptors = null;
    this._stateParams = null;
    this._presets = null;
    this._rows = {};
    this._presetSelect = null;
    this._onParamsChange = null; // callback when params change (for URL sync)
  }

  /** Load param descriptors, presets, and live state.params for the active project */
  load(projectName, descriptors, stateParams, presets) {
    this._descriptors = descriptors;
    this._stateParams = stateParams;
    this._presets = presets || [];
    this._rebuild(projectName);
  }

  /** Set callback for when params change (used for URL updates) */
  onParamsChange(fn) {
    this._onParamsChange = fn;
  }

  toggle() {
    this.visible = !this.visible;
    this.container.classList.toggle('visible', this.visible);
  }

  hide() {
    this.visible = false;
    this.container.classList.remove('visible');
  }

  /** Apply a set of param values and update sliders */
  applyValues(values) {
    if (!this._descriptors || !this._stateParams) return;

    for (const [key, val] of Object.entries(values)) {
      if (key in this._stateParams) {
        this._stateParams[key] = val;
        const row = this._rows[key];
        if (row) {
          row.slider.value = val;
          row.valueDisplay.textContent = this._formatValue(val, row.desc.step);
        }
      }
    }
    this._updatePresetDropdown();
  }

  /** Reset all params to their descriptor defaults */
  resetToDefaults() {
    if (!this._descriptors || !this._stateParams) return;

    for (const [key, desc] of Object.entries(this._descriptors)) {
      this._stateParams[key] = desc.value;
      const row = this._rows[key];
      if (row) {
        row.slider.value = desc.value;
        row.valueDisplay.textContent = this._formatValue(desc.value, desc.step);
      }
    }
    this._updatePresetDropdown();
    if (this._onParamsChange) this._onParamsChange();
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

    // Preset row: dropdown + action buttons
    if (this._presets.length > 0) {
      const presetRow = document.createElement('div');
      presetRow.className = 'debug-preset-row';

      const presetSelect = document.createElement('select');
      presetSelect.className = 'debug-preset-select';

      // "Default" option always first
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '__default__';
      defaultOpt.textContent = 'Default';
      presetSelect.appendChild(defaultOpt);

      for (const preset of this._presets) {
        const opt = document.createElement('option');
        opt.value = preset.name;
        opt.textContent = preset.name;
        presetSelect.appendChild(opt);
      }

      // "Custom" option shown when sliders don't match any preset
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = '(Custom)';
      customOpt.hidden = true;
      presetSelect.appendChild(customOpt);

      presetSelect.addEventListener('change', () => {
        const val = presetSelect.value;
        if (val === '__default__') {
          this.resetToDefaults();
          return;
        }
        if (val === '__custom__') return;
        const preset = this._presets.find(p => p.name === val);
        if (preset) {
          // Start from defaults, then overlay preset values
          for (const [key, desc] of Object.entries(this._descriptors)) {
            this._stateParams[key] = desc.value;
          }
          this.applyValues(preset.values);
          if (this._onParamsChange) this._onParamsChange();
        }
      });

      this._presetSelect = presetSelect;
      presetRow.appendChild(presetSelect);

      // Copy URL button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'debug-copy-btn';
      copyBtn.textContent = 'Copy URL';
      copyBtn.title = 'Copy a shareable URL with current params';
      copyBtn.addEventListener('click', () => {
        this._copyURL();
      });
      presetRow.appendChild(copyBtn);

      this.container.appendChild(presetRow);
    }

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
        this._updatePresetDropdown();
        if (this._onParamsChange) this._onParamsChange();
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueDisplay);
      this.container.appendChild(row);

      this._rows[key] = { slider, valueDisplay, desc };
    }

    // Set initial dropdown state
    this._updatePresetDropdown();
  }

  /** Check if current params match a preset and update dropdown accordingly */
  _updatePresetDropdown() {
    if (!this._presetSelect || !this._descriptors || !this._stateParams) return;

    // Check if current values match defaults
    let isDefault = true;
    for (const [key, desc] of Object.entries(this._descriptors)) {
      if (this._stateParams[key] !== desc.value) {
        isDefault = false;
        break;
      }
    }
    if (isDefault) {
      this._presetSelect.value = '__default__';
      return;
    }

    // Check if current values match any preset
    for (const preset of this._presets) {
      if (this._matchesPreset(preset)) {
        this._presetSelect.value = preset.name;
        return;
      }
    }

    // No match — show custom
    const customOpt = this._presetSelect.querySelector('option[value="__custom__"]');
    if (customOpt) customOpt.hidden = false;
    this._presetSelect.value = '__custom__';
  }

  _matchesPreset(preset) {
    // A preset matches if applying it on top of defaults gives current state
    for (const [key, desc] of Object.entries(this._descriptors)) {
      const expected = key in preset.values ? preset.values[key] : desc.value;
      if (Math.abs(this._stateParams[key] - expected) > 0.0001) {
        return false;
      }
    }
    return true;
  }

  _copyURL() {
    if (!this._descriptors || !this._stateParams) return;

    // Build query string with only non-default values
    const parts = [];
    for (const [key, desc] of Object.entries(this._descriptors)) {
      if (this._stateParams[key] !== desc.value) {
        parts.push(`${key}=${this._stateParams[key]}`);
      }
    }

    const hash = window.location.hash.split('?')[0];
    const url = window.location.origin + window.location.pathname +
      hash + (parts.length > 0 ? '?' + parts.join('&') : '');

    navigator.clipboard.writeText(url).then(() => {
      // Brief visual feedback
      const btn = this.container.querySelector('.debug-copy-btn');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
        }, 1500);
      }
    });
  }

  _formatValue(val, step) {
    if (step >= 1) return String(Math.round(val));
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return val.toFixed(decimals);
  }
}
