import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { GoogleMark, Icon } from '../icons';

export interface RestrictedProps {
  shareId: string;
  viewerEmail: string | null;
}

export function Restricted({ shareId, viewerEmail }: RestrictedProps) {
  const signInUrl = `/auth/login?next=${encodeURIComponent(`/s/${shareId}`)}`;
  const signedOut = viewerEmail === null;
  return (
    <section className="preferences-access" aria-labelledby="restricted-heading">
      <VStack gap={4} hAlign="start">
        <header className="preferences-heading">
          <figure className="preferences-access-mark"><Icon name="shield-check" size={24} /></figure>
          <Text type="code" color="secondary" className="preferences-kicker">Restricted share link</Text>
          <Heading level={1} id="restricted-heading" className="preferences-display">{signedOut ? 'Sign in to view' : 'You do not have access'}</Heading>
          <Text as="p" color="secondary">
            {signedOut
              ? 'This link is shared with specific people. Sign in with Google to check your access.'
              : <>You are signed in as <bdi>{viewerEmail}</bdi>. Ask the owner for access, or sign in with an account that has access.</>}
          </Text>
        </header>
        <Button label={signedOut ? 'Sign in with Google' : 'Switch account'} href={signInUrl} variant="primary" icon={<GoogleMark />} />
        {!signedOut && <Text as="p" type="supporting">Access for a whole domain needs a Google Workspace account on that domain.</Text>}
      </VStack>
    </section>
  );
}
