// Native-switch drag technique adapted from ios-vibrator-pro-max by Sam Denty.
// See THIRD_PARTY_NOTICES.md for the source and license.
export function enhanceIOSSliderHaptics(container, reducedMotion) {
  const document = container.ownerDocument;
  const window = document.defaultView;
  const probe = document.createElement('input');
  const isIOS = /iPhone|iPad|iPod/.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  if (!isIOS || !('switch' in probe)) return;

  const pads = new WeakMap();
  let drag = null;
  const canPulse = () => document.visibilityState === 'visible' && !reducedMotion?.matches;

  function reset(pad) {
    const slider = pad.parentElement.querySelector('.percentage-slider');
    const fraction = (slider.valueAsNumber - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    const clip = pad.firstElementChild;
    clip.removeAttribute('style');
    clip.style.left = `calc(${fraction * 100}% - ${fraction * 16}px)`;
    clip.firstElementChild.checked = false;
  }

  function addSlider(slider) {
    const host = slider.closest('.percentage-slider-wrap');
    if (!host || pads.has(host)) return;
    const pad = document.createElement('div');
    pad.className = 'ios-slider-haptic-pad';
    pad.setAttribute('aria-hidden', 'true');
    const clip = document.createElement('div');
    clip.className = 'ios-slider-haptic-clip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    input.className = 'ios-slider-haptic-switch';
    clip.appendChild(input);
    pad.appendChild(clip);
    pads.set(host, pad);
    host.appendChild(pad);
    reset(pad);
    // Only the real slider should report a percentage or appear to screen readers.
    for (const type of ['input', 'change']) pad.addEventListener(type, event => event.stopPropagation());
    pad.addEventListener('click', event => event.preventDefault());
  }

  function addSliders(root) {
    if (root.matches?.('.percentage-slider')) addSlider(root);
    root.querySelectorAll?.('.percentage-slider').forEach(addSlider);
  }
  addSliders(container);
  new window.MutationObserver(mutations => {
    if (drag && !drag.slider.isConnected) endDrag();
    for (const mutation of mutations) for (const node of mutation.addedNodes) addSliders(node);
  }).observe(container, { childList: true, subtree: true });

  container.addEventListener('input', event => {
    const row = event.target.closest?.('.split-row');
    const host = row?.querySelector('.percentage-slider-wrap');
    const pad = host && pads.get(host);
    if (pad && drag?.pad !== pad) reset(pad);
  });

  function setValue(value) {
    const previous = drag.slider.value;
    drag.slider.value = String(value);
    if (drag.slider.value === previous) return false;
    drag.changed = true;
    drag.slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  }

  container.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button !== 0 || !canPulse()) return;
    const pad = event.target.closest?.('.ios-slider-haptic-pad');
    if (!pad) return;
    const slider = pad.parentElement.querySelector('.percentage-slider');
    if (slider.disabled) return;
    const box = slider.getBoundingClientRect();
    const native = event.target.matches('.ios-slider-haptic-switch');
    drag = {
      pad, slider, native, pointerId: event.pointerId, box,
      x: event.clientX, y: event.clientY, value: slider.valueAsNumber,
      changed: false, lastPulse: -Infinity, flipped: false,
    };
    if (!native) {
      const fraction = Math.max(0, Math.min(1, (event.clientX - box.x - 8) / Math.max(1, box.width - 16)));
      setValue(Number(slider.min) + fraction * (Number(slider.max) - Number(slider.min)));
      drag.value = slider.valueAsNumber;
      try { pad.setPointerCapture(event.pointerId); } catch { /* The finger may already be lifted. */ }
    }
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.slider.isConnected || !canPulse()) return endDrag();
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const range = Number(drag.slider.max) - Number(drag.slider.min);
    const changed = setValue(drag.value + deltaX / Math.max(1, drag.box.width - 16) * range);
    if (!drag.native) return;

    const now = window.performance.now();
    const pulse = changed && now - drag.lastPulse >= 80;
    if (pulse) {
      drag.lastPulse = now;
      drag.flipped = !drag.flipped;
    }
    // Keep the real switch under the finger. Moving it back and forth lets
    // iOS supply its own switch ticks during this real touch gesture.
    const width = 28;
    const height = 12.4;
    const x = (pulse ? drag.x : event.clientX) - drag.box.x - width / 2;
    const y = (pulse ? drag.y : event.clientY) - drag.box.y - height / 2;
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    drag.pad.firstElementChild.style.cssText = `top:0;left:0;width:${width}px;height:${height}px;direction:${!pulse || drag.flipped ? 'rtl' : 'ltr'};transform:translate(${x}px,${y}px) rotate(${angle}deg) translateX(${pulse ? 0 : 50}px)`;
  }, { capture: true, passive: true });

  function endDrag(event) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const finished = drag;
    drag = null;
    reset(finished.pad);
    if (finished.pad.hasPointerCapture(finished.pointerId)) finished.pad.releasePointerCapture(finished.pointerId);
    if (event?.type === 'pointerup' && finished.changed && finished.slider.isConnected) {
      finished.slider.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    window.requestAnimationFrame(() => {
      if (drag?.pad !== finished.pad) reset(finished.pad);
    });
  }
  document.addEventListener('pointerup', endDrag, { capture: true, passive: true });
  document.addEventListener('pointercancel', endDrag, { capture: true, passive: true });
  container.addEventListener('lostpointercapture', endDrag, { passive: true });
  document.addEventListener('focusin', event => {
    if (drag && event.target !== drag.slider && !drag.pad.contains(event.target)) endDrag();
  });
  window.addEventListener('blur', endDrag);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endDrag();
  });
  reducedMotion?.addEventListener('change', () => {
    if (reducedMotion.matches) endDrag();
  });
}
