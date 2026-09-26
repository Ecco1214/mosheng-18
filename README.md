# mosheng-18

An interactive birthday and farewell experience built as a game-inspired web story. Visitors move from a lobby and a five-target gesture-controlled challenge to fireworks and a message over a Nanjing–London route map.

## Highlights

- Real-time hand tracking for aiming, shooting, and opening a palm to launch fireworks, with pointer fallback.
- Animated transitions, a five-target challenge, particle fireworks, and timed farewell messages.
- Responsive fullscreen presentation with locally hosted hand-tracking model assets.
- 
## Design and technical challenges

The main challenge was making camera-based gestures feel reliable in an interactive story. Hand landmarks can jitter, causing accidental shots or missed actions. I refined the gesture-triggering logic with movement thresholds, state transitions, and cooldowns, then tested the full flow from aiming and shooting to launching fireworks. I also kept pointer controls as a fallback when camera access is unavailable.

## Run locally

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open the local address shown by the development server. Camera access is requested only for hand controls; the pointer fallback remains available.

## Public-media note

This repository contains anonymized, silent copies of the media used by the site. The original photo, background music, and unredacted source media are not included. The game-inspired screenshots and artwork remain the property of their respective owners; this personal prototype is not affiliated with the game publisher.

---

这是一个结合手势识别、五次瞄准挑战、烟花与南京—伦敦航线留言的生日纪念网页。公开版本使用匿名、无音轨素材；个人照片和背景音乐未上传。
