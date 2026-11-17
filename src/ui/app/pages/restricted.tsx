import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { GoogleMark, Icon } from '../icons';

export interface RestrictedProps {
  shareId: string;
  viewerEmail: string | null;
}

export function Restricted({ shareId, viewerEmail }: RestrictedProps) {
  const signInUrl = `/auth/login?next=${encodeURIComponent(`/s/${shareId}`)}`;
  return (
    <Card padding={8}>
      <VStack gap={4} hAlign="center">
        <Icon name="shield-check" size={24} />
        <Heading level={1} justify="center">{viewerEmail === null ? 'Sign in to view' : 'You do not have access'}</Heading>
        <Text color="secondary" justify="center">
          {viewerEmail === null
            ? 'This link is shared with specific people. Sign in with Google to check your access.'
            : `You are signed in as ${viewerEmail}. Ask the owner for access, or sign in with an account that has access.`}
        </Text>
        <Button label={viewerEmail === null ? 'Sign in with Google' : 'Switch account'} href={signInUrl} variant="primary" icon={<GoogleMark />} />
        {viewerEmail !== null && <Text color="secondary" type="supporting" justify="center">Access for a whole domain needs a Google Workspace account on that domain.</Text>}
      </VStack>
    </Card>
  );
}
