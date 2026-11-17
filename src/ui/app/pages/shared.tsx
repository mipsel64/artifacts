import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Layout';
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
      bar={(loadContent) => (
        <>
          <Heading level={1} weight="semibold" className="viewer-title viewer-title-plain">
            {title}
            <Badge label={typeLabel} variant="neutral" />
          </Heading>
          <HStack gap={1} vAlign="center" wrap="wrap" className="viewer-bar-end">
            <Text type="supporting" color="secondary">Read-only</Text>
            <CopyButton text={loadContent} />
            <Button label="Download" href={`/s/${shareId}/raw?download=1`} variant="ghost" size="sm" />
            {signedIn && <Button label="Remix" icon={<Icon name="git-fork" />} variant="primary" size="sm" clickAction={() => remix(loadContent)} />}
          </HStack>
        </>
      )}
    />
  );
}
