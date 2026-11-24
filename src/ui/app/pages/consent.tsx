import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Logo } from '../icons';

export interface ConsentProps {
  clientName: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  email: string;
  handle: string;
}

export function Consent({ clientName, redirectHost, redirectIsLoopback, email, handle }: ConsentProps) {
  return (
    <section className="preferences-access" aria-labelledby="consent-heading">
      <form className="auth-form" method="post" action="/authorize" aria-labelledby="consent-heading">
        <VStack gap={4}>
          <header className="preferences-heading">
            <HStack gap={2} vAlign="center" className="preferences-handoff" aria-hidden="true">
              <Avatar name={clientName} size="lg" tooltip={false} />
              <Logo size={40} />
            </HStack>
            <Text type="code" color="secondary" className="preferences-kicker">App access request</Text>
            <Heading level={1} id="consent-heading" className="preferences-display">Connect <bdi>{clientName}</bdi>?</Heading>
            <Text as="p" color="secondary"><bdi>{clientName}</bdi> wants to access your Artifacts workspace.</Text>
          </header>
          <dl className="preferences-access-facts">
            <dt>Signed in as</dt>
            <dd>{email}</dd>
            <dt>Sends access to</dt>
            <dd><strong>{redirectHost}</strong></dd>
          </dl>
          <dl className="preferences-access-capabilities">
            <dt>What this app can do</dt>
            <dd>
              This app can use MCP to list, read, create, and edit your artifacts, including reading older versions. It can change
              when artifacts expire, manage public and restricted share links, and permanently delete artifacts. You can revoke
              this access in Settings.
            </dd>
          </dl>
          <Banner
            status="warning"
            title="Unverified app name"
            description="This app registered itself, so its name is not verified. Continue only if you started this connection and recognize the destination."
          />
          {redirectIsLoopback && <Banner status="warning" title="This sends access to an app on your computer." description="Continue only if you just started signing in from it." />}
          <input type="hidden" name="handle" value={handle} />
          <HStack gap={2} wrap="wrap">
            <Button label="Allow access" type="submit" name="decision" value="approve" variant="primary" />
            <Button label="Deny" type="submit" name="decision" value="deny" />
          </HStack>
        </VStack>
      </form>
    </section>
  );
}
