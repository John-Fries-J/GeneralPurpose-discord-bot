import { AlertTriangle, Loader2, RadioTower, ShieldAlert } from 'lucide-react';

type StatusViewProps = {
  state: 'loading' | 'disabled' | 'disconnected' | 'unauthorized' | 'empty' | 'error';
  title: string;
  detail: string;
};

const icons = {
  loading: Loader2,
  disabled: ShieldAlert,
  disconnected: RadioTower,
  unauthorized: ShieldAlert,
  empty: AlertTriangle,
  error: AlertTriangle,
};

export function StatusView({ state, title, detail }: StatusViewProps) {
  const Icon = icons[state];
  return (
    <section className="status-view" role={state === 'error' ? 'alert' : 'status'}>
      <Icon className={state === 'loading' ? 'spin' : ''} size={28} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
