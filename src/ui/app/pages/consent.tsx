import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';

export interface ConsentProps {
  clientName: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  email: string;
  handle: string;
}

export function Consent({ clientName, redirectHost, redirectIsLoopback, email, handle }: ConsentProps) {
  return (
    <Card padding={8}>
      <form className="auth-form" method="post" action="/authorize">
        <VStack gap={4} hAlign="stretch">
          <VStack gap={3} hAlign="center">
            <Avatar name={clientName} size="lg" tooltip={false} />
            <Heading level={1} justify="center">{clientName} wants to access your Artifacts</Heading>
            <Text color="secondary" justify="center">This app registered itself, so its name is not verified.</Text>
          </VStack>
          {redirectIsLoopback && <Banner status="warning" title="This sends access to an app on your computer." description="Continue only if you just started signing in from it." />}
          <dl>
            <dt>Sends access to</dt>
            <dd><strong>{redirectHost}</strong></dd>
            <dt>Signed in as</dt>
            <dd>{email}</dd>
            <dt>Can</dt>
            <dd>List, read, create, change, share and delete your artifacts until you revoke it in Settings.</dd>
          </dl>
          <input type="hidden" name="handle" value={handle} />
          <VStack gap={3}>
            <Button label="Allow" type="submit" name="decision" value="approve" variant="primary" size="lg" />
            <Button label="Deny" type="submit" name="decision" value="deny" size="lg" />
          </VStack>
        </VStack>
      </form>
    </Card>
  );
}
