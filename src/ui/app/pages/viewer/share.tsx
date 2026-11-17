import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Popover } from '@astryxdesign/core/Popover';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Text } from '@astryxdesign/core/Text';
import type { ArtifactView } from '../../../../types';
import { api } from '../../api';
import { CopyButton } from '../../Shell';

interface SharePopoverProps {
  id: string;
  version: number;
  shareUrl: string | null;
  shareAudience: string[] | null;
  fragment: string;
  onView: (view: ArtifactView) => void;
}

export function SharePopover({ id, version, shareUrl, shareAudience, fragment, onView }: SharePopoverProps) {
  const shared = shareUrl !== null;
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState('link');
  const [access, setAccess] = useState(shareAudience === null ? 'anyone' : 'restricted');
  const [audienceText, setAudienceText] = useState(shareAudience?.join('\n') ?? '');
  const [error, setError] = useState<string | null>(null);
  const apiPath = `/api/artifacts/${id}`;
  const renderPath = `/r/${id}?v=${version}`;
  const shareLink = shareUrl === null ? '' : shareUrl + fragment;

  const applyView = (view: ArtifactView) => {
    onView(view);
    setAccess(view.shareAudience === null ? 'anyone' : 'restricted');
    setAudienceText(view.shareAudience?.join('\n') ?? '');
  };

  const saveShare = async () => {
    setError(null);
    let audience: string[] | null = null;
    if (access === 'restricted') {
      audience = audienceText.split(/[\s,;]+/).filter(Boolean);
      if (audience.length === 0) {
        setError('Add at least one email or @domain');
        return;
      }
    }
    try {
      const view = await api<ArtifactView>('POST', `${apiPath}/share`, { audience });
      if (!view) throw new Error('Could not update sharing');
      applyView(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update sharing');
    }
  };

  const stopSharing = async () => {
    setError(null);
    try {
      const view = await api<ArtifactView>('DELETE', `${apiPath}/share`);
      if (!view) throw new Error('Could not stop sharing');
      applyView(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop sharing');
    }
  };

  return (
    <Popover
      label="Share"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      alignment="end"
      presentation="adaptive"
      width="36ch"
      content={
        <VStack gap={3} hAlign="stretch">
          <TabList value={tab} onChange={setTab} role="tablist" size="sm">
            <Tab value="link" label="Link" panelId="panel-share-link" />
            <Tab value="export" label="Export" panelId="panel-share-export" />
          </TabList>
          <div role="tabpanel" id="panel-share-link" aria-label="Link" hidden={tab !== 'link'}>
            <VStack gap={3} hAlign="stretch">
              {error && <Banner status="error" title={error} role="alert" container="section" />}
              <RadioList label="Who can view" value={access} onChange={setAccess} htmlName="share-access">
                <RadioListItem label="Anyone with the link" value="anyone" />
                <RadioListItem label="Only people you list" value="restricted" />
              </RadioList>
              {access === 'restricted' && (
                <TextArea
                  label="Emails or @domains"
                  description="One per line or comma separated."
                  placeholder="alice@example.com, @example.com"
                  rows={4}
                  value={audienceText}
                  onChange={setAudienceText}
                  autoComplete="email"
                />
              )}
              {!shared ? (
                <>
                  <Text>Share a read-only link.</Text>
                  <Button label="Create link" variant="primary" clickAction={saveShare} />
                </>
              ) : (
                <>
                  <HStack gap={2} vAlign="center" className="share-link-row">
                    <TextInput
                      label="Share link"
                      isLabelHidden
                      isReadOnly
                      htmlName="share-url"
                      value={shareLink}
                      containerClassName="share-link-field"
                      width="100%"
                    />
                    <CopyButton text={shareLink} />
                  </HStack>
                  <Button label="Save access" variant="primary" clickAction={saveShare} />
                  <Button label="Stop sharing" variant="destructive" clickAction={stopSharing} />
                  <Text type="supporting" color="secondary">
                    {access === 'restricted'
                      ? 'Only listed people can view, after Google sign-in. A @domain entry needs a Google Workspace account on that domain.'
                      : 'Anyone with the link can view the latest version.'}
                  </Text>
                </>
              )}
            </VStack>
          </div>
          <div role="tabpanel" id="panel-share-export" aria-label="Export" hidden={tab !== 'export'}>
            <VStack gap={1} hAlign="stretch">
              <Button label="Markdown" href={`${apiPath}/export?format=md&version=${version}`} variant="ghost" width="100%" />
              <Button label="HTML" href={`${apiPath}/export?format=html&version=${version}`} variant="ghost" width="100%" />
              <Button label="PDF" onClick={() => window.open(`${renderPath}&print=1`, '_blank', 'noopener')} variant="ghost" width="100%" />
            </VStack>
          </div>
        </VStack>
      }
    >
      <Button
        label={shared ? 'Share, shared' : 'Share'}
        size="sm"
        variant={shared ? 'primary' : 'secondary'}
        endContent={shared ? <Badge label="Shared" variant="neutral" /> : undefined}
      >
        Share
      </Button>
    </Popover>
  );
}
