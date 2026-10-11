import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { StatusView } from '../components/StatusView';
import { Tabs } from '../components/Tabs';
import { useActivitySession } from '../hooks/useActivitySession';
import { useRealtime } from '../hooks/useRealtime';
import { MusicPage } from '../pages/MusicPage';
import { VoicePage } from '../pages/VoicePage';
import type { MusicState, VoiceState } from '../services/types';

type TabId = 'voice' | 'music';

export function App() {
  const session = useActivitySession();
  const realtime = useRealtime(session.api, session.phase === 'ready');
  const [activeTab, setActiveTab] = useState<TabId>('voice');
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [music, setMusic] = useState<MusicState | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);

  const refreshVoice = useCallback(async () => {
    if (!session.config?.voiceControls) return;
    setVoiceLoading(true);
    try {
      setVoice(await session.api.getVoice());
      setVoiceError(null);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Voice state failed to load.');
    } finally {
      setVoiceLoading(false);
    }
  }, [session.api, session.config?.voiceControls]);

  const refreshMusic = useCallback(async () => {
    if (!session.config?.musicControls) return;
    setMusicLoading(true);
    try {
      setMusic(await session.api.getMusic());
      setMusicError(null);
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : 'Music state failed to load.');
    } finally {
      setMusicLoading(false);
    }
  }, [session.api, session.config?.musicControls]);

  useEffect(() => {
    if (session.phase !== 'ready') return;
    refreshVoice();
    refreshMusic();
  }, [refreshMusic, refreshVoice, session.phase]);

  useEffect(() => {
    if (session.phase !== 'ready' || realtime.tick === 0) return;
    refreshVoice();
    refreshMusic();
  }, [refreshMusic, refreshVoice, realtime.tick, session.phase]);

  useEffect(() => {
    if (!session.config) return;
    if (!session.config.voiceControls && session.config.musicControls) setActiveTab('music');
  }, [session.config]);

  if (session.phase === 'loading' || session.phase === 'authenticating') {
    return <StatusView state="loading" title="Connecting to Discord" detail="Preparing the in-Discord control panel." />;
  }
  if (session.phase === 'disabled') {
    return <StatusView state="disabled" title="Activity disabled" detail="Enable activity.enabled on the bot server to use this panel." />;
  }
  if (session.phase === 'disconnected') {
    return <StatusView state="disconnected" title="Disconnected" detail={session.error || 'The Activity could not connect to Discord.'} />;
  }
  if (session.phase === 'unauthorized') {
    return <StatusView state="unauthorized" title="Unauthorized" detail={session.error || 'Discord authorization failed.'} />;
  }

  const voiceEnabled = session.config?.voiceControls === true;
  const musicEnabled = session.config?.musicControls === true;

  return (
    <main className="app-shell">
      <AppHeader auth={session.auth} context={session.context} realtimeStatus={realtime.status} />
      <Tabs active={activeTab} voiceEnabled={voiceEnabled} musicEnabled={musicEnabled} onChange={setActiveTab} />
      {activeTab === 'voice' ? (
        voiceEnabled ? (
          <VoicePage
            api={session.api}
            state={voice}
            loading={voiceLoading}
            error={voiceError}
            onRefresh={refreshVoice}
            onError={setVoiceError}
          />
        ) : <StatusView state="disabled" title="Voice disabled" detail="Voice controls are disabled for this Activity." />
      ) : (
        musicEnabled ? (
          <MusicPage
            api={session.api}
            state={music}
            loading={musicLoading}
            error={musicError}
            onRefresh={refreshMusic}
            onError={setMusicError}
          />
        ) : <StatusView state="disabled" title="Music disabled" detail="Music controls are disabled for this Activity." />
      )}
      {realtime.status === 'reconnecting' && <div className="toast">Reconnecting to live updates</div>}
    </main>
  );
}
