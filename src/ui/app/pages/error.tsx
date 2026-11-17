import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon, type IconName } from '../icons';

export interface ErrorPageProps {
  heading: string;
  title: string;
  text: string;
  icon: IconName;
  danger: boolean;
  home: string;
  signInAction: boolean;
  signedIn: boolean;
}

export function ErrorPage({ heading, title, text, icon, danger, home, signInAction, signedIn }: ErrorPageProps) {
  return (
    <Card padding={8}>
      <VStack gap={4} hAlign="center">
        <Text color="inherit" className={danger ? 'error-icon' : undefined}><Icon name={icon} size={24} /></Text>
        <Text type="large" color="secondary">{heading}</Text>
        <Heading level={1} justify="center">{title}</Heading>
        <Text color="secondary" justify="center">{text}</Text>
        <HStack gap={3} hAlign="center">
          <Button label={home} href="/" variant="primary" />
          {signInAction && !signedIn && <Button label="Sign in" href="/auth/login" />}
        </HStack>
      </VStack>
    </Card>
  );
}
