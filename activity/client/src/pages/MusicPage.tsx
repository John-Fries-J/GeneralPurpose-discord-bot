import { ListMusic, Pause, Play, Plus, SkipForward, Square, Trash2, Volume2, ArrowUp, ArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusView } from '../components/StatusView';
import { ActivityApiClient } from '../services/activityApi';
import { clamp, formatDuration } from '../services/format';
import type { MusicState, MusicTrack } from '../services/types';

type MusicPageProps = {
  api: ActivityApiClient;
  state: MusicState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
};

function artwork(track: MusicTrack | null) {
  if (track?.thumbnail) return <img className="artwork" src={track.thumbnail} alt="" />;
  return (
    <div className="artwork artwork-fallback" aria-hidden="true">
      <ListMusic size={42} />
    </div>
  );
}

export function MusicPage({ api, state, loading, error, onRefresh, onError }: MusicPageProps) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    if (!state?.music) return;
    setVolume(state.music.volume);
  }, [state?.music?.volume]);

  async function run(action: () => Promise<void>, clearQuery = false) {
    setBusy(true);
    onError(null);
    try {
      await action();
      if (clearQuery) setQuery('');
      await onRefresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Music action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <StatusView state="loading" title="Loading music state" detail="Checking playback and queue state." />;
  if (error) return <StatusView state="error" title="Music error" detail={error} />;
  if (!state) return <StatusView state="empty" title="No music state" detail="Music state is not available yet." />;
  if (!state.authorized) {
    return <StatusView state="unauthorized" title="Join playback voice" detail="Join the voice channel where the bot is playing before using music controls." />;
  }

  const current = state.music.current;
  const duration = current?.durationMs || null;
  const progressMs = state.music.currentProgressMs || 0;
  const progressPercent = duration ? clamp((progressMs / duration) * 100, 0, 100) : 0;

  return (
    <section className="module-grid">
      <div className="panel now-playing">
        <div className="now-layout">
          {artwork(current)}
          <div className="track-main">
            <span className="eyebrow">Now Playing</span>
            <h1>{current?.title || 'Nothing playing'}</h1>
            <p>{current?.author || current?.source || 'Start playback from a voice channel.'}</p>
            <div className="progress" aria-label="Playback progress">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="time-row">
              <span>{formatDuration(progressMs)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        </div>
        <div className="button-row transport">
          {state.music.paused ? (
            <button type="button" disabled={busy || !current} onClick={() => run(() => api.resumeMusic())}>
              <Play size={17} aria-hidden="true" />
              <span>Resume</span>
            </button>
          ) : (
            <button type="button" disabled={busy || !current} onClick={() => run(() => api.pauseMusic())}>
              <Pause size={17} aria-hidden="true" />
              <span>Pause</span>
            </button>
          )}
          <button type="button" disabled={busy || !state.music.active} onClick={() => run(() => api.skipMusic())}>
            <SkipForward size={17} aria-hidden="true" />
            <span>Skip</span>
          </button>
          <button className="danger" type="button" disabled={busy || !state.music.active} onClick={() => run(() => api.stopMusic())}>
            <Square size={17} aria-hidden="true" />
            <span>Stop</span>
          </button>
        </div>
        <label className="volume-control">
          <span><Volume2 size={16} aria-hidden="true" /> Volume</span>
          <input type="range" min={0} max={200} value={volume} onChange={event => setVolume(Number(event.target.value))} />
          <button type="button" disabled={busy || volume === state.music.volume} onClick={() => run(() => api.setMusicVolume(volume))}>
            {volume}%
          </button>
        </label>
      </div>

      <div className="panel add-track">
        <span className="eyebrow">Add Track</span>
        <form onSubmit={event => {
          event.preventDefault();
          if (query.trim()) run(() => api.addMusic(query), true);
        }}>
          <input value={query} maxLength={300} placeholder="URL or search query" onChange={event => setQuery(event.target.value)} />
          <button type="submit" disabled={busy || !query.trim()}>
            <Plus size={16} aria-hidden="true" />
            <span>Add</span>
          </button>
        </form>
      </div>

      <div className="panel queue-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Queue</span>
            <h2>{state.music.queue.length ? `${state.music.queue.length} queued` : 'Empty'}</h2>
          </div>
        </div>
        <div className="queue-list">
          {state.music.queue.length ? state.music.queue.map((track, index) => (
            <div className="queue-row" key={`${track.index}-${track.title}-${track.url || index}`}>
              <span className="queue-index">{index + 1}</span>
              <div>
                <strong>{track.title}</strong>
                <span>{formatDuration(track.durationMs)}{track.requesterId ? ` by ${track.requesterId}` : ''}</span>
              </div>
              <div className="queue-actions">
                <button title="Move up" type="button" disabled={busy || index === 0} onClick={() => run(() => api.moveMusic(index, index - 1))}>
                  <ArrowUp size={15} aria-hidden="true" />
                </button>
                <button title="Move down" type="button" disabled={busy || index === state.music.queue.length - 1} onClick={() => run(() => api.moveMusic(index, index + 1))}>
                  <ArrowDown size={15} aria-hidden="true" />
                </button>
                <button title="Remove" type="button" disabled={busy} onClick={() => run(() => api.removeMusic(index))}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )) : <p className="muted">No queued tracks.</p>}
        </div>
      </div>
    </section>
  );
}
