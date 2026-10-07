export type ActivityConfig = {
  enabled: boolean;
  clientId: string;
  publicUrl: string;
  voiceControls: boolean;
  musicControls: boolean;
};

export type ActivityUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
};

export type ActivityContext = {
  guild: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  channel: {
    id: string;
    name: string;
    type: string;
  } | null;
  member: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    voiceChannelId: string | null;
  };
  instanceId: string | null;
};

export type VoiceMember = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bot: boolean;
  owner: boolean;
};

export type VoiceChannel = {
  id: string;
  name: string;
  ownerId: string;
  locked: boolean;
  userLimit: number;
  memberCount: number;
  members: VoiceMember[];
  createdAt: number | null;
  transferredAt: number | null;
};

export type VoiceState = {
  ok: true;
  guild: { id: string; name: string };
  channel: VoiceChannel | null;
  owned: boolean;
  reason: null | 'not_in_voice' | 'not_temporary' | 'not_owner';
};

export type MusicTrack = {
  index: number | null;
  title: string;
  url: string | null;
  source: string | null;
  requesterId: string | null;
  thumbnail: string | null;
  durationMs: number | null;
  author: string | null;
};

export type MusicState = {
  ok: true;
  guild: { id: string; name: string };
  authorized: boolean;
  reason: null | 'join_playback_voice';
  userVoiceChannelId: string | null;
  music: {
    active: boolean;
    current: MusicTrack | null;
    queue: MusicTrack[];
    volume: number;
    paused: boolean;
    connectionState: string | null;
    connectionReady: boolean;
    voiceChannelId: string | null;
    currentProgressMs: number | null;
    startedAt: number | null;
  };
};

export type ApiError = {
  code: string;
  message: string;
  retryAfterMs?: number;
};

export type ApiResponse<T> = ({ ok: true } & T) | { ok: false; error: ApiError };

export type ActivityAuth = {
  me: ActivityUser;
  csrfToken: string;
  discordAccessToken: string;
};
