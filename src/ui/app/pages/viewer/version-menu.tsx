import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { Text } from '@astryxdesign/core/Text';
import { formatDateTime } from '../../../format';
import type { ViewerMeta } from '../viewer';

export function VersionMenu({ meta, version, fragment }: { meta: ViewerMeta; version: number; fragment: string }) {
  if (meta.version === 1) return <Text type="code" color="secondary">v1</Text>;
  const versions = [...meta.versions].sort((a, b) => b.version - a.version);
  return (
    <DropdownMenu
      alignment="end"
      renderTrigger={(props) => (
        <Button {...props} label={`v${version} of ${meta.version}, switch version`} tooltip="Versions" variant="ghost" size="sm">
          v{version}
        </Button>
      )}
    >
      {versions.map((info) => {
        const current = info.version === version;
        const latest = info.version === meta.version;
        const marker = latest && current ? 'Latest · Current' : latest ? 'Latest' : current ? 'Current' : '';
        return (
          <DropdownMenuItem
            key={info.version}
            label={`v${info.version}`}
            description={<time className="version-date" dateTime={info.createdAt}>{formatDateTime(info.createdAt)}</time>}
            endContent={marker ? <Text type="supporting" color="secondary">{marker}</Text> : undefined}
            href={`/a/${meta.id}?v=${info.version}${fragment}`}
          />
        );
      })}
    </DropdownMenu>
  );
}
