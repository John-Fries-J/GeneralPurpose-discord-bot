import { Check, Crown, Lock, Pencil, Trash2, Unlock, UserMinus, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { StatusView } from '../components/StatusView';
import { ActivityApiClient } from '../services/activityApi';
import type { VoiceMember, VoiceState } from '../services/types';

type VoicePageProps = {
  api: ActivityApiClient;
  state: VoiceState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
};

function reasonCopy(reason: VoiceState['reason']) {
  if (reason === 'not_in_voice') return ['No voice channel', 'Join your temporary voice channel to manage it here.'];
  if (reason === 'not_temporary') return ['No temporary channel', 'Your current voice channel is not a Join-to-Create channel.'];
  if (reason === 'not_owner') return ['Owner controls unavailable', 'Only the persisted owner can manage this temporary voice channel.'];
  return ['No active channel', 'Create or join a temporary voice channel to get controls.'];
}

function MemberActions({
  member,
  ownerId,
  busy,
  onPermit,
  onReject,
  onTransfer,
}: {
  member: VoiceMember;
  ownerId: string;
  busy: boolean;
  onPermit: (id: string) => void;
  onReject: (id: string) => void;
  onTransfer: (id: string) => void;
}) {
  const isOwner = member.id === ownerId;

  return (
    <div className="member-actions">
      <button type="button" title="Permit user" disabled={busy || isOwner} onClick={() => onPermit(member.id)}>
        <UserPlus size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Reject user" disabled={busy || isOwner} onClick={() => onReject(member.id)}>
        <UserMinus size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Transfer ownership" disabled={busy || isOwner} onClick={() => onTransfer(member.id)}>
        <Crown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function VoicePage({ api, state, loading, error, onRefresh, onError }: VoicePageProps) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state?.channel) return;
    setName(state.channel.name);
    setLimit(state.channel.userLimit);
  }, [state?.channel?.id, state?.channel?.name, state?.channel?.userLimit]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onRefresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Voice action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <StatusView state="loading" title="Loading voice state" detail="Checking your current temporary voice channel." />;
  if (error) return <StatusView state="error" title="Voice error" detail={error} />;
  if (!state?.channel) {
    const [title, detail] = reasonCopy(state?.reason || null);
    return <StatusView state="empty" title={title} detail={detail} />;
  }
  if (!state.owned) {
    const [title, detail] = reasonCopy(state.reason);
    return <StatusView state="unauthorized" title={title} detail={detail} />;
  }

  const channel = state.channel;
  const owner = channel.members.find(member => member.id === channel.ownerId);

  return (
    <section className="module-grid">
      <div className="panel channel-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Your Channel</span>
            <h1>{channel.name}</h1>
          </div>
          <div className={channel.locked ? 'state-badge locked' : 'state-badge'}>
            {channel.locked ? <Lock size={16} aria-hidden="true" /> : <Unlock size={16} aria-hidden="true" />}
            <span>{channel.locked ? 'Locked' : 'Open'}</span>
          </div>
        </div>
        <div className="metrics">
          <div><Users size={16} aria-hidden="true" /><strong>{channel.memberCount}</strong><span>{channel.userLimit ? `/ ${channel.userLimit}` : 'users'}</span></div>
          <div><Crown size={16} aria-hidden="true" /><strong>{owner?.displayName || channel.ownerId}</strong><span>owner</span></div>
        </div>
        <div className="form-grid">
          <label>
            <span>Rename</span>
            <div className="inline-control">
              <input value={name} maxLength={100} onChange={event => setName(event.target.value)} />
              <button type="button" disabled={busy || name.trim() === channel.name} onClick={() => run(() => api.renameVoice(name))}>
                <Pencil size={16} aria-hidden="true" />
                <span>Save</span>
              </button>
            </div>
          </label>
          <label>
            <span>User Limit</span>
            <div className="inline-control">
              <input type="number" min={0} max={99} value={limit} onChange={event => setLimit(Number(event.target.value))} />
              <button type="button" disabled={busy || limit === channel.userLimit} onClick={() => run(() => api.setVoiceLimit(limit))}>
                <Check size={16} aria-hidden="true" />
                <span>Set</span>
              </button>
            </div>
          </label>
        </div>
        <div className="button-row">
          {channel.locked ? (
            <button type="button" disabled={busy} onClick={() => run(() => api.unlockVoice())}>
              <Unlock size={16} aria-hidden="true" />
              <span>Unlock</span>
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(() => api.lockVoice())}>
              <Lock size={16} aria-hidden="true" />
              <span>Lock</span>
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Members</span>
            <h2>{channel.memberCount} connected</h2>
          </div>
        </div>
        <div className="member-list">
          {channel.members.map(member => (
            <div className="member-row" key={member.id}>
              <Avatar name={member.displayName} src={member.avatarUrl} />
              <div>
                <strong>{member.displayName}</strong>
                <span>{member.owner ? 'Owner' : member.username}</span>
              </div>
              {member.owner && <span className="owner-badge">Owner</span>}
              <MemberActions
                member={member}
                ownerId={channel.ownerId}
                busy={busy}
                onPermit={userId => run(() => api.permitVoice(userId))}
                onReject={userId => run(() => api.rejectVoice(userId))}
                onTransfer={userId => {
                  if (window.confirm(`Transfer ownership to ${member.displayName}?`)) {
                    run(() => api.transferVoice(userId));
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="panel danger-zone">
        <div>
          <span className="eyebrow">Danger Zone</span>
          <h2>Close Channel</h2>
          <p>Deletes the temporary channel and disconnects current members.</p>
        </div>
        <button
          className="danger"
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Delete this temporary voice channel?')) {
              run(() => api.deleteVoice());
            }
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          <span>Delete</span>
        </button>
      </div>
    </section>
  );
}
