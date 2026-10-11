import { Bot, Radio } from 'lucide-react';
import { Avatar } from './Avatar';
import type { ActivityAuth, ActivityContext } from '../services/types';

type AppHeaderProps = {
  auth: ActivityAuth | null;
  context: ActivityContext | null;
  realtimeStatus: 'idle' | 'connected' | 'reconnecting' | 'error';
};

export function AppHeader({ auth, context, realtimeStatus }: AppHeaderProps) {
  const label = realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'reconnecting' ? 'Reconnecting' : 'Offline';

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark"><Bot size={20} aria-hidden="true" /></span>
        <div>
          <strong>Bot Control</strong>
          <span>{context?.guild.name || 'Discord Activity'}</span>
        </div>
      </div>
      <div className="header-context">
        <div className={`connection-pill ${realtimeStatus}`}>
          <Radio size={14} aria-hidden="true" />
          <span>{label}</span>
        </div>
        {context?.channel && <span className="context-chip">#{context.channel.name}</span>}
        {auth?.me && <Avatar name={auth.me.globalName || auth.me.username} size="sm" />}
      </div>
    </header>
  );
}
