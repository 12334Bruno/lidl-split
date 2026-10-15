import { enhanceIOSSliderHaptics } from './ios-slider-haptics.js?v=slider-feedback-2';

export function enhanceSliderHaptics(container) {
  const document = container.ownerDocument;
  const window = document.defaultView;
  const navigator = window.navigator;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (typeof navigator.vibrate !== 'function') {
    enhanceIOSSliderHaptics(container, reducedMotion);
    return;
  }
  let drag = null;
  let lastPulse = -Infinity;

  const canPulse = () => document.visibilityState === 'visible' && !reducedMotion?.matches;
  const pulse = () => {
    lastPulse = window.performance.now();
    // A slightly longer tick is easier to feel on Android phones.
    try { return navigator.vibrate(20) !== false; } catch { return false; }
  };

  container.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button !== 0 || !event.target.matches?.('.percentage-slider')) return;
    drag = { slider: event.target, pointerId: event.pointerId, value: event.target.valueAsNumber, retry: false };
    lastPulse = -Infinity;
  }, { passive: true });

  container.addEventListener('input', event => {
    if (!drag || event.target !== drag.slider || !drag.slider.isConnected) return;
    const value = drag.slider.valueAsNumber;
    if (!Number.isFinite(value) || value === drag.value) return;
    drag.value = value;
    if (!canPulse()) return;

    const now = window.performance.now();
    // Space out tiny ticks so a fast drag does not become a continuous buzz.
    if (now - lastPulse < 80) return;
    drag.retry = !pulse();
  }, { passive: true });

  const endDrag = event => {
    if (event.pointerId != null && event.pointerId !== drag?.pointerId) return;
    // Some touch browsers only grant vibration when the finger is lifted.
    if (event.type === 'pointerup' && drag?.retry && drag.slider.isConnected && canPulse()) pulse();
    drag = null;
  };
  document.addEventListener('pointerup', endDrag, { capture: true, passive: true });
  document.addEventListener('pointercancel', endDrag, { capture: true, passive: true });
  container.addEventListener('lostpointercapture', endDrag, { passive: true });
  container.addEventListener('focusout', event => {
    if (event.target === drag?.slider) drag = null;
  });
  window.addEventListener('blur', endDrag);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) drag = null;
  });
}
