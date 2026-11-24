import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Popover } from '@astryxdesign/core/Popover';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { ArtifactView } from '../../../../types';
import { api } from '../../api';
import { Icon } from '../../icons';
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
  const [access, setAccess] = useState(shared && shareAudience === null ? 'anyone' : 'restricted');
  const [audienceText, setAudienceText] = useState(shareAudience?.join('\n') ?? '');
  const [audienceError, setAudienceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [pending, setPending] = useState<'POST' | 'DELETE' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const audienceRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const focusAfterConfirmation = useRef<'stop' | 'create' | null>(null);
  const apiPath = `/api/artifacts/${id}`;
  const renderPath = `/r/${id}?v=${version}`;
  const shareLink = shareUrl === null ? '' : shareUrl + fragment;
  const currentAccess = !shared ? 'Not shared' : shareAudience === null ? 'Anyone with the link' : 'Specific people';

  useEffect(() => {
    if (confirmStop) {
      keepRef.current?.focus();
    } else {
      const target = focusAfterConfirmation.current;
      focusAfterConfirmation.current = null;
      if (target === 'stop') stopRef.current?.focus();
      if (target === 'create') saveRef.current?.focus();
    }
  }, [confirmStop]);

  const openChange = (open: boolean) => {
    if (open) {
      setTab('link');
      setAccess(shared && shareAudience === null ? 'anyone' : 'restricted');
      setAudienceText(shareAudience?.join('\n') ?? '');
      setAudienceError(undefined);
      setError(undefined);
      setNotice('');
      setConfirmStop(false);
    }
    setIsOpen(open);
  };

  const updateShare = async (method: 'POST' | 'DELETE', audience?: string[] | null) => {
    if (pending) return;
    setPending(method);
    setError(undefined);
    setNotice('');
    try {
      const view = await api<ArtifactView>(method, `${apiPath}/share`, audience === undefined ? undefined : { audience });
      if (!view) throw new Error(method === 'POST' ? 'Could not update sharing' : 'Could not stop sharing');
      onView(view);
      setAccess(view.shareUrl && view.shareAudience === null ? 'anyone' : 'restricted');
      setAudienceText(view.shareAudience?.join('\n') ?? '');
      if (method === 'DELETE' && confirmationRef.current?.contains(document.activeElement)) {
        focusAfterConfirmation.current = 'create';
      }
      setConfirmStop(false);
      setNotice(method === 'DELETE' ? 'Sharing stopped.' : shared ? 'Access saved.' : 'Share link created.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not update sharing';
      if (method === 'POST' && audience !== null && message.startsWith('audience ')) {
        setAudienceError(message);
        audienceRef.current?.focus();
      } else {
        setError(message);
      }
    } finally {
      setPending(null);
    }
  };

  const saveShare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || confirmStop) return;
    setAudienceError(undefined);
    const audience = access === 'anyone' ? null : audienceText.split(/[\s,;]+/).filter(Boolean);
    if (audience?.length === 0) {
      setError(undefined);
      setNotice('');
      setAudienceError('Add at least one email or @domain.');
      audienceRef.current?.focus();
      return;
    }
    void updateShare('POST', audience);
  };

  return (
    <Popover
      label="Share artifact"
      isOpen={isOpen}
      onOpenChange={openChange}
      alignment="end"
      presentation="adaptive"
      width="min(28rem, calc(100dvw - 2 * var(--spacing-3)))"
      padding={4}
      hasCloseButton={false}
      content={
        <VStack gap={3} hAlign="stretch" className="share-panel">
          <header className="share-panel-heading">
            <VStack gap={1}>
              <Heading level={2}>Share artifact</Heading>
              <Text type="supporting" color="secondary">Read-only link · opens the latest version</Text>
            </VStack>
            <Button
              label="Close"
              size="sm"
              variant="ghost"
              onClick={() => {
                openChange(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            />
          </header>
          <TabList value={tab} onChange={setTab} role="tablist" aria-label="Share options" size="sm">
            <Tab value="link" label="Link" panelId="panel-share-link" />
            <Tab value="export" label="Export" panelId="panel-share-export" />
          </TabList>
          <section role="tabpanel" id="panel-share-link" aria-label="Link" hidden={tab !== 'link'}>
            <VStack gap={3} hAlign="stretch">
              <p className="share-current-access">
                <Icon name="link" />
                Current access: <strong>{currentAccess}</strong>
              </p>
              <form onSubmit={saveShare}>
                <VStack gap={3} hAlign="stretch">
                  <RadioList
                    label="Who can view the link?"
                    value={access}
                    onChange={(value) => { setAccess(value); setAudienceError(undefined); setNotice(''); }}
                    htmlName="share-access"
                    isDisabled={pending !== null}
                  >
                    <RadioListItem label="Specific people" value="restricted" description="Google sign-in required." />
                    <RadioListItem label="Anyone with the link" value="anyone" description="No sign-in required." />
                  </RadioList>
                  {access === 'restricted' && (
                    <TextArea
                      ref={audienceRef}
                      htmlName="audience"
                      label="Emails or @domains"
                      description="Separate entries with commas or new lines. Domains require Google Workspace."
                      placeholder="reader@example.com, @example.com"
                      rows={2}
                      value={audienceText}
                      onChange={(value) => { setAudienceText(value); setAudienceError(undefined); setNotice(''); }}
                      status={audienceError ? { type: 'error', message: audienceError } : undefined}
                      isReadOnly={pending !== null}
                      hasSpellCheck={false}
                      autoCapitalize="none"
                      hasAutoCorrect={false}
                      width="100%"
                    />
                  )}
                  {error && !confirmStop && <Banner status="error" title={error} role="alert" container="section" />}
                  <HStack gap={2} wrap="wrap">
                    <Button
                      ref={saveRef}
                      label={shared ? 'Save access' : 'Create link'}
                      size="sm"
                      variant="primary"
                      type="submit"
                      isLoading={pending === 'POST'}
                      isDisabled={confirmStop}
                    />
                    {shared && (
                      <Button
                        ref={stopRef}
                        label="Stop sharing"
                        size="sm"
                        variant="ghost"
                        isDisabled={pending !== null || confirmStop}
                        onClick={() => { setError(undefined); setNotice(''); setConfirmStop(true); }}
                      />
                    )}
                  </HStack>
                </VStack>
              </form>
              {shared && (
                <HStack gap={2} vAlign="end" className="share-link-row">
                  <TextInput
                    label="Share link"
                    isReadOnly
                    htmlName="share-url"
                    value={shareLink}
                    containerClassName="share-link-field"
                    width="100%"
                    size="sm"
                  />
                  <CopyButton text={shareLink} label="Copy link" />
                </HStack>
              )}
              {confirmStop && (
                <section ref={confirmationRef} className="share-confirmation" aria-label="Disable this link?">
                  <VStack gap={2}>
                    <Text weight="semibold">Disable this link?</Text>
                    <Text type="supporting" color="secondary">Viewers will lose access to this link.</Text>
                    {error && <Banner status="error" title={error} role="alert" container="section" />}
                    <HStack gap={2} wrap="wrap">
                      <Button
                        ref={keepRef}
                        label="Keep link"
                        size="sm"
                        isDisabled={pending !== null}
                        onClick={() => {
                          focusAfterConfirmation.current = 'stop';
                          setConfirmStop(false);
                          setError(undefined);
                        }}
                      />
                      <Button
                        label="Stop sharing"
                        size="sm"
                        variant="destructive"
                        isLoading={pending === 'DELETE'}
                        onClick={() => void updateShare('DELETE')}
                      />
                    </HStack>
                  </VStack>
                </section>
              )}
              <Text type="supporting" color="secondary" role="status">{notice}</Text>
            </VStack>
          </section>
          <section role="tabpanel" id="panel-share-export" aria-label="Export" hidden={tab !== 'export'}>
            <Text type="supporting" color="secondary">Exporting version v{version}</Text>
            <List density="compact">
              <ListItem
                itemKey="md"
                href={`${apiPath}/export?format=md&version=${version}`}
                startContent={<Icon name="file-text" size={16} />}
                label="Markdown"
                endContent={<Text type="supporting" color="secondary">.md</Text>}
              />
              <ListItem
                itemKey="html"
                href={`${apiPath}/export?format=html&version=${version}`}
                startContent={<Icon name="code-xml" size={16} />}
                label="HTML"
                endContent={<Text type="supporting" color="secondary">.html</Text>}
              />
              <ListItem
                itemKey="pdf"
                onClick={() => window.open(`${renderPath}&print=1`, '_blank', 'noopener')}
                startContent={<Icon name="printer" size={16} />}
                label="PDF"
                endContent={<Text type="supporting" color="secondary">opens the print dialog</Text>}
              />
            </List>
          </section>
        </VStack>
      }
    >
      <Button
        ref={triggerRef}
        label={shared ? 'Share, shared' : 'Share'}
        size="sm"
        variant={shared ? 'primary' : 'secondary'}
        icon={<Icon name="link" />}
        endContent={<AstryxIcon icon="chevronDown" size="sm" />}
      >
        Share
      </Button>
    </Popover>
  );
}
