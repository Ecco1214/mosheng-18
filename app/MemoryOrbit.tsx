'use client';

import { useEffect, useRef } from 'react';

type MemoryParticle = { x: number; y: number; z: number; color: string; size: number };

export function MemoryOrbit({ imageSrc }: { imageSrc: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinchRef = useRef({ active: false, x: 50, y: 50 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const particles: MemoryParticle[] = [];
    const image = new Image();
    let frame = 0;
    let disposed = false;
    let rotationY = 0;
    let rotationX = -.08;
    let targetY = 0;
    let targetX = -.08;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const buildParticles = () => {
      const source = document.createElement('canvas');
      const sourceWidth = 190;
      const sourceHeight = Math.round(sourceWidth * image.height / Math.max(1, image.width));
      source.width = sourceWidth;
      source.height = sourceHeight;
      const sourceContext = source.getContext('2d');
      if (!sourceContext) return;
      sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
      const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
      const step = 2;
      for (let y = 0; y < sourceHeight; y += step) for (let x = 0; x < sourceWidth; x += step) {
        const offset = (y * sourceWidth + x) * 4;
        const alpha = pixels[offset + 3];
        if (alpha < 80) continue;
        const px = (x / sourceWidth - .5) * 2;
        const py = (y / sourceHeight - .5) * 2;
        const z = (Math.random() - .5) * .5 + (1 - Math.hypot(px, py)) * .16;
        particles.push({ x: px, y: py * 1.12, z, color: `rgb(${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]})`, size: .7 + Math.random() * .65 });
      }
      // Bound the point cloud on slower machines while preserving coverage.
      while (particles.length > 3600) particles.splice(Math.floor(Math.random() * particles.length), 1);
    };

    const draw = () => {
      if (disposed) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const input = pinchRef.current;
      if (input.active) {
        targetY += (input.x / 50 - 1) * .012;
        targetX += (input.y / 50 - 1) * .008;
        targetX = Math.max(-.65, Math.min(.65, targetX));
      } else {
        targetY += .0018;
        targetX += (-.08 - targetX) * .008;
      }
      rotationY += (targetY - rotationY) * .08;
      rotationX += (targetX - rotationX) * .08;
      ctx.fillStyle = 'rgba(0,0,0,.26)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      const cosY = Math.cos(rotationY); const sinY = Math.sin(rotationY);
      const cosX = Math.cos(rotationX); const sinX = Math.sin(rotationX);
      const scale = Math.min(width, height) * .31;
      particles.forEach((particle) => {
        const x1 = particle.x * cosY - particle.z * sinY;
        const z1 = particle.x * sinY + particle.z * cosY;
        const y1 = particle.y * cosX - z1 * sinX;
        const z2 = particle.y * sinX + z1 * cosX;
        const perspective = 1.55 / Math.max(.7, 1.9 - z2);
        const x = width / 2 + x1 * scale * perspective;
        const y = height * .52 + y1 * scale * perspective;
        const alpha = Math.max(.08, Math.min(.95, .35 + perspective * .38));
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(x, y, particle.size * perspective, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      frame = requestAnimationFrame(draw);
    };

    const onPinch = (event: Event) => {
      const detail = (event as CustomEvent<{ pinched: boolean; point: { x: number; y: number } }>).detail;
      pinchRef.current = { active: detail.pinched, x: detail.point.x, y: detail.point.y };
    };
    image.onload = () => { buildParticles(); resize(); draw(); };
    image.src = imageSrc;
    window.addEventListener('resize', resize);
    window.addEventListener('memory-pinch', onPinch);
    return () => { disposed = true; cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('memory-pinch', onPinch); };
  }, [imageSrc]);

  return <section className="memory-orbit-scene"><canvas ref={canvasRef} className="memory-orbit-canvas" aria-hidden="true" /><div className="memory-orbit-copy"><span>MEMORY ARCHIVE // 001</span><strong>PINCH TO ROTATE</strong><small>捏合手指  环绕查看这份记忆</small></div></section>;
}
