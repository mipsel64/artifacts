import type { Child } from 'hono/jsx';
import { Icon, type IconName } from './icons';

type CalloutKind = 'danger' | 'warning' | 'info';

const CALLOUT_ICONS: Record<CalloutKind, IconName> = {
  danger: 'circle-alert',
  warning: 'triangle-alert',
  info: 'info',
};

export function Callout({ kind, children }: { kind: CalloutKind; children?: Child }) {
  return (
    <div class={`callout callout-${kind}`}>
      <Icon name={CALLOUT_ICONS[kind]} size={20} />
      <div class="callout-body">{children}</div>
    </div>
  );
}

export function Initial({ name }: { name: string }) {
  return (
    <span class="initial" aria-hidden="true">
      {(Array.from(name.trim())[0] ?? '?').toUpperCase()}
    </span>
  );
}
