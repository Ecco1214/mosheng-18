'use client';

import { useEffect, useRef } from 'react';

// Particle motion, additive glow, ground rockets and synthesized explosion audio
// are adapted for MISSION 18 from https://github.com/travisjmac/grand-fireworks-js
// and https://github.com/michaelpersonal/gesture-fireworks.

type Point = { x: number; y: number };
type RGB = { r: number; g: number; b: number };
type Particle = Point & { vx: number; vy: number; color: RGB; size: number; initialSize: number; life: number; decay: number; gravity: number; flicker: boolean; trail: boolean };
type Spark = Point & { vx: number; vy: number; color: RGB; size: number; life: number; decay: number; gravity: number };
type Trail = Point & { color: RGB; size: number; life: number; decay: number };
type Rocket = Point & { vx: number; vy: number; gravity: number; color: RGB; palette: string[]; size: number; explodeY: number; ignition: number; ambient: boolean; trail: Array<Point & { life: number }> };
type TextParticle = Point & { tx: number; ty: number; vx: number; vy: number; life: number; size: number; delay: number; age: number; swirl: number };

const palettes = [
  ['#fff4b8', '#ffd166', '#ff9f1c', '#ff5d8f', '#ffffff'],
  ['#d7fbff', '#7df9ff', '#38bdf8', '#6366f1', '#ffffff'],
  ['#ffe4f3', '#ff8fab', '#f72585', '#b5179e', '#ffffff'],
  ['#dcfff7', '#72efdd', '#00c2a8', '#4cc9f0', '#ffffff'],
  ['#f0dcff', '#c77dff', '#7b2cbf', '#4361ee', '#ffffff'],
  ['#fff1dc', '#ffb4a2', '#e76f51', '#f4a261', '#ffffff'],
];

function toRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
}

function rgba(color: RGB, alpha: number) {
  return `rgba(${color.r},${color.g},${color.b},${Math.max(0, alpha)})`;
}

class FireworkEngine {
  particles: Particle[] = [];
  sparkles: Spark[] = [];
  trails: Trail[] = [];
  rockets: Rocket[] = [];
  textParticles: TextParticle[] = [];
  width = 1;
  height = 1;
  ambientFireworks = false;
  ambientCooldown = 0;

  isTextSettled() {
    return this.textParticles.length > 0 && this.textParticles.every((particle) =>
      particle.life >= 1 && Math.hypot(particle.tx - particle.x, particle.ty - particle.y) < 1 &&
      Math.hypot(particle.vx, particle.vy) < .1);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  ignite(x: number, y: number) {
    for (let i = 0; i < 24; i += 1) {
      this.sparkles.push({ x: x + (Math.random() - .5) * 18, y: y + Math.random() * 8, vx: (Math.random() - .5) * 3, vy: -Math.random() * 2, color: { r: 255, g: 170 + Math.random() * 85, b: 45 }, size: 1 + Math.random() * 2.4, life: .6 + Math.random() * .4, decay: .035 + Math.random() * .025, gravity: .05 });
    }
  }

  launchRocket(targetX: number, paletteIndex?: number, targetY?: number, ambient = false) {
    const palette = palettes[paletteIndex ?? Math.floor(Math.random() * palettes.length)];
    const color = toRgb(palette[Math.floor(Math.random() * palette.length)]);
    const x = targetX + (Math.random() - .5) * 70;
    const y = this.height - 18;
    const explodeY = targetY ?? Math.max(90, this.height * (.16 + Math.random() * .2));
    const gravity = ambient ? .028 : .042;
    const vy = -Math.sqrt(Math.max(1, 2 * gravity * (y - explodeY))) * 1.04;
    this.rockets.push({ x, y, vx: (Math.random() - .5) * (ambient ? .28 : .5), vy, gravity, color, palette, size: ambient ? 3.3 : 4.5, explodeY, ignition: ambient ? 22 : 12, ambient, trail: [] });
    this.ignite(x, y);
  }

  burst(x: number, y: number, intensity = 1, paletteIndex?: number) {
    const palette = palettes[paletteIndex ?? Math.floor(Math.random() * palettes.length)];
    const count = Math.min(320, Math.floor(170 + intensity * 115));
    const speed = 6.4 + intensity * 4.8;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI * 2 * i / count + (Math.random() - .5) * .7;
      const velocity = speed * (.28 + Math.random() * .72);
      const color = toRgb(palette[Math.floor(Math.random() * palette.length)]);
      const size = ambientSize(intensity);
      this.particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, color, size, initialSize: size, life: 1, decay: .0028 + Math.random() * .0024, gravity: .012 + Math.random() * .016, flicker: Math.random() > .7, trail: Math.random() > .32 });
    }
    for (let i = 0; i < 100; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 3 + Math.random() * 7;
      this.sparkles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, color: { r: 255, g: 255, b: 255 }, size: 1 + Math.random() * 2.2, life: 1, decay: .025 + Math.random() * .035, gravity: .025 });
    }
  }

  finale() {
    const positions = [[.18, .28], [.38, .18], [.62, .22], [.82, .3], [.5, .38]];
    positions.forEach(([x, y], index) => window.setTimeout(() => this.burst(this.width * x, this.height * y, 1.15, index % palettes.length), index * 150));
  }

  enableAmbientFireworks() {
    this.ambientFireworks = true;
    this.ambientCooldown = 110;
  }

  formText() {
    const probe = document.createElement('canvas');
    const probeContext = probe.getContext('2d');
    if (!probeContext) return;
    // Keep both lines at exactly the same size, but fit the longer line on
    // smaller windows instead of allowing the particle lettering to crop.
    const requestedFontSize = Math.min(160, this.width * .135);
    probe.width = Math.ceil(this.width); probe.height = Math.ceil(this.height);
    probeContext.fillStyle = '#fff';
    probeContext.textAlign = 'center'; probeContext.textBaseline = 'middle';
    // Restore the softer handwritten point-cloud style used in the earlier
    // reference, while keeping a stable fallback chain for other machines.
    probeContext.font = `700 ${requestedFontSize}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
    const longestLineWidth = probeContext.measureText('Happy Birthday!').width;
    const fontSize = Math.min(requestedFontSize, requestedFontSize * (this.width * .88) / Math.max(1, longestLineWidth));
    probeContext.font = `700 ${fontSize}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
    probeContext.fillText('Dear LYJ', this.width / 2, this.height * .39);
    probeContext.font = `700 ${fontSize}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
    probeContext.fillText('Happy Birthday!', this.width / 2, this.height * .61);
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
    this.textParticles = [];
    // Dense enough to make the letters solid, but bounded for smooth 60fps.
    const gap = Math.max(3, Math.floor(fontSize / 30));
    for (let y = 0; y < probe.height; y += gap) for (let x = 0; x < probe.width; x += gap) {
      if (pixels[(y * probe.width + x) * 4 + 3] > 80) {
        // Organic target jitter avoids a rigid computer-font grid while
        // preserving the clean dotted silhouette of the reference.
        const side = Math.floor(Math.random() * 4);
        const start = side === 0
          ? { x: -this.width * (.08 + Math.random() * .28), y: Math.random() * this.height }
          : side === 1
            ? { x: this.width * (1.08 + Math.random() * .28), y: Math.random() * this.height }
            : side === 2
              ? { x: Math.random() * this.width, y: -this.height * (.08 + Math.random() * .28) }
              : { x: Math.random() * this.width, y: this.height * (1.08 + Math.random() * .28) };
        const dx = x - start.x;
        const dy = y - start.y;
        const swirl = Math.random() > .5 ? 1 : -1;
        this.textParticles.push({ x: start.x, y: start.y, tx: x + (Math.random() - .5) * .7, ty: y + (Math.random() - .5) * .7, vx: dy * .0012 * swirl, vy: -dx * .0012 * swirl, life: 0, size: 1.45 + Math.random() * .55, delay: Math.random() * 68, age: 0, swirl });
      }
    }
  }

  update() {
    if (this.ambientFireworks) {
      this.ambientCooldown -= 1;
      if (this.ambientCooldown <= 0) {
        // Use separated high and low launch bands so the night sky keeps a
        // deliberate layered composition instead of clustering at one height.
        const bands = [.12, .2, .29, .38, .48];
        const band = bands[Math.floor(Math.random() * bands.length)];
        this.launchRocket(this.width * (.08 + Math.random() * .84), Math.floor(Math.random() * palettes.length), this.height * (band + (Math.random() - .5) * .045), true);
        this.ambientCooldown = 220 + Math.random() * 140;
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const rocket = this.rockets[i];
      if (rocket.ignition > 0) {
        rocket.ignition -= 1;
        if (Math.random() > .45) this.ignite(rocket.x, rocket.y);
        continue;
      }
      rocket.trail.push({ x: rocket.x, y: rocket.y, life: 1 });
      if (rocket.trail.length > 22) rocket.trail.shift();
      rocket.trail.forEach((trail) => { trail.life -= .07; });
      rocket.x += rocket.vx;
      rocket.y += rocket.vy;
      rocket.vy += rocket.gravity;
      if (Math.random() > .25) this.sparkles.push({ x: rocket.x + (Math.random() - .5) * 5, y: rocket.y + 4, vx: (Math.random() - .5) * 1.8, vy: 1.5 + Math.random() * 2.5, color: { r: 255, g: 220, b: 130 }, size: 1 + Math.random() * 1.8, life: .5, decay: .05, gravity: .08 });
      if (rocket.y <= rocket.explodeY || rocket.vy >= 0) {
        this.burst(rocket.x, rocket.y, rocket.ambient ? .72 : 1.15, palettes.indexOf(rocket.palette));
        this.rockets.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      if (particle.trail && particle.life > .3 && Math.random() > .45) this.trails.push({ x: particle.x, y: particle.y, color: particle.color, size: particle.size * .45, life: .55, decay: .055 });
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += particle.gravity;
      particle.vx *= .984;
      particle.vy *= .984;
      particle.life -= particle.decay;
      particle.size = particle.initialSize * (.25 + Math.max(0, particle.life) * .75);
      if (particle.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.sparkles.length - 1; i >= 0; i -= 1) {
      const spark = this.sparkles[i];
      spark.x += spark.vx; spark.y += spark.vy; spark.vy += spark.gravity; spark.vx *= .95; spark.vy *= .96; spark.life -= spark.decay;
      if (spark.life <= 0) this.sparkles.splice(i, 1);
    }
    for (let i = this.trails.length - 1; i >= 0; i -= 1) {
      const trail = this.trails[i]; trail.life -= trail.decay; trail.size *= .91;
      if (trail.life <= 0 || trail.size < .2) this.trails.splice(i, 1);
    }
    this.textParticles.forEach((particle) => {
      particle.age += 1;
      if (particle.age < particle.delay) return;
      particle.vx += (particle.tx - particle.x) * .0022;
      particle.vy += (particle.ty - particle.y) * .0022;
      const swirlForce = Math.min(1, Math.hypot(particle.tx - particle.x, particle.ty - particle.y) / 260) * .018 * particle.swirl;
      particle.vx += (particle.ty - particle.y) * swirlForce * .001;
      particle.vy -= (particle.tx - particle.x) * swirlForce * .001;
      particle.vx *= .955;
      particle.vy *= .955;
      particle.x += particle.vx; particle.y += particle.vy; particle.life = Math.min(1, particle.life + .018);
    });
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.textParticles.length ? .34 : 1;
    this.rockets.forEach((rocket) => {
      if (rocket.ignition > 0) {
        const glow = ctx.createRadialGradient(rocket.x, rocket.y, 0, rocket.x, rocket.y, 32);
        glow.addColorStop(0, 'rgba(255,220,90,.9)'); glow.addColorStop(.45, 'rgba(255,90,0,.4)'); glow.addColorStop(1, 'rgba(255,50,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(rocket.x, rocket.y, 32, 0, Math.PI * 2); ctx.fill();
      } else {
        rocket.trail.forEach((trail, index) => { ctx.fillStyle = rgba(rocket.color, trail.life * .85); ctx.beginPath(); ctx.arc(trail.x, trail.y, 1.5 + 4 * index / Math.max(1, rocket.trail.length), 0, Math.PI * 2); ctx.fill(); });
      }
      const glow = ctx.createRadialGradient(rocket.x, rocket.y, 0, rocket.x, rocket.y, 22);
      glow.addColorStop(0, '#fff'); glow.addColorStop(.25, rgba(rocket.color, .9)); glow.addColorStop(1, rgba(rocket.color, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(rocket.x, rocket.y, 22, 0, Math.PI * 2); ctx.fill();
    });
    this.trails.forEach((trail) => { ctx.fillStyle = rgba(trail.color, trail.life * .55); ctx.beginPath(); ctx.arc(trail.x, trail.y, trail.size, 0, Math.PI * 2); ctx.fill(); });
    this.particles.forEach((particle) => {
      const alpha = particle.life * (particle.flicker ? .72 + Math.random() * .28 : 1);
      // Keep the bright core as a single cheap draw call. The former
      // per-particle radial gradients made dense text look cloudy and slow.
      ctx.fillStyle = rgba(particle.color, alpha * .48);
      ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, alpha);
      ctx.beginPath(); ctx.arc(particle.x, particle.y, Math.max(.75, particle.size * .52), 0, Math.PI * 2); ctx.fill();
      if (particle.trail && particle.life > .18) {
        ctx.strokeStyle = rgba(particle.color, alpha * .62);
        ctx.lineWidth = Math.max(.7, particle.size * .42);
        ctx.beginPath(); ctx.moveTo(particle.x, particle.y); ctx.lineTo(particle.x - particle.vx * .9, particle.y - particle.vy * .9); ctx.stroke();
      }
    });
    this.sparkles.forEach((spark) => { ctx.fillStyle = rgba(spark.color, spark.life); ctx.beginPath(); ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    this.textParticles.forEach((particle) => {
      // Keep the halo very restrained so adjacent dots stay crisp and
      // readable instead of merging into a cloudy blob.
      ctx.globalAlpha = particle.life * .06;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = particle.life;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function ambientSize(intensity: number) {
  return intensity < 1 ? 2.1 + Math.random() * 3.4 : 2.8 + Math.random() * 5.2;
}

function playExplosion() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume();
    const length = Math.floor(context.sampleRate * .34);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * .13));
    const source = context.createBufferSource(); source.buffer = buffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(2600, context.currentTime); filter.frequency.exponentialRampToValueAtTime(180, context.currentTime + .32);
    const gain = context.createGain(); gain.gain.setValueAtTime(.22, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .34);
    source.connect(filter).connect(gain).connect(context.destination); source.start();
    window.setTimeout(() => void context.close(), 500);
  } catch { /* 音频不可用时不影响视觉。 */ }
}

export function FireworksCanvas({ shots, onComplete }: { shots: number; onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FireworkEngine | null>(null);
  const previousShotsRef = useRef(shots);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const engine = new FireworkEngine();
    engineRef.current = engine;
    let frame = 0;
    let lastFrame = 0;
    let accumulated = 0;
    let holdTimer: number | undefined;
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio)); canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0); engine.resize(rect.width, rect.height);
    };
    const animate = (now = performance.now()) => {
      accumulated += lastFrame ? Math.min(50, now - lastFrame) : 1000 / 60;
      lastFrame = now;
      // Keep the intended 60 Hz motion speed on both 60 Hz and 120/144 Hz displays.
      while (accumulated >= 1000 / 60) {
        engine.update();
        accumulated -= 1000 / 60;
      }
      context.fillStyle = 'rgba(0,0,0,.24)'; context.fillRect(0, 0, engine.width, engine.height);
      engine.draw(context);
      // Start the brief reading hold only once both lines have settled.
      // This follows the actual animation even on a slower display or device.
      if (holdTimer === undefined && engine.isTextSettled()) {
        holdTimer = window.setTimeout(() => onCompleteRef.current(), 4000);
      }
      frame = window.requestAnimationFrame(animate);
    };
    resize(); window.addEventListener('resize', resize); animate();
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(holdTimer); window.removeEventListener('resize', resize); engineRef.current = null; };
  }, []);

  useEffect(() => {
    if (shots <= previousShotsRef.current) { previousShotsRef.current = shots; return; }
    previousShotsRef.current = shots;
    const engine = engineRef.current;
    if (!engine) return;
    const launchPositions = [.21, .36, .52, .68, .82];
    const launchHeights = [.28, .17, .34, .22, .12];
    engine.launchRocket(engine.width * launchPositions[shots - 1], shots - 1, engine.height * launchHeights[shots - 1]);
    window.setTimeout(playExplosion, 1250);
    if (shots === 5) window.setTimeout(() => {
      engine.enableAmbientFireworks();
      engine.finale();
      playExplosion();
      window.setTimeout(() => engine.formText(), 1800);
    }, 1800);
  }, [shots]);

  return <canvas ref={canvasRef} className="gesture-fireworks-canvas" aria-hidden="true" />;
}
