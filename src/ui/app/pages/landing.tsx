import { VStack } from '@astryxdesign/core/Layout';
import { Grid } from '@astryxdesign/core/Grid';
import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { GoogleMark, Icon, Logo, type IconName } from '../icons';

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'bot', title: 'MCP for agents', text: 'Agents create and update artifacts over MCP or the REST API.' },
  { icon: 'shield-check', title: 'Sandboxed preview', text: 'Every artifact renders in an isolated iframe on its own origin.' },
  { icon: 'link', title: 'Share links', text: 'Publish a read-only link and stop sharing whenever you like.' },
];

export function Landing() {
  return (
    <VStack gap={10} hAlign="center" vAlign="center" className="landing-hero">
      <VStack gap={6} hAlign="center" className="landing-intro">
        <Logo size={48} />
        <Heading level={1} type="display-2" justify="center" textWrap="balance">A home for what your agents make</Heading>
        <Text type="large" color="secondary" justify="center" textWrap="balance">Create, version and share the HTML, React, slides, designs, motion, SVG, Mermaid, Archify, Markdown and code your agents write.</Text>
        <Button label="Sign in with Google" href="/auth/login" variant="primary" size="lg" icon={<GoogleMark />} />
      </VStack>
      <Grid columns={{ minWidth: 220, max: 3 }} gap={8} className="landing-features">
        {features.map((feature) => (
          <VStack key={feature.title} gap={2} hAlign="center">
            <Icon name={feature.icon} size={20} />
            <Heading level={2} justify="center">{feature.title}</Heading>
            <Text color="secondary" justify="center">{feature.text}</Text>
          </VStack>
        ))}
      </Grid>
    </VStack>
  );
}
