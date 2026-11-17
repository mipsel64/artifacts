import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '../icons';

export function AuthError({ message }: { message: string }) {
  return (
    <Card padding={8}>
      <VStack gap={4} hAlign="center">
        <Text color="inherit" className="error-icon"><Icon name="circle-alert" size={24} /></Text>
        <Heading level={1} justify="center">Authorization failed</Heading>
        <Text justify="center">{message}</Text>
        <Text color="secondary" justify="center">Go back to the app and start signing in again.</Text>
      </VStack>
    </Card>
  );
}
