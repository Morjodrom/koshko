import type { ReactElement, SVGProps } from 'react';

type IconName =
  | 'ai'
  | 'activity'
  | 'clock'
  | 'copy'
  | 'download'
  | 'graph'
  | 'pause'
  | 'play'
  | 'plus'
  | 'trash'
  | 'timeline';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function Icon({ name, ...props }: IconProps): ReactElement {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  const paths: Record<IconName, ReactElement> = {
    ai: <><path {...common} d="M9 4h6M12 2v2M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" /><path {...common} d="M9 16h6M2 11h2m16 0h2" /></>,
    activity: <><path {...common} d="M3 12h3l2-7 4 14 2-7h7" /></>,
    clock: <><circle {...common} cx="12" cy="12" r="8.5" /><path {...common} d="M12 7v5l3.5 2" /></>,
    copy: <><rect {...common} x="8" y="8" width="11" height="12" rx="2" /><path {...common} d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></>,
    download: <><path {...common} d="M12 3v11m0 0 4-4m-4 4-4-4M4 20h16" /></>,
    graph: <><path {...common} d="M5 19V9m7 10V5m7 14v-7M3 19h18" /><circle {...common} cx="5" cy="9" r="1.5" fill="currentColor" /><circle {...common} cx="12" cy="5" r="1.5" fill="currentColor" /><circle {...common} cx="19" cy="12" r="1.5" fill="currentColor" /></>,
    pause: <><path {...common} d="M8 5v14M16 5v14" /></>,
    play: <path {...common} d="m8 5 11 7-11 7V5Z" />,
    plus: <><path {...common} d="M12 5v14M5 12h14" /></>,
    trash: <><path {...common} d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></>,
    timeline: <><path {...common} d="M4 6h16M4 12h16M4 18h16" /><circle {...common} cx="8" cy="6" r="2" fill="currentColor" /><circle {...common} cx="15" cy="12" r="2" fill="currentColor" /><circle {...common} cx="11" cy="18" r="2" fill="currentColor" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function KoshkoMark({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 64 64"
    >
      <path className="mark-hat" d="M15 25h34l-3-13H19l-4 13Zm-5 2h44v5H10z" />
      <path className="mark-face" d="m17 29 5 23 10 7 10-7 5-23-8 4-7-4-7 4-8-4Z" />
      <path className="mark-sunglasses" d="M19 37h11l2 3 2-3h11v7H34l-2-3-2 3H19z" />
      <path className="mark-nose" d="m29 48 3 2 3-2" />
      <path className="mark-whiskers" d="m24 47-9-2m10 6-8 2m23-6 9-2m-10 6 8 2" />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <div className={compact ? 'brand brand-compact' : 'brand'}>
      <KoshkoMark className="brand-mark" />
      <span>
        <strong>Koshko</strong>
        <small>Inspector</small>
      </span>
    </div>
  );
}
