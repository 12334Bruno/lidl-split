export function enhanceSliderHaptics(container) {
  const document = container.ownerDocument;
  const window = document.defaultView;
  const navigator = window.navigator;
  if (typeof navigator.vibrate !== 'function') return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let drag = null;
  let lastPulse = -Infinity;

  container.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !event.target.matches?.('.percentage-slider')) return;
    drag = { slider: event.target, pointerId: event.pointerId, value: event.target.valueAsNumber };
    lastPulse = -Infinity;
  }, { passive: true });

  container.addEventListener('input', event => {
    if (!drag || event.target !== drag.slider || !drag.slider.isConnected) return;
    const value = drag.slider.valueAsNumber;
    if (!Number.isFinite(value) || value === drag.value) return;
    drag.value = value;
    if (document.visibilityState !== 'visible' || reducedMotion?.matches) return;

    const now = window.performance.now();
    // Space out tiny ticks so a fast drag does not become a continuous buzz.
    if (now - lastPulse < 50) return;
    lastPulse = now;
    try { navigator.vibrate(8); } catch { /* Keep dragging if vibration is blocked. */ }
  }, { passive: true });

  const endDrag = event => {
    if (event.pointerId != null && event.pointerId !== drag?.pointerId) return;
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
