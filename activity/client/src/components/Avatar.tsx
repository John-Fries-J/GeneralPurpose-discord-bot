import { initials } from '../services/format';

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
};

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  return src ? (
    <img className={`avatar avatar-${size}`} src={src} alt="" />
  ) : (
    <span className={`avatar avatar-${size} avatar-fallback`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
