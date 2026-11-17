import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ArtifactSummary } from '../../../types';
import { formatDate, retentionLabel } from '../../format';
import { TypeIcon } from '../icons';

export interface LibraryProps {
  items: ArtifactSummary[];
  now: string;
}

export function Library({ items, now }: LibraryProps) {
  const nowDate = new Date(now);
  return (
    <VStack gap={4} hAlign="stretch">
      <HStack gap={2} vAlign="center">
        <Heading level={1}>Artifacts</Heading>
        <Text color="secondary">{items.length}</Text>
      </HStack>
      {items.length === 0 ? (
        <EmptyState
          title="No artifacts yet"
          headingLevel={2}
          description="Create one here, or let an agent create them over MCP."
          actions={
            <HStack gap={3} hAlign="center">
              <Button label="New artifact" href="/new" variant="primary" />
              <Button label="Connect an agent" href="/settings" />
            </HStack>
          }
        />
      ) : (
        <List density="balanced" hasDividers edge="padded">
          {items.map((item) => (
            <ListItem
              key={item.id}
              itemKey={item.id}
              href={`/a/${item.id}`}
              startContent={
                <Text className={`library-type-tile artifact-type-${item.type}`}>
                  <TypeIcon type={item.type} size={20} />
                </Text>
              }
              label={<Text className="library-row-title" maxLines={1}>{item.title}</Text>}
              description={
                <HStack gap={2} wrap="wrap">
                  <Text type="supporting">v{item.version}</Text>
                  <Text type="supporting">Updated <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time></Text>
                  {item.expiresAt !== null && <Text type="supporting">{retentionLabel(item.expiresAt, nowDate)}</Text>}
                </HStack>
              }
              endContent={(item.expiresAt === null || item.shared) ? (
                <HStack gap={1}>
                  {item.expiresAt === null && <Badge label="Permanent" />}
                  {item.shared && <Badge label="Shared" variant="blue" />}
                </HStack>
              ) : undefined}
            />
          ))}
        </List>
      )}
    </VStack>
  );
}
