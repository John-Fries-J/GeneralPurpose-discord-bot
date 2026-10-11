import { Mic2, Music2 } from 'lucide-react';

type TabId = 'voice' | 'music';

type TabsProps = {
  active: TabId;
  voiceEnabled: boolean;
  musicEnabled: boolean;
  onChange: (tab: TabId) => void;
};

export function Tabs({ active, voiceEnabled, musicEnabled, onChange }: TabsProps) {
  return (
    <nav className="tabs" aria-label="Control modules">
      <button className={active === 'voice' ? 'active' : ''} type="button" onClick={() => onChange('voice')} disabled={!voiceEnabled}>
        <Mic2 size={18} aria-hidden="true" />
        <span>Voice</span>
      </button>
      <button className={active === 'music' ? 'active' : ''} type="button" onClick={() => onChange('music')} disabled={!musicEnabled}>
        <Music2 size={18} aria-hidden="true" />
        <span>Music</span>
      </button>
    </nav>
  );
}
