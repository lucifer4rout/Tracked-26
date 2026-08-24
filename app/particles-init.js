import { initParticles } from "./particles.js";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!prefersReducedMotion) {
  const container = document.getElementById("particlesBg");
  initParticles(container, {
    particleColors: ["#ffc93c", "#35d0ba", "#e8e9ed"], // amber, teal, off-white — matches the app palette
    particleCount: 160,
    particleSpread: 12,
    speed: 0.06,
    particleBaseSize: 70,
    sizeRandomness: 1,
    moveParticlesOnHover: true,
    particleHoverFactor: 0.4,
    alphaParticles: true,
    disableRotation: false,
    cameraDistance: 20,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
  });
}
// If the user prefers reduced motion, we simply skip mounting the animated
// background — the existing static ambient glow (in style.css) still shows.
