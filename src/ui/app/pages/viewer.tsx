import { useState } from 'react';
import { HStack } from '@astryxdesign/core/Layout';
import type { ArtifactType, ArtifactView } from '../../../types';
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
  const [shareUrl, setShareUrl] = useState(meta.shareUrl);
  const [shareAudience, setShareAudience] = useState(meta.shareAudience);
  const [fragment, setFragment] = useState('');
  const apiPath = `/api/artifacts/${meta.id}`;
  const applyShareView = (view: ArtifactView) => {
    setShareUrl(view.shareUrl);
    setShareAudience(view.shareAudience);
  };

  return (
    <ViewerFrame
      previewSrc={`/r/${meta.id}?v=${version}`}
      contentUrl={`${apiPath}/content?version=${version}`}
      onHashChange={setFragment}
      bar={(loadContent) => (
        <>
          <TitleMenu meta={meta} version={version} now={now} loadContent={loadContent} />
          <HStack gap={1} vAlign="center" className="viewer-bar-end">
            <VersionMenu meta={meta} version={version} />
            <SharePopover
              id={meta.id}
              version={version}
              shareUrl={shareUrl}
              shareAudience={shareAudience}
              fragment={fragment}
              onView={applyShareView}
            />
          </HStack>
        </>
      )}
    />
  );
}
