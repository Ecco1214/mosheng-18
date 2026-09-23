export const siteConfig = {
  friend: {
    id: 'XX',
    tag: 'LV.291',
    initials: 'XX',
    avatar: '/assets/user/friend-profile.png',
    card: '/assets/user/friend-card-public.png',
  },
  me: {
    id: '云箫',
    tag: 'LV.221',
    initials: 'ME',
    avatar: '/assets/user/my-profile.png',
    card: '/assets/user/my-card.png',
  },
  map: {
    name: 'OLD DAYS',
    subtitle: '私人训练场 · 特别行动',
  },
  assets: {
    introVideo: '/assets/user/mission-intro-public.webm',
    lobbyVideo: '/assets/user/ranked-lobby-loop-public.webm',
    rankedLobbyScreen: '/assets/user/ranked-lobby-screen-public.jpg',
    lobbyBackground: '/assets/lobby-background.jpg',
    inviteReference: '/assets/invite-reference.png',
    loadingBackground: '/assets/loading-background.jpg',
    mapPreview: '/assets/map-preview.png',
    fpsBackground: '/assets/fps-background.jpg',
  },
  timings: {
    inviteDelayMs: 10000,
    matchmakingSeconds: 10,
    loadingSeconds: 10,
  },
} as const;
