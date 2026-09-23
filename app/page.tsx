'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FireworksCanvas } from './FireworksCanvas';
import { containedImagePointToViewport, UpFlickDetector, viewportPointToContainedImage } from './gestureStability';
import { siteConfig } from './siteConfig';

type Scene = 'start' | 'intro-video' | 'lobby' | 'ranked-lobby' | 'training-countdown' | 'training-tutorial' | 'training-shoot-tutorial' | 'training-ready' | 'training-enemy' | 'training-intermission' | 'training-ace' | 'party' | 'match-found' | 'loading' | 'calibration' | 'game' | 'ace' | 'secret' | 'gesture-gate' | 'surprise' | 'fireworks' | 'messages';
type InputMode = 'hand' | 'pointer';
type HandStatus = 'idle' | 'loading' | 'ready' | 'gun-pose' | 'fist-pose' | 'palm-pose' | 'permission-denied' | 'unsupported' | 'error';
type Point = { x: number; y: number };
type ShotEffect = { id: number; from: Point; to: Point; angle: number };
type HandDetector = { detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: Point[][] }; close?: () => void };
type VisionRuntime = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  HandLandmarker: { createFromOptions: (fileset: unknown, options: Record<string, unknown>) => Promise<HandDetector> };
};

const POST_ACE_PREVIEW = false;

const targets = [
  { x: 52, y: 38, delay: 250, label: 'TARGET 01' },
  { x: 30, y: 42, delay: 500, label: 'TARGET 02' },
  { x: 73, y: 34, delay: 600, label: 'TARGET 03' },
  { x: 43, y: 31, delay: 450, label: 'TARGET 04' },
  { x: 62, y: 27, delay: 700, label: 'TARGET 05' },
] as const;

const trainingScenes = [
  '/assets/training/scene-1.png',
  '/assets/training/scene-2.png',
  '/assets/training/scene-3.png',
  '/assets/training/scene-4.png',
  '/assets/training/scene-5.png',
  '/assets/training/scene-6.png',
] as const;

const TRAINING_IMAGE_ASPECT = 2388 / 1668;
const TRAINING_COUNTDOWN_SECONDS = 5;

const killAnnouncements = ['FIRST BLOOD', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL'] as const;

// Head centers are authored against the supplied 2388 x 1668 screenshots.
// The image itself scales responsively, so these remain aligned in fullscreen.
const trainingHeadshots = [
  { x: 45.2, y: 41.4 },
  { x: 40.0, y: 46.5 },
  { x: 60.5, y: 40.7 },
  { x: 69.8, y: 46.1 },
  { x: 23.4, y: 49.2 },
] as const;

const messages = [
  '山高路远 愿你此去一帆风顺',
  '某天你想起来 我永远在你的18岁',
  '顺颂时祺 盼君常安',
] as const;

const preludeMessage = [
  'XX',
  '愿你永远聪慧果敢 勇敢坚定',
  '不要因为任何人的看法停下自己的脚步',
  '也不要因为现实而放弃自己内心的渴望',
  '或许成长会伴随告别与遗憾',
  '但请相信',
  '总有人喜欢你 因为你仅仅是你 这世上独一无二的你',
  '愿你我 都拥有光明的未来',
].join('\n');

function Avatar({ src, initials, className = '' }: { src: string; initials: string; className?: string }) {
  return (
    <div className={`avatar ${className}`}>
      <span>{initials}</span>
      {/* 素材不存在时自动保留字母占位。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
    </div>
  );
}

function HandController({
  active,
  gestureMode = 'gun',
  onAim,
  onShot,
  onStatus,
  onOpenPalm,
  onPalmProgress,
  palmHoldMs = 260,
  requireClosedPalmTransition = false,
  onSwipe,
  onPinch,
}: {
  active: boolean;
  gestureMode?: 'gun' | 'palm' | 'swipe' | 'pinch';
  onAim: (point: Point) => void;
  onShot: (point?: Point) => void;
  onStatus: (status: HandStatus) => void;
  onOpenPalm?: () => void;
  onPalmProgress?: (progress: number) => void;
  palmHoldMs?: number;
  requireClosedPalmTransition?: boolean;
  onSwipe?: () => void;
  onPinch?: (pinched: boolean, point: Point) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<HandDetector | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const previousTipRef = useRef<Point | null>(null);
  const stablePoseFramesRef = useRef(0);
  const lastGunPoseAtRef = useRef(0);
  const upFlickDetectorRef = useRef(new UpFlickDetector());
  const lastGestureAtRef = useRef(0);
  const palmStartedAtRef = useRef(0);
  const closedPalmFramesRef = useRef(0);
  const palmWasClosedRef = useRef(false);
  const controlsRef = useRef({ gestureMode, onAim, onShot, onStatus, onOpenPalm, onPalmProgress, palmHoldMs, requireClosedPalmTransition, onSwipe, onPinch });

  useEffect(() => {
    controlsRef.current = { gestureMode, onAim, onShot, onStatus, onOpenPalm, onPalmProgress, palmHoldMs, requireClosedPalmTransition, onSwipe, onPinch };
  }, [gestureMode, onAim, onOpenPalm, onPalmProgress, onPinch, onShot, onStatus, onSwipe, palmHoldMs, requireClosedPalmTransition]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const upFlickDetector = upFlickDetectorRef.current;

    async function start() {
      controlsRef.current.onStatus('loading');
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          controlsRef.current.onStatus('unsupported');
          return;
        }
        const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, label: string) => Promise.race([
          promise,
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)),
        ]);
        const moduleUrl = '/vendor/mediapipe/vision_bundle.mjs';
        const browserImport = new Function('url', 'return import(url)') as (url: string) => Promise<VisionRuntime>;
        const vision = await withTimeout(browserImport(moduleUrl), 10000, 'MediaPipe module');
        const fileset = await withTimeout(
          vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm'),
          12000,
          'MediaPipe WASM',
        );
        const detectorOptions = {
          baseOptions: {
            modelAssetPath: '/vendor/mediapipe/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5,
        };
        let detector;
        try {
          detector = await withTimeout(vision.HandLandmarker.createFromOptions(fileset, {
            ...detectorOptions,
            baseOptions: { ...detectorOptions.baseOptions, delegate: 'GPU' },
          }), 18000, 'MediaPipe GPU detector');
        } catch {
          detector = await withTimeout(
            vision.HandLandmarker.createFromOptions(fileset, detectorOptions),
            18000,
            'MediaPipe CPU detector',
          );
        }
        if (disposed) {
          detector.close?.();
          return;
        }
        detectorRef.current = detector;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        streamRef.current = stream;
        if (!videoRef.current || disposed) { stream.getTracks().forEach(track => track.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        controlsRef.current.onStatus('ready');
        tick();
      } catch (error) {
        console.error('Hand tracking initialization failed', error);
        if (!disposed) {
          const errorName = error instanceof DOMException ? error.name : '';
          controlsRef.current.onStatus(errorName === 'NotAllowedError' || errorName === 'SecurityError' ? 'permission-denied' : 'error');
        }
      }
    }

    function distance(a: Point, b: Point) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function tick() {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (disposed || !video || !detector) return;

      if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const result = detector.detectForVideo(video, performance.now());
        const landmarks = result.landmarks?.[0];
        if (landmarks && landmarks.length >= 21) {
          const indexTip = landmarks[8];
          const indexMcp = landmarks[5];
          const indexPip = landmarks[6];
           const wrist = landmarks[0];
           const middleMcp = landmarks[9];
          const curled = [12, 16, 20].filter((tipIndex, finger) => {
            const pipIndex = [10, 14, 18][finger];
            return distance(landmarks[tipIndex], wrist) < distance(landmarks[pipIndex], wrist) * 1.12;
          }).length;
          const indexExtended = distance(indexTip, indexMcp) > distance(indexPip, indexMcp) * 1.42;
          const gunPose = indexExtended && curled >= 2;
           const openPalm = indexExtended && curled === 0;
           const closedPalm = !indexExtended && curled >= 3;
           const pinched = distance(landmarks[4], indexTip) < distance(wrist, middleMcp) * .42;
           const { gestureMode: currentMode } = controlsRef.current;
           const activePose = currentMode === 'palm' ? openPalm : currentMode === 'swipe' ? Boolean(landmarks[8]) : currentMode === 'pinch' ? pinched : gunPose;
          stablePoseFramesRef.current = activePose ? Math.min(12, stablePoseFramesRef.current + 1) : 0;

          const point = {
            x: Math.max(2, Math.min(98, (1 - indexTip.x) * 100)),
            y: Math.max(3, Math.min(97, indexTip.y * 100)),
          };
          const frameNow = performance.now();
          if (gunPose) lastGunPoseAtRef.current = frameNow;
          const gunPoseTracked = (gunPose && stablePoseFramesRef.current >= 3) || (!gunPose && lastGunPoseAtRef.current > 0 && frameNow - lastGunPoseAtRef.current <= 100);
          const palmSize = Math.max(.04, distance(wrist, middleMcp));
          const fingerRelative = { x: (indexTip.x - indexMcp.x) / palmSize, y: (indexTip.y - indexMcp.y) / palmSize };
          const flick = currentMode === 'gun'
            ? upFlickDetector.update(point, frameNow, gunPoseTracked, fingerRelative)
            : { point, shotPoint: null };
          controlsRef.current.onAim(flick.point);

           if (currentMode === 'palm') {
            closedPalmFramesRef.current = closedPalm ? Math.min(12, closedPalmFramesRef.current + 1) : 0;
            if (closedPalmFramesRef.current >= 3) palmWasClosedRef.current = true;
            controlsRef.current.onStatus(openPalm ? 'palm-pose' : closedPalm ? 'fist-pose' : 'ready');
            if (controlsRef.current.requireClosedPalmTransition) {
              controlsRef.current.onPalmProgress?.(0);
              if (openPalm && stablePoseFramesRef.current >= 3 && palmWasClosedRef.current && frameNow - lastGestureAtRef.current > 420) {
                palmWasClosedRef.current = false;
                lastGestureAtRef.current = frameNow;
                controlsRef.current.onOpenPalm?.();
              }
            } else if (openPalm && stablePoseFramesRef.current >= 3) {
              if (!palmStartedAtRef.current) palmStartedAtRef.current = frameNow;
              const progress = Math.min(1, (frameNow - palmStartedAtRef.current) / controlsRef.current.palmHoldMs);
              controlsRef.current.onPalmProgress?.(progress);
              if (progress >= 1 && controlsRef.current.onOpenPalm && frameNow - lastGestureAtRef.current > controlsRef.current.palmHoldMs) {
                lastGestureAtRef.current = frameNow;
                palmStartedAtRef.current = 0;
                controlsRef.current.onPalmProgress?.(0);
                controlsRef.current.onOpenPalm();
              }
            } else {
              palmStartedAtRef.current = 0;
              controlsRef.current.onPalmProgress?.(0);
            }
           } else if (currentMode === 'pinch') {
             controlsRef.current.onStatus(pinched ? 'ready' : 'ready');
             controlsRef.current.onPinch?.(pinched, point);
           } else if (currentMode === 'swipe') {
            controlsRef.current.onStatus('ready');
            const previous = previousTipRef.current;
            const now = performance.now();
            if (previous && point.x - previous.x > 8 && now - lastGestureAtRef.current > 900) {
              lastGestureAtRef.current = now;
              controlsRef.current.onSwipe?.();
            }
          } else if (gunPoseTracked) {
            controlsRef.current.onStatus('gun-pose');
            if (flick.shotPoint) controlsRef.current.onShot(flick.shotPoint);
          } else {
            controlsRef.current.onStatus('ready');
          }
          previousTipRef.current = point;
        } else {
          lastGunPoseAtRef.current = 0;
          stablePoseFramesRef.current = 0;
          closedPalmFramesRef.current = 0;
          palmStartedAtRef.current = 0;
          controlsRef.current.onPalmProgress?.(0);
          upFlickDetector.reset();
          controlsRef.current.onStatus('ready');
        }
      }
      animationRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      disposed = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      detectorRef.current?.close?.();
      detectorRef.current = null;
      palmStartedAtRef.current = 0;
      closedPalmFramesRef.current = 0;
      palmWasClosedRef.current = false;
      upFlickDetector.reset();
    };
  }, [active]);

  if (!active) return null;
  return (
    <div className="camera-preview is-hidden" aria-hidden="true">
      <video ref={videoRef} playsInline muted aria-label="本机手势识别预览" />
    </div>
  );
}

export default function Home() {
  const [scene, setScene] = useState<Scene>(POST_ACE_PREVIEW ? 'ace' : 'start');
  const [inviteVisible, setInviteVisible] = useState(false);
  const [countdown, setCountdown] = useState<number>(siteConfig.timings.matchmakingSeconds);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>('hand');
  const [handEnabled, setHandEnabled] = useState(false);
  const [handStatus, setHandStatus] = useState<HandStatus>('idle');
  const [aim, setAim] = useState<Point>({ x: 50, y: 50 });
  const aimRef = useRef<Point>(aim);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const [targetIndex, setTargetIndex] = useState(POST_ACE_PREVIEW ? targets.length - 1 : 0);
  const [targetVisible, setTargetVisible] = useState(false);
  const [impact, setImpact] = useState(false);
  const [misses, setMisses] = useState(0);
  const [fireworkShots, setFireworkShots] = useState(0);
  const [trainingEnemyIndex, setTrainingEnemyIndex] = useState(0);
  const [trainingKills, setTrainingKills] = useState(0);
  const [trainingImpact, setTrainingImpact] = useState(false);
  const [trainingShotEffect, setTrainingShotEffect] = useState<ShotEffect | null>(null);
  const [trainingCountdown, setTrainingCountdown] = useState(TRAINING_COUNTDOWN_SECONDS);
  const [palmProgress, setPalmProgress] = useState(0);
  const hitLockRef = useRef(false);

  const enterExperience = useCallback(() => {
    try {
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch { /* 全屏被浏览器拒绝时继续使用窗口模式。 */ }
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        void context.resume().then(() => context.close()).catch(() => undefined);
      }
    } catch { /* 浏览器没有音频权限时保持静默。 */ }
    const intro = introVideoRef.current;
    if (intro) {
      intro.currentTime = 0;
      intro.muted = false;
      void intro.play().catch(() => undefined);
    }
    setScene('intro-video');
  }, []);

  const setAimPoint = useCallback((point: Point) => {
    aimRef.current = point;
    setAim(point);
  }, []);

  useEffect(() => {
    if (scene !== 'lobby') return;
    const timer = window.setTimeout(() => setInviteVisible(true), siteConfig.timings.inviteDelayMs);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'party') return;
    const interval = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          window.setTimeout(() => setScene('match-found'), 250);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'match-found') return;
    const timer = window.setTimeout(() => {
      setLoadingProgress(0);
      setScene('loading');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'loading') return;
    const started = performance.now();
    const duration = siteConfig.timings.loadingSeconds * 1000;
    const interval = window.setInterval(() => {
      const progress = Math.min(100, ((performance.now() - started) / duration) * 100);
      setLoadingProgress(progress);
      if (progress >= 100) {
        window.clearInterval(interval);
        window.setTimeout(() => {
          setTargetVisible(false);
          setScene('calibration');
        }, 350);
      }
    }, 80);
    return () => window.clearInterval(interval);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'ace') return;
    const timer = window.setTimeout(() => setScene('secret'), 3200);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'secret') return;
    const timer = window.setTimeout(() => setScene('gesture-gate'), 2800);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'surprise') return;
    const timer = window.setTimeout(() => setScene('fireworks'), 1800);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (scene !== 'training-countdown') return;
    const deadline = performance.now() + TRAINING_COUNTDOWN_SECONDS * 1000;
    const interval = window.setInterval(() => {
      const remaining = Math.max(1, Math.ceil((deadline - performance.now()) / 1000));
      setTrainingCountdown(remaining);
    }, 100);
    const timer = window.setTimeout(() => setScene('training-tutorial'), TRAINING_COUNTDOWN_SECONDS * 1000);
    return () => { window.clearInterval(interval); window.clearTimeout(timer); };
  }, [scene]);

  useEffect(() => {
    if (scene !== 'training-tutorial' || handStatus !== 'gun-pose') return;
    const timer = window.setTimeout(() => setScene('training-shoot-tutorial'), 850);
    return () => window.clearTimeout(timer);
  }, [handStatus, scene]);


  useEffect(() => {
    if (scene !== 'game') return;
    const delay = targets[targetIndex]?.delay ?? 300;
    const timer = window.setTimeout(() => setTargetVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [scene, targetIndex]);

  const playShotSound = useCallback((hit: boolean) => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      void context.resume();
      const crack = (offset: number) => {
        const start = context.currentTime + offset;
        const length = Math.floor(context.sampleRate * .075);
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < length; index += 1) {
          data[index] = (Math.random() * 2 - 1) * Math.exp(-index / (length * .12));
        }
        const noise = context.createBufferSource();
        noise.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(hit ? 2300 : 1750, start);
        filter.Q.setValueAtTime(1.15, start);
        const noiseGain = context.createGain();
        noiseGain.gain.setValueAtTime(hit ? .16 : .11, start);
        noiseGain.gain.exponentialRampToValueAtTime(.001, start + .075);
        noise.connect(filter).connect(noiseGain).connect(context.destination);
        noise.start(start);

        const click = context.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(hit ? 1850 : 1250, start);
        click.frequency.exponentialRampToValueAtTime(420, start + .045);
        const clickGain = context.createGain();
        clickGain.gain.setValueAtTime(.075, start);
        clickGain.gain.exponentialRampToValueAtTime(.001, start + .052);
        click.connect(clickGain).connect(context.destination);
        click.start(start);
        click.stop(start + .055);
      };
      crack(0);
      if (hit) crack(.065);
      window.setTimeout(() => void context.close(), 320);
    } catch { /* 声音被浏览器阻止时保持静默。 */ }
  }, []);

  const shoot = useCallback((shotPoint?: Point) => {
    if (scene !== 'game' || !targetVisible || hitLockRef.current) return;
    const target = targets[targetIndex];
    if (!target) return;
    const point = shotPoint ?? aimRef.current;
    const hit = Math.hypot(point.x - target.x, (point.y - target.y) * 1.35) < 7.2;
    playShotSound(hit);
    if (!hit) {
      setMisses((value) => value + 1);
      return;
    }
    hitLockRef.current = true;
    setImpact(true);
    window.setTimeout(() => {
      setImpact(false);
      setTargetVisible(false);
      if (targetIndex >= targets.length - 1) {
        setScene('ace');
      } else {
        setTargetIndex((value) => value + 1);
      }
      hitLockRef.current = false;
    }, 430);
  }, [playShotSound, scene, targetIndex, targetVisible]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (scene !== 'game' || inputMode !== 'pointer') return;
    const rect = event.currentTarget.getBoundingClientRect();
    setAimPoint({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }, [inputMode, scene, setAimPoint]);

  const startSurprise = useCallback(() => setScene('surprise'), []);
  const enableHandTracking = useCallback(() => {
    setHandStatus('loading');
    setInputMode('hand');
    setHandEnabled(true);
  }, []);
  const launchFirework = useCallback(() => setFireworkShots((value) => Math.min(5, value + 1)), []);

  const startRankedTraining = useCallback(() => {
    setTrainingEnemyIndex(0);
    setTrainingKills(0);
    setTrainingImpact(false);
    setTrainingShotEffect(null);
    setTrainingCountdown(TRAINING_COUNTDOWN_SECONDS);
    setInputMode('hand');
    setHandEnabled(true);
    setScene('training-countdown');
  }, []);

  const trainingShot = useCallback((shotPoint?: Point) => {
    if (scene === 'training-tutorial') {
      setScene('training-shoot-tutorial');
      return;
    }
    if (scene === 'training-shoot-tutorial') {
      if (hitLockRef.current) return;
      hitLockRef.current = true;
      const from = containedImagePointToViewport({ x: 66.2, y: 65.2 }, window.innerWidth, window.innerHeight, TRAINING_IMAGE_ASPECT);
      const to = shotPoint ?? aimRef.current;
      const angle = Math.atan2((to.y - from.y) * window.innerHeight, (to.x - from.x) * window.innerWidth) * 180 / Math.PI;
      const tutorialShot = { id: performance.now(), from, to, angle };
      setTrainingShotEffect(tutorialShot);
      playShotSound(true);
      window.setTimeout(() => setTrainingShotEffect((current) => current?.id === tutorialShot.id ? null : current), 430);
      window.setTimeout(() => {
        hitLockRef.current = false;
        setScene('training-ready');
        window.setTimeout(() => setScene('training-enemy'), 1400);
      }, 460);
      return;
    }
    if (scene !== 'training-enemy' || hitLockRef.current) return;
    const head = trainingHeadshots[trainingEnemyIndex];
    const point = shotPoint ?? aimRef.current;
    const imagePoint = viewportPointToContainedImage(point, window.innerWidth, window.innerHeight, TRAINING_IMAGE_ASPECT);
    const hit = Math.hypot(imagePoint.x - head.x, (imagePoint.y - head.y) * 1.25) < 6.2;
    playShotSound(hit);
    if (!hit) return;
    hitLockRef.current = true;
    const from = containedImagePointToViewport({ x: 66.2, y: 65.2 }, window.innerWidth, window.innerHeight, TRAINING_IMAGE_ASPECT);
    const to = containedImagePointToViewport(head, window.innerWidth, window.innerHeight, TRAINING_IMAGE_ASPECT);
    const angle = Math.atan2((to.y - from.y) * window.innerHeight, (to.x - from.x) * window.innerWidth) * 180 / Math.PI;
    const shotEffect = { id: performance.now(), from, to, angle };
    setTrainingShotEffect(shotEffect);
    window.setTimeout(() => setTrainingImpact(true), 150);
    window.setTimeout(() => setTrainingShotEffect((current) => current?.id === shotEffect.id ? null : current), 430);
    const nextKills = trainingKills + 1;
    setTrainingKills(nextKills);
    window.setTimeout(() => {
      setTrainingImpact(false);
      if (nextKills >= 5) {
        setScene('training-ace');
        hitLockRef.current = false;
        window.setTimeout(() => setScene('secret'), 2700);
        return;
      }
      setScene('training-intermission');
      window.setTimeout(() => {
        setTrainingEnemyIndex((value) => value + 1);
        setScene('training-enemy');
        hitLockRef.current = false;
      }, 2000);
    }, 360);
  }, [playShotSound, scene, trainingEnemyIndex, trainingKills]);

  return (
    <main className={`experience-shell scene-${scene}`} onPointerMove={onPointerMove} onPointerDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (inputMode === 'pointer' && scene === 'game') shoot();
      if (inputMode === 'pointer' && ['training-tutorial', 'training-shoot-tutorial', 'training-enemy'].includes(scene)) trainingShot();
      if (scene === 'gesture-gate') startSurprise();
      if (scene === 'fireworks') launchFirework();
    }}>
      <video ref={introVideoRef} className={`intro-video intro-video-persistent ${scene === 'intro-video' ? 'is-visible' : ''}`} src={siteConfig.assets.introVideo} playsInline preload="auto" controls={false} controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture onEnded={() => setScene('lobby')} onContextMenu={(event) => event.preventDefault()} aria-hidden={scene !== 'intro-video'} />
      {scene === 'start' && <StartScreen onEnter={enterExperience} />}
      {scene === 'lobby' && <RecordedLobbyScene onStartRanked={() => setScene('ranked-lobby')} />}
      {scene === 'ranked-lobby' && <RankedLobbyScene onStart={startRankedTraining} />}
      {['training-countdown', 'training-tutorial', 'training-shoot-tutorial', 'training-ready', 'training-enemy', 'training-intermission', 'training-ace'].includes(scene) && <TrainingScene scene={scene} aim={aim} inputMode={inputMode} handStatus={handStatus} countdown={trainingCountdown} enemyIndex={trainingEnemyIndex} kills={trainingKills} impact={trainingImpact} shotEffect={trainingShotEffect} onPointerShot={trainingShot} />}
      {(scene === 'party' || scene === 'match-found') && (
        <LobbyBackdrop scene={scene} inviteVisible={inviteVisible} countdown={countdown} onAccept={() => { setInviteVisible(false); setCountdown(siteConfig.timings.matchmakingSeconds); setScene('party'); }} />
      )}

      {scene === 'loading' && <LoadingScene progress={loadingProgress} />}

      {(scene === 'calibration' || scene === 'game' || scene === 'ace') && (
        <GameScene
          scene={scene}
          aim={aim}
          targetIndex={targetIndex}
          targetVisible={targetVisible}
          impact={impact}
          misses={misses}
          inputMode={inputMode}
          handStatus={handStatus}
          onChooseHand={enableHandTracking}
          onChoosePointer={() => { setInputMode('pointer'); setTargetVisible(false); setScene('game'); }}
          onStartHand={() => { setTargetVisible(false); setScene('game'); }}
        />
      )}

      {scene === 'secret' && <SecretUnlockScene />}
      {scene === 'gesture-gate' && <GestureGateScene handEnabled={handEnabled} handStatus={handStatus} progress={palmProgress} onEnableHand={enableHandTracking} onActivate={startSurprise} />}
      {scene === 'surprise' && <SurpriseTransition />}
      {scene === 'fireworks' && <FireworksScene shots={fireworkShots} onLaunch={launchFirework} onComplete={() => setScene('messages')} />}
      {scene === 'messages' && <MessageScene />}

      <HandController
        active={handEnabled && inputMode === 'hand' && !['start', 'intro-video', 'lobby', 'ranked-lobby', 'messages'].includes(scene)}
        gestureMode={scene === 'gesture-gate' || scene === 'fireworks' ? 'palm' : 'gun'}
        onAim={setAimPoint}
        onShot={scene === 'fireworks' ? launchFirework : ['training-shoot-tutorial', 'training-enemy'].includes(scene) ? trainingShot : shoot}
        onStatus={setHandStatus}
        onOpenPalm={scene === 'gesture-gate' ? startSurprise : scene === 'fireworks' ? launchFirework : undefined}
        onPalmProgress={scene === 'gesture-gate' ? setPalmProgress : undefined}
        palmHoldMs={scene === 'gesture-gate' ? 2000 : 260}
        requireClosedPalmTransition={scene === 'fireworks'}
      />
    </main>
  );
}

function StartScreen({ onEnter }: { onEnter: () => void }) {
  return <section className="start-screen">
    <div className="start-grid" aria-hidden="true" />
    <div className="start-scan" aria-hidden="true" />
    <div className="start-copy"><span>PRIVATE SESSION</span><h1>MISSION <b>18</b></h1><p>专属行动档案已就绪</p></div>
    <button className="start-button" onClick={onEnter}>点击进入全屏</button>
    <p className="start-hint">建议佩戴耳机并使用电脑体验</p>
    <div className="start-options"><span>声音 开启</span><span>全屏将在进入时请求</span></div>
  </section>;
}

function RecordedLobbyScene({ onStartRanked }: { onStartRanked: () => void }) {
  return <section className="recorded-lobby-scene">
    <video className="recorded-lobby-fill" src={siteConfig.assets.lobbyVideo} autoPlay muted loop playsInline aria-hidden="true" />
    <div className="recorded-lobby-media">
      <video className="recorded-lobby-video" src={siteConfig.assets.lobbyVideo} autoPlay muted loop playsInline controls={false} controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture onContextMenu={(event) => event.preventDefault()} />
      <button className="ranked-start-hotspot" type="button" aria-label="开始排位" onClick={onStartRanked}><span>开始排位</span></button>
    </div>
  </section>;
}

function RankedLobbyScene({ onStart }: { onStart: () => void }) {
  return <section className="ranked-lobby-scene">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="ranked-lobby-fill" src={siteConfig.assets.rankedLobbyScreen} alt="" aria-hidden="true" />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="ranked-lobby-image" src={siteConfig.assets.rankedLobbyScreen} alt="排位队伍界面" />
    <button className="ranked-screen-start" type="button" onClick={onStart} aria-label="开始排位" />
  </section>;
}

function TrainingScene({ scene, aim, inputMode, handStatus, countdown, enemyIndex, kills, impact, shotEffect, onPointerShot }: {
  scene: Scene;
  aim: Point;
  inputMode: InputMode;
  handStatus: HandStatus;
  countdown: number;
  enemyIndex: number;
  kills: number;
  impact: boolean;
  shotEffect: ShotEffect | null;
  onPointerShot: (point?: Point) => void;
}) {
  const isEnemy = scene === 'training-enemy';
  const image = scene === 'training-countdown' || scene === 'training-ready'
    ? siteConfig.assets.rankedLobbyScreen
    : trainingScenes[isEnemy ? enemyIndex + 1 : 0];
  const title = scene === 'training-tutorial'
    ? '比出手枪姿势 保持稳定'
    : scene === 'training-shoot-tutorial'
      ? '食指快速上抬 试着开枪'
      : scene === 'training-ready'
        ? '正式开始'
        : scene === 'training-intermission'
          ? killAnnouncements[Math.max(0, Math.min(killAnnouncements.length - 1, kills - 1))]
          : isEnemy
            ? `目标 ${enemyIndex + 1} · 瞄准头部`
            : '';
  return <section className={`training-photo-scene training-stage-${scene}`} onPointerDown={(event) => {
    if (event.target === event.currentTarget) onPointerShot({ x: event.clientX / window.innerWidth * 100, y: event.clientY / window.innerHeight * 100 });
  }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="training-photo-fill" src={image} alt="" aria-hidden="true" />
    {scene === 'training-countdown' && <div className="training-countdown"><span>RANKED MATCH</span><strong key={countdown}>{countdown}</strong><small>准备进入训练场</small></div>}
    {scene !== 'training-countdown' && scene !== 'training-ready' && <Crosshair point={aim} active={handStatus === 'gun-pose' || inputMode === 'pointer'} />}
    {shotEffect && <div className="training-bullet-layer" aria-hidden="true">
      <i className="training-bullet training-bullet-one" style={{ left: `${shotEffect.from.x}%`, top: `${shotEffect.from.y}%`, '--bullet-to-x': `${shotEffect.to.x}%`, '--bullet-to-y': `${shotEffect.to.y}%`, '--bullet-angle': `${shotEffect.angle}deg` } as React.CSSProperties} />
      <i className="training-bullet training-bullet-two" style={{ left: `${shotEffect.from.x}%`, top: `${shotEffect.from.y}%`, '--bullet-to-x': `${shotEffect.to.x}%`, '--bullet-to-y': `${shotEffect.to.y}%`, '--bullet-angle': `${shotEffect.angle}deg` } as React.CSSProperties} />
      <b className="training-bullet-impact" style={{ left: `${shotEffect.to.x}%`, top: `${shotEffect.to.y}%` }} />
    </div>}
    {scene === 'training-ready' && <div className="training-ready-copy"><span>TRAINING PROTOCOL</span><strong>正式开始</strong></div>}
    {scene === 'training-tutorial' && <div className={`training-pose-lock ${handStatus === 'gun-pose' ? 'is-detecting' : ''}`}><span>{handStatus === 'gun-pose' ? 'GESTURE LOCKED' : 'WAITING FOR GESTURE'}</span><div><i /></div><small>{handStatus === 'gun-pose' ? '保持姿势 完成锁定' : '伸直食指与拇指 其余手指自然弯曲'}</small></div>}
    {title && scene !== 'training-ready' && <div className={`training-instruction ${scene === 'training-intermission' ? `training-kill-copy kill-tier-${kills}` : ''}`}><span>{scene === 'training-intermission' ? 'HEADSHOT CONFIRMED' : scene === 'training-enemy' ? `KILL ${enemyIndex + 1} / 5` : 'AIM CONTROL'}</span><strong data-text={scene === 'training-intermission' ? title : undefined}>{title}</strong>{scene === 'training-intermission' && <><small>ELIMINATION {String(kills).padStart(2, '0')} / 05</small><div className="kill-energy" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div></>}{scene === 'training-enemy' && <small>准心锁定红色描边的头部后 快速上抬食指</small>}</div>}
    {impact && <div className="training-hit-flash" aria-hidden="true"><span>HEADSHOT</span></div>}
    {scene === 'training-ace' && <div className="training-ace-copy"><span>FIVE TARGETS ELIMINATED</span><strong>ACE</strong><small>五杀完成</small></div>}
  </section>;
}

function LobbyBackdrop({ scene, inviteVisible, countdown, onAccept }: { scene: Scene; inviteVisible: boolean; countdown: number; onAccept: () => void }) {
  const party = scene === 'party' || scene === 'match-found';
  return (
    <>
      <div className="lobby-backdrop" style={{ backgroundImage: `linear-gradient(180deg, rgba(12,25,29,.08), rgba(4,10,14,.72)), url(${siteConfig.assets.lobbyBackground})` }} aria-hidden="true">
        <video className="lobby-video lobby-video-fill" src={siteConfig.assets.lobbyVideo} autoPlay muted loop playsInline controls={false} controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture onContextMenu={(event) => event.preventDefault()} />
        <video className="lobby-video lobby-video-main" src={siteConfig.assets.lobbyVideo} autoPlay muted loop playsInline controls={false} controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture onContextMenu={(event) => event.preventDefault()} />
        <div className="lobby-haze" /><div className="lobby-structure structure-one" /><div className="lobby-structure structure-two" /><div className="lobby-structure structure-three" /><div className="horizon-line" />
      </div>
      <Topbar label={party ? '队伍' : '大厅'} />
      {!party ? (
        <>
          <section className="lobby-player-overlay" aria-label="队伍玩家信息"><LobbyPlayer avatar={siteConfig.friend.avatar} initials={siteConfig.friend.initials} id={siteConfig.friend.id} level="291" status="在线" /></section>
          <section className="mode-panel"><p className="mode-kicker">私人频道已连接</p><h2>等待队友</h2><p>一场迟到的任务正在建立连接。</p><div className="mode-meta"><span>模式：特别行动</span><span>地图：未知</span></div></section>
          <aside className={`friend-invite ${inviteVisible ? 'is-visible' : ''}`} aria-live="polite">
            <div className="invite-accent" /><div className="invite-title-row"><span>好友组队邀请</span><span className="party-count">1/5</span></div>
            <div className="invite-player"><Avatar src={siteConfig.me.avatar} initials={siteConfig.me.initials} className="avatar-invite" /><div><strong>{siteConfig.me.id}</strong><small>{siteConfig.me.tag} · 邀请你加入队伍</small></div></div>
            <div className="invite-actions"><button className="accept-button" onPointerDown={(e) => e.stopPropagation()} onClick={onAccept}>接受组队</button><button className="decline-button">稍后</button></div>
          </aside>
        </>
      ) : (
        <section className="party-room">
          <div className="party-heading"><span>PRIVATE PARTY</span><h1>特别行动</h1><p>队伍已就绪 · 正在匹配目标地图</p></div>
          <div className="party-cards">
            <PlayerCard avatar={siteConfig.friend.card} initials={siteConfig.friend.initials} id={siteConfig.friend.id} tag={siteConfig.friend.tag} lead />
            <PlayerCard avatar={siteConfig.me.card} initials={siteConfig.me.initials} id={siteConfig.me.id} tag={siteConfig.me.tag} />
            {[3,4,5].map((slot) => <div className="empty-player" key={slot}><span>+</span><small>EMPTY SLOT</small></div>)}
          </div>
        </section>
      )}
      {scene === 'party' && <MatchmakingOverlay countdown={countdown} />}
      {scene === 'match-found' && <div className="match-found-flash"><span>MATCH FOUND</span><strong>对局已确认</strong></div>}
      <BottomStatus />
    </>
  );
}

function PlayerCard({ avatar, initials, id, tag, lead = false }: { avatar: string; initials: string; id: string; tag: string; lead?: boolean }) {
  return <div className="player-card"><div className="card-stripe"/><Avatar src={avatar} initials={initials} className="avatar-card"/><div className="card-copy"><strong>{id}</strong><small>{tag}</small><em>{lead ? 'PARTY LEADER' : 'READY'}</em></div></div>;
}

function MatchmakingOverlay({ countdown }: { countdown: number }) {
  const progress = ((siteConfig.timings.matchmakingSeconds - countdown) / siteConfig.timings.matchmakingSeconds) * 100;
  return <div className="matchmaking-overlay" aria-live="polite"><div className="matchmaking-hud"><span className="queue-label">PRIVATE QUEUE</span><strong>{String(countdown).padStart(2, '0')}</strong><span className="matching-label">MATCHMAKING</span><div className="matchmaking-progress"><i style={{ width: `${progress}%` }} /></div><div className="matchmaking-meta"><span>PARTY 2/5</span><span>PRIVATE SESSION</span><span>ESTABLISHING CONNECTION</span></div></div></div>;
}

function LobbyPlayer({ avatar, initials, id, level, status }: { avatar: string; initials: string; id: string; level: string; status: string }) {
  return <div className="lobby-player"><Avatar src={avatar} initials={initials} className="lobby-player-avatar" /><div className="lobby-player-copy"><span>{status} · 队伍成员</span><strong>{id}</strong><small>等级 {level}</small></div></div>;
}

function LoadingScene({ progress }: { progress: number }) {
  return (
    <section className="loading-scene loading-placeholder">
      <div className="loading-placeholder-grid" aria-hidden="true" />
      <div className="loading-copy"><p>LOADING MISSION ASSET</p><h1>LOADING</h1><span>等待新的加载界面图片</span></div>
      <div className="mission-brief"><p>任务简报</p><strong>完成五次精准击破</strong><span>地图视觉素材待接入</span></div>
      <div className="loading-meter"><div><span>LOADING MAP</span><b>{Math.round(progress)}%</b></div><div className="meter-track"><i style={{ width: `${progress}%` }}/></div></div>
    </section>
  );
}

function SecretUnlockScene() {
  return <section className="secret-scene"><div className="secret-noise"/><div className="secret-copy"><span>ENCRYPTED FILE DETECTED</span><h1>SECRET MISSION<br/><b>UNLOCKED</b></h1><p>PROJECT  SURPRISE</p><small>PLAYER  XX  ·  CLEARANCE LEVEL  18</small></div></section>;
}

function GestureGateScene({ handEnabled, handStatus, progress, onEnableHand, onActivate }: { handEnabled: boolean; handStatus: HandStatus; progress: number; onEnableHand: () => void; onActivate: () => void }) {
  const statusText = handStatus === 'palm-pose' ? '保持张开  两秒后开启' : '张开手掌  开启下一环节';
  return <section className={`gesture-gate-scene gate-status-${handStatus}`}><div className="gate-ring"/><div className="gate-hold-progress" role="progressbar" aria-label="手掌保持进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ '--gate-progress': `${progress * 360}deg` } as React.CSSProperties}><div className="gate-hand">✋</div></div><p className="gate-code">FINAL AUTHORIZATION REQUIRED</p><h1>张开手掌<br/>开启下一环节</h1><p className="gate-subtitle">{statusText}</p><div className="gate-actions">{!handEnabled || handStatus === 'permission-denied' || handStatus === 'error' || handStatus === 'unsupported' ? <button onPointerDown={(event) => event.stopPropagation()} onClick={onEnableHand}>启用手势</button> : <div className="tracking-live"><i/><span>张开手掌</span></div>}<button className="pointer-fallback" onPointerDown={(event) => event.stopPropagation()} onClick={onActivate}>暂时使用鼠标启动</button></div></section>;
}

function SurpriseTransition() {
  return <section className="surprise-transition"><div className="surprise-crack"/><div className="surprise-copy"><span>SURPRISE PROTOCOL</span><strong>INITIALIZED</strong></div></section>;
}

function FireworksScene({ shots, onLaunch, onComplete }: { shots: number; onLaunch: () => void; onComplete: () => void }) {
  const [showHint, setShowHint] = useState(true);
  useEffect(() => { const timer = window.setTimeout(() => setShowHint(false), 4000); return () => window.clearTimeout(timer); }, []);
  return <section className="fireworks-scene gesture-fireworks" onPointerDown={onLaunch}>
    <FireworksCanvas shots={shots} onComplete={onComplete} />
    <div className="fireworks-vignette"/>
    {showHint && shots < 5 && <div className="fireworks-copy"><p>请先握拳 再张开手掌<br/>发射属于自己的专属烟花</p></div>}
  </section>;
}

function MessageScene() {
  const [phase, setPhase] = useState<'prelude' | 'map'>('prelude');
  const [revealed, setRevealed] = useState(0);
  const [index, setIndex] = useState(0);
  const current = messages[index];
  const preludeCharacters = Array.from(preludeMessage);

  useEffect(() => {
    if (phase !== 'prelude') return;
    const interval = window.setInterval(() => {
      setRevealed((value) => Math.min(preludeCharacters.length, value + 1));
    }, 110);
    return () => window.clearInterval(interval);
  }, [phase, preludeCharacters.length]);

  useEffect(() => {
    if (phase !== 'prelude' || revealed < preludeCharacters.length) return;
    const timer = window.setTimeout(() => {
      setIndex(0);
      setPhase('map');
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [phase, preludeCharacters.length, revealed]);

  useEffect(() => {
    if (phase !== 'map') return;
    if (index >= messages.length - 1) return;
    const holdMs = index < 2 ? 4000 : 7000;
    const timer = window.setTimeout(() => setIndex((value) => value + 1), holdMs);
    return () => window.clearTimeout(timer);
  }, [index, phase]);

  const advance = () => setIndex((value) => Math.min(messages.length - 1, value + 1));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phase === 'map' && (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowRight')) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  if (phase === 'prelude') {
    return <section className="message-prelude-scene">
      <div className="message-prelude-glow" aria-hidden="true" />
      <div className="message-prelude-text" aria-label={preludeMessage}>
        {preludeCharacters.map((character, characterIndex) => character === '\n'
          ? <br key={characterIndex} />
          : <span key={characterIndex} aria-hidden={characterIndex >= revealed} style={characterIndex >= revealed ? { animationName: 'none', visibility: 'hidden' } : undefined}>{character === ' ' ? '\u00a0' : character}</span>)}
      </div>
    </section>;
  }

  return <section className="message-scene" onPointerDown={advance}>
    <MessageWorldMap />
    <div className={`message-page ${index === messages.length - 1 ? 'message-page-emphasis' : ''}`} key={index}>
      <p>{current}</p>
    </div>
  </section>;
}

function MessageWorldMap() {
  return <div className="message-world-map" aria-hidden="true">
    <div className="map-art">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/user/nanjing-london-map.png" alt="" />
      <span className="map-city-label map-city-london"><i />伦敦</span>
      <span className="map-city-label map-city-nanjing"><i />南京</span>
    </div>
  </div>;
}

function GameScene({ scene, aim, targetIndex, targetVisible, impact, misses, inputMode, handStatus, onChooseHand, onChoosePointer, onStartHand }: {
  scene: Scene; aim: Point; targetIndex: number; targetVisible: boolean; impact: boolean; misses: number; inputMode: InputMode; handStatus: HandStatus;
  onChooseHand: () => void; onChoosePointer: () => void; onStartHand: () => void;
}) {
  const target = targets[targetIndex];
  return (
    <section className="training-ground" style={{ backgroundImage: `linear-gradient(180deg, rgba(17,35,40,.05), rgba(4,9,12,.38)), url(${siteConfig.assets.fpsBackground})` }}>
      <div className="range-world" aria-hidden="true"><div className="sky-glow"/><div className="wall wall-left"/><div className="wall wall-right"/><div className="far-door"/><div className="floor-grid"/></div>
      <div className="combat-hud"><div className="round-info"><span>MISSION 18</span><strong>{Math.min(targetIndex + (scene === 'ace' ? 1 : 0), 5)} / 5</strong></div><div className="score-pips">{targets.map((_, index) => <i key={index} className={index < targetIndex || scene === 'ace' ? 'down' : index === targetIndex ? 'active' : ''}/>)}</div><div className="ammo"><span>∞</span><small>TRAINING</small></div></div>
      {scene === 'game' && targetVisible && target && <RobotTarget x={target.x} y={target.y} label={target.label} impact={impact} index={targetIndex}/>} 
      {(scene === 'game' || scene === 'calibration') && <Crosshair point={aim} active={handStatus === 'gun-pose' || inputMode === 'pointer'} />}
      <div className={`first-person-weapon ${impact ? 'recoil' : ''}`} aria-hidden="true"><div className="weapon-slide"/><div className="weapon-body"/><div className="weapon-grip"/><div className="hand-shape"/></div>
      {scene === 'calibration' && <CalibrationPanel inputMode={inputMode} handStatus={handStatus} onChooseHand={onChooseHand} onChoosePointer={onChoosePointer} onStartHand={onStartHand}/>} 
      {scene === 'game' && <div className="gesture-tip"><span>{inputMode === 'hand' ? (handStatus === 'gun-pose' ? '枪形已识别 · 锁定后快速上抬食指开枪' : '伸直食指，弯曲其余三指') : '移动鼠标瞄准头部 · 点击开枪'}</span><small>空枪 {misses}</small></div>}
      {scene === 'ace' && <div className="ace-sequence"><div className="ace-slashes"/><p>FIVE TARGETS ELIMINATED</p><h1>ACE</h1><strong>五杀完成</strong><div className="ace-pips">{targets.map((_, i) => <i key={i}/>)}</div></div>}
    </section>
  );
}

function CalibrationPanel({ inputMode, handStatus, onChooseHand, onChoosePointer, onStartHand }: { inputMode: InputMode; handStatus: HandStatus; onChooseHand: () => void; onChoosePointer: () => void; onStartHand: () => void }) {
  const requested = inputMode === 'hand' && handStatus !== 'idle';
  return <div className="calibration-overlay" onPointerDown={(e) => e.stopPropagation()}><div className="calibration-card"><span className="panel-code">CONTROL SETUP // 01</span><h1>选择瞄准方式</h1><p>摄像头只在本机识别手部关键点，不上传、不保存。</p><div className="gesture-diagram" aria-hidden="true"><div className="finger finger-index"/><div className="finger finger-thumb"/><div className="finger-palm"/><div className="gesture-crosshair">+</div></div><ol><li>食指伸直，其余三指弯曲</li><li>移动食指，让准心对准机器人头部并短暂停稳</li><li>快速向上抬起食指，完成一次射击</li></ol>{!requested ? <div className="control-options"><button className="primary-control" onClick={onChooseHand}>启用手势</button><button onClick={onChoosePointer}>使用鼠标 / 触摸</button></div> : <div className="permission-state"><strong>{handStatus === 'loading' && '正在启动本机识别…'}{handStatus === 'ready' && '摄像头就绪，请比出手枪姿势'}{handStatus === 'gun-pose' && '识别成功，可以进入训练'}{handStatus === 'error' && '摄像头不可用，请使用备用方式'}</strong>{handStatus === 'gun-pose' && <button onClick={onStartHand}>进入训练</button>}{handStatus === 'error' && <button onClick={onChoosePointer}>切换到鼠标</button>}</div>}</div></div>;
}

function RobotTarget({ x, y, label, impact, index }: { x: number; y: number; label: string; impact: boolean; index: number }) {
  return <div className={`robot-target target-${index + 1} ${impact ? 'is-hit' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}><div className="target-label">{label}</div><div className="robot-head"><i/><i/><span/></div><div className="robot-neck"/><div className="robot-body"><span>18</span></div><div className="robot-arm arm-left"/><div className="robot-arm arm-right"/><div className="hit-sparks">{[1,2,3,4,5,6].map(i => <i key={i}/>)}</div></div>;
}

function Crosshair({ point, active }: { point: Point; active: boolean }) {
  return <div className={`crosshair ${active ? 'is-active' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}><i className="cross-top"/><i className="cross-right"/><i className="cross-bottom"/><i className="cross-left"/><b/></div>;
}

function Topbar({ label }: { label: string }) {
  return <header className="topbar"><div className="brand-mark">M<span>18</span></div><nav><button className="nav-item active">{label}</button><button className="nav-item">生涯</button><button className="nav-item">收藏</button></nav><div className="system-tag">PRIVATE BUILD // 18</div></header>;
}

function BottomStatus() {
  return <div className="bottom-status"><span>频道 / 队伍</span><div className="signal-bars"><i/><i/><i/><i/></div></div>;
}
