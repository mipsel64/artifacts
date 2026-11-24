import { useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ArtifactType } from '../../../types';
import { formatDateTime, retentionLabel } from '../../format';
import { ViewerFrame } from './viewer/frame';
import { TitleMenu } from './viewer/title-menu';
import { VersionMenu } from './viewer/version-menu';
import { SharePopover } from './viewer/share';

export interface ViewerMeta {
  id: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  version: number;
  versions: { version: number; createdAt: string }[];
  expiresAt: string | null;
  shareUrl: string | null;
  shareAudience: string[] | null;
}

export interface ViewerProps {
  meta: ViewerMeta;
  version: number;
  now: string;
}

export function Viewer({ meta, version, now }: ViewerProps) {
  const [sharing, setSharing] = useState({ shareUrl: meta.shareUrl, shareAudience: meta.shareAudience });
  const { shareUrl, shareAudience } = sharing;
  const [fragment, setFragment] = useState('');
  const apiPath = `/api/artifacts/${meta.id}`;
  const createdAt = meta.versions.find((entry) => entry.version === version)?.createdAt;
  const typeLabel = meta.language ? `${meta.type} · ${meta.language}` : meta.type;
  const accessLabel = !shareUrl ? 'Not shared' : shareAudience === null ? 'Anyone with the link' : 'Specific people';
  const isLatest = version === meta.version;
  const accessHeading = isLatest ? 'Access' : 'Latest version share link';

  return (
    <ViewerFrame
      previewSrc={`/r/${meta.id}?v=${version}`}
      contentUrl={`${apiPath}/content?version=${version}`}
      onHashChange={setFragment}
      fitWidth={meta.type === 'html' || meta.type === 'react'}
      details={
        <VStack gap={3} className="viewer-detail-card">
          <Heading level={2}>Artifact details</Heading>
          <dl className="viewer-facts">
            <VStack gap={1}><dt>Type</dt><dd>{typeLabel}</dd></VStack>
            <VStack gap={1}><dt>Version</dt><dd>v{version} of {meta.version}</dd></VStack>
            <VStack gap={1}>
              <dt>Retention</dt>
              <dd>{retentionLabel(meta.expiresAt, new Date(now))}</dd>
              {meta.expiresAt && <dd><time dateTime={meta.expiresAt}>{formatDateTime(meta.expiresAt)} UTC</time></dd>}
            </VStack>
            <VStack gap={1}><dt>{accessHeading}</dt><dd>{accessLabel}</dd></VStack>
            {shareUrl && shareAudience && (
              <VStack gap={1}><dt>Allowed emails or domains</dt><dd>{shareAudience.join(', ')}</dd></VStack>
            )}
            {createdAt && (
              <VStack gap={1}><dt>Version saved</dt><dd><time dateTime={createdAt}>{formatDateTime(createdAt)} UTC</time></dd></VStack>
            )}
          </dl>
        </VStack>
      }
      bar={(loadContent) => (
        <>
          <VStack gap={1} className="viewer-identity">
            <TitleMenu meta={meta} version={version} fragment={fragment} now={now} loadContent={loadContent} />
            <Text type="supporting" color="secondary" className="viewer-byline">
              {typeLabel} · {isLatest ? accessLabel : `${accessHeading}: ${accessLabel}`}
            </Text>
          </VStack>
          <HStack gap={1} vAlign="center" className="viewer-bar-end">
            <VersionMenu meta={meta} version={version} fragment={fragment} />
            <SharePopover
              id={meta.id}
              version={version}
              shareUrl={shareUrl}
              shareAudience={shareAudience}
              fragment={fragment}
              onView={({ shareUrl, shareAudience }) => setSharing({ shareUrl, shareAudience })}
            />
          </HStack>
        </>
      )}
    />
  );
}
