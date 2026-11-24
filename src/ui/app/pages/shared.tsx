import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ArtifactType, ArtifactView } from '../../../types';
import { api } from '../api';
import { Icon } from '../icons';
import { CopyButton, useFeedback } from '../Shell';
import { ViewerFrame, type LoadContent } from './viewer/frame';

export interface SharedProps {
  shareId: string;
  title: string;
  type: ArtifactType;
  language: string | null;
  signedIn: boolean;
}

export function Shared({ shareId, title, type, language, signedIn }: SharedProps) {
  const { showError } = useFeedback();
  const typeLabel = language ? `${type} · ${language}` : type;

  const remix = async (loadContent: LoadContent) => {
    try {
      const content = await loadContent();
      const created = await api<ArtifactView>('POST', '/api/artifacts', { title, type, content, ...(language ? { language } : {}) });
      if (!created) throw new Error('Could not remix artifact');
      location.assign(created.url);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not remix artifact');
    }
  };

  return (
    <ViewerFrame
      previewSrc={`/s/${shareId}/render`}
      contentUrl={`/s/${shareId}/raw`}
      fitWidth={type === 'html' || type === 'react'}
      details={
        <VStack gap={3} className="viewer-detail-card">
          <Heading level={2}>Artifact details</Heading>
          <Text weight="semibold" className="viewer-detail-title">{title}</Text>
          <dl className="viewer-facts">
            <VStack gap={1}><dt>Type</dt><dd>{typeLabel}</dd></VStack>
            <VStack gap={1}><dt>Access</dt><dd>Read-only</dd></VStack>
          </dl>
        </VStack>
      }
      bar={(loadContent) => (
        <>
          <VStack gap={1} className="viewer-identity">
            <Heading level={1} weight="semibold" className="viewer-title viewer-title-plain">{title}</Heading>
            <Text type="supporting" color="secondary" className="viewer-byline">{typeLabel} · Read-only</Text>
          </VStack>
          <HStack gap={1} vAlign="center" wrap="wrap" className="viewer-bar-end">
            <CopyButton text={loadContent} />
            <Button label="Download" href={`/s/${shareId}/raw?download=1`} variant="ghost" size="sm" />
            {signedIn && <Button label="Remix" icon={<Icon name="git-fork" />} variant="primary" size="sm" clickAction={() => remix(loadContent)} />}
          </HStack>
        </>
      )}
    />
  );
}
