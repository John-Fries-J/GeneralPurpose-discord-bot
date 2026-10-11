import { useEffect, useMemo, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { ActivityApiClient, type ActivityRuntimeContext } from '../services/activityApi';
import type { ActivityAuth, ActivityConfig, ActivityContext } from '../services/types';

type SessionPhase = 'loading' | 'disabled' | 'authenticating' | 'ready' | 'disconnected' | 'unauthorized';

type SessionState = {
  phase: SessionPhase;
  config: ActivityConfig | null;
  auth: ActivityAuth | null;
  context: ActivityContext | null;
  error: string | null;
  api: ActivityApiClient;
};

function sdkContext(discordSdk: DiscordSDK): ActivityRuntimeContext {
  const sdk = discordSdk as DiscordSDK & { instanceId?: string };
  return {
    guildId: discordSdk.guildId || null,
    channelId: discordSdk.channelId || null,
    instanceId: sdk.instanceId || null,
  };
}

export function useActivitySession(): SessionState {
  const api = useMemo(() => new ActivityApiClient(), []);
  const [state, setState] = useState<Omit<SessionState, 'api'>>({
    phase: 'loading',
    config: null,
    auth: null,
    context: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        const config = await api.getConfig();
        if (cancelled) return;
        if (!config.enabled) {
          setState({ phase: 'disabled', config, auth: null, context: null, error: null });
          return;
        }
        if (!config.clientId) {
          setState({ phase: 'unauthorized', config, auth: null, context: null, error: 'Activity client ID is not configured.' });
          return;
        }

        setState({ phase: 'authenticating', config, auth: null, context: null, error: null });
        const discordSdk = new DiscordSDK(config.clientId);
        await discordSdk.ready();
        const runtimeContext = sdkContext(discordSdk);
        api.setContext(runtimeContext);
        const { code } = await discordSdk.commands.authorize({
          client_id: config.clientId,
          response_type: 'code',
          state: crypto.randomUUID(),
          prompt: 'none',
          scope: ['identify', 'guilds', 'applications.commands'],
        });
        const auth = await api.exchangeCode(code);
        await discordSdk.commands.authenticate({ access_token: auth.discordAccessToken });
        const context = await api.getContext();
        if (cancelled) return;
        setState({ phase: 'ready', config, auth, context, error: null });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not connect to Discord Activity.';
        setState(previous => ({
          ...previous,
          phase: /unauthorized|forbidden|permission/i.test(message) ? 'unauthorized' : 'disconnected',
          error: message,
        }));
      }
    }

    setup();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { ...state, api };
}
