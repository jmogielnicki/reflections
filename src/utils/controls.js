/**
 * Lightweight on-screen tuning panel for live-adjusting project parameters.
 *
 * Usage:
 *   const panel = createControlPanel({
 *     title: 'My Project',
 *     controls: [
 *       { key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1, value: 2 },
 *       { type: 'button', label: 'Restart', onClick: () => ... },
 *     ],
 *   });
 *   panel.params.speed  // live-updated as sliders move
 *   panel.destroy();    // remove from DOM (call in project cleanup)
 */
export function createControlPanel({ title = 'Tuning', controls = [], parent = document.body }) {
  const params = {};

  const panel = document.createElement('div');
  panel.className = 'control-panel';

  const header = document.createElement('div');
  header.className = 'control-panel-header';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  const chevron = document.createElement('span');
  chevron.className = 'control-panel-chevron';
  chevron.textContent = '▾';
  header.appendChild(titleSpan);
  header.appendChild(chevron);
  header.addEventListener('click', () => panel.classList.toggle('collapsed'));
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'control-panel-body';
  panel.appendChild(body);

  for (const control of controls) {
    if (control.type === 'button') {
      const btn = document.createElement('button');
      btn.className = 'control-panel-button';
      btn.textContent = control.label;
      btn.addEventListener('click', control.onClick);
      body.appendChild(btn);
      continue;
    }

    params[control.key] = control.value;
    const format = control.format || ((v) => String(Math.round(v * 100) / 100));

    const row = document.createElement('div');
    row.className = 'control-row';

    const labelLine = document.createElement('div');
    labelLine.className = 'control-label-line';
    const label = document.createElement('span');
    label.textContent = control.label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'control-value';
    valueSpan.textContent = format(control.value);
    labelLine.appendChild(label);
    labelLine.appendChild(valueSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = control.min;
    slider.max = control.max;
    slider.step = control.step;
    slider.value = control.value;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      params[control.key] = v;
      valueSpan.textContent = format(v);
    });

    row.appendChild(labelLine);
    row.appendChild(slider);
    body.appendChild(row);
  }

  parent.appendChild(panel);

  return {
    params,
    element: panel,
    destroy() {
      panel.remove();
    },
  };
}
