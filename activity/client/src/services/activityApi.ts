import type { ApiError, ApiResponse, ActivityAuth, ActivityConfig, ActivityContext, MusicState, VoiceState } from './types';

export type ActivityRuntimeContext = {
  guildId: string | null;
  channelId: string | null;
  instanceId: string | null;
};

export class ActivityApiClient {
  private csrfToken = '';
  private context: ActivityRuntimeContext = { guildId: null, channelId: null, instanceId: null };

  setAuth(auth: Pick<ActivityAuth, 'csrfToken'>): void {
    this.csrfToken = auth.csrfToken;
  }

  setContext(context: ActivityRuntimeContext): void {
    this.context = context;
  }

  async getConfig(): Promise<ActivityConfig> {
    const response = await this.request<{ config: ActivityConfig }>('/api/activity/config', { auth: false });
    return response.config;
  }

  async exchangeCode(code: string): Promise<ActivityAuth> {
    const response = await this.request<{ accessToken: string; csrfToken: string; me: ActivityAuth['me'] }>('/api/activity/token', {
      method: 'POST',
      auth: false,
      body: { code, context: this.context },
    });
    const auth = {
      me: response.me,
      csrfToken: response.csrfToken,
      discordAccessToken: response.accessToken,
    };
    this.setAuth(auth);
    return auth;
  }

  async getMe(): Promise<Pick<ActivityAuth, 'me' | 'csrfToken'>> {
    return this.request<Pick<ActivityAuth, 'me' | 'csrfToken'>>('/api/activity/me');
  }

  async getContext(): Promise<ActivityContext> {
    const response = await this.request<{ context: ActivityContext }>('/api/activity/context');
    return response.context;
  }

  async getVoice(): Promise<VoiceState> {
    const response = await this.request<{ voice: VoiceState }>('/api/activity/voice');
    return response.voice;
  }

  async renameVoice(name: string): Promise<void> {
    await this.request('/api/activity/voice/name', { method: 'POST', body: { name, context: this.context } });
  }

  async setVoiceLimit(limit: number): Promise<void> {
    await this.request('/api/activity/voice/limit', { method: 'POST', body: { limit, context: this.context } });
  }

  async lockVoice(): Promise<void> {
    await this.request('/api/activity/voice/lock', { method: 'POST', body: { context: this.context } });
  }

  async unlockVoice(): Promise<void> {
    await this.request('/api/activity/voice/unlock', { method: 'POST', body: { context: this.context } });
  }

  async permitVoice(userId: string): Promise<void> {
    await this.request('/api/activity/voice/permit', { method: 'POST', body: { userId, context: this.context } });
  }

  async rejectVoice(userId: string): Promise<void> {
    await this.request('/api/activity/voice/reject', { method: 'POST', body: { userId, context: this.context } });
  }

  async transferVoice(userId: string): Promise<void> {
    await this.request('/api/activity/voice/transfer', { method: 'POST', body: { userId, context: this.context } });
  }

  async deleteVoice(): Promise<void> {
    await this.request('/api/activity/voice/delete', { method: 'POST', body: { context: this.context } });
  }

  async getMusic(): Promise<MusicState> {
    const response = await this.request<{ music: MusicState }>('/api/activity/music');
    return response.music;
  }

  async pauseMusic(): Promise<void> {
    await this.request('/api/activity/music/pause', { method: 'POST', body: { context: this.context } });
  }

  async resumeMusic(): Promise<void> {
    await this.request('/api/activity/music/resume', { method: 'POST', body: { context: this.context } });
  }

  async skipMusic(): Promise<void> {
    await this.request('/api/activity/music/skip', { method: 'POST', body: { context: this.context } });
  }

  async stopMusic(): Promise<void> {
    await this.request('/api/activity/music/stop', { method: 'POST', body: { context: this.context } });
  }

  async setMusicVolume(volume: number): Promise<void> {
    await this.request('/api/activity/music/volume', { method: 'POST', body: { volume, context: this.context } });
  }

  async addMusic(query: string): Promise<void> {
    await this.request('/api/activity/music/add', { method: 'POST', body: { query, context: this.context } });
  }

  async removeMusic(index: number): Promise<void> {
    await this.request('/api/activity/music/remove', { method: 'POST', body: { index, context: this.context } });
  }

  async moveMusic(from: number, to: number): Promise<void> {
    await this.request('/api/activity/music/move', { method: 'POST', body: { from, to, context: this.context } });
  }

  eventSourceUrl(): string {
    const params = new URLSearchParams();
    if (this.context.guildId) params.set('guildId', this.context.guildId);
    if (this.context.channelId) params.set('channelId', this.context.channelId);
    if (this.context.instanceId) params.set('instanceId', this.context.instanceId);
    return `/api/activity/events?${params.toString()}`;
  }

  private async request<T extends Record<string, unknown>>(path: string, options: {
    method?: string;
    body?: Record<string, unknown>;
    auth?: boolean;
  } = {}): Promise<T> {
    const method = options.method || 'GET';
    const headers = new Headers();
    if (options.body) headers.set('Content-Type', 'application/json');
    if (options.auth !== false && this.csrfToken && method !== 'GET') headers.set('X-Activity-Csrf', this.csrfToken);
    if (this.context.guildId) headers.set('X-Activity-Guild-Id', this.context.guildId);
    if (this.context.channelId) headers.set('X-Activity-Channel-Id', this.context.channelId);
    if (this.context.instanceId) headers.set('X-Activity-Instance-Id', this.context.instanceId);

    const response = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({
      ok: false,
      error: { code: 'invalid_response', message: 'Server returned an invalid response.' },
    })) as ApiResponse<T>;

    if (!response.ok || !data.ok) {
      const error = (('error' in data ? data.error : null) || {
        code: `http_${response.status}`,
        message: 'Activity request failed.',
      }) as ApiError;
      throw Object.assign(new Error(error.message), error);
    }

    return data as T;
  }
}
