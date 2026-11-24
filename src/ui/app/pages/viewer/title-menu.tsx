import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api } from '../../api';
import { copyLater } from '../../clipboard';
import { useFeedback } from '../../Shell';
import { retentionLabel } from '../../../format';
import type { ViewerMeta } from '../viewer';
import type { LoadContent } from './frame';

interface TitleMenuProps {
  meta: ViewerMeta;
  version: number;
  now: string;
  fragment: string;
  loadContent: LoadContent;
}

export function TitleMenu({ meta, version, now, fragment, loadContent }: TitleMenuProps) {
  const { showError, confirm } = useFeedback();
  const [title, setTitle] = useState(meta.title);
  const [draftTitle, setDraftTitle] = useState(meta.title);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [busy, setBusy] = useState<'retention' | 'delete' | null>(null);
  const renameFormRef = useRef<HTMLFormElement>(null);
  const apiPath = `/api/artifacts/${meta.id}`;
  const renderPath = `/r/${meta.id}?v=${version}`;
  const permanent = meta.expiresAt === null;
  const typeLabel = meta.language ? `${meta.type} · ${meta.language}` : meta.type;

  useEffect(() => {
    if (!renameOpen) return;
    const input = renameFormRef.current?.querySelector<HTMLInputElement>('input[name="title"]');
    if (input) {
      input.maxLength = 200;
      input.select();
    }
  }, [renameOpen]);

  const copyContent = async () => {
    setCopyState('idle');
    const copied = await copyLater(loadContent);
    setCopyState(copied ? 'copied' : 'failed');
    if (!copied) showError('Could not copy to the clipboard');
  };

  const changeRetention = async () => {
    setBusy('retention');
    try {
      await api('PUT', `${apiPath}/retention`, { permanent: !permanent });
      location.reload();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not change retention');
      setBusy(null);
    }
  };

  const deleteArtifact = async () => {
    const confirmed = await confirm({
      title: 'Delete this artifact and all its versions?',
      description: 'This action cannot be undone.',
      actionLabel: 'Delete',
    });
    if (!confirmed) return;
    setBusy('delete');
    try {
      await api('DELETE', apiPath);
      location.assign('/');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not delete artifact');
      setBusy(null);
    }
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    setRenameSaving(true);
    setRenameError(null);
    try {
      await api('PATCH', apiPath, { title: draftTitle });
      setTitle(draftTitle);
      document.title = `${draftTitle} · Artifacts`;
      setRenameOpen(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Could not rename artifact');
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <>
      <Heading level={1} weight="semibold" className="viewer-title">
        <DropdownMenu
          renderTrigger={(props) => (
            <Button
              {...props}
              label={title}
              tooltip={title}
              variant="ghost"
              size="lg"
              className="viewer-title-trigger"
              endContent={<Icon icon="chevronDown" size="sm" />}
            />
          )}
          header={<VStack padding={2}><Text type="supporting" color="secondary">{retentionLabel(meta.expiresAt, new Date(now))} · {typeLabel}</Text></VStack>}
        >
          <DropdownMenuItem
            label={copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
            hasCloseOnSelect={false}
            onClick={() => void copyContent()}
          />
          <DropdownMenuItem label="Download" href={`${apiPath}/content?version=${version}&download=1`} />
          <DropdownMenuItem label="Open in new tab" href={renderPath + fragment} target="_blank" rel="noopener noreferrer" />
          <DropdownMenuDivider />
          <DropdownMenuItem label="Rename…" onClick={() => { setDraftTitle(title); setRenameError(null); setRenameOpen(true); }} />
          <DropdownMenuItem label="Edit" href={`/a/${meta.id}/edit`} />
          <DropdownMenuDivider />
          <DropdownMenuItem label="Export as Markdown" href={`${apiPath}/export?format=md&version=${version}`} />
          <DropdownMenuItem label="Export as HTML" href={`${apiPath}/export?format=html&version=${version}`} />
          <DropdownMenuItem label="Export as PDF" onClick={() => window.open(`${renderPath}&print=1`, '_blank', 'noopener')} />
          <DropdownMenuDivider />
          <DropdownMenuItem
            label={permanent ? 'Set to expire' : 'Make permanent'}
            isDisabled={busy !== null}
            onClick={() => void changeRetention()}
          />
          <DropdownMenuDivider />
          <DropdownMenuItem label="Delete" variant="destructive" isDisabled={busy !== null} onClick={() => void deleteArtifact()} />
        </DropdownMenu>
      </Heading>
      <Dialog isOpen={renameOpen} onOpenChange={(open) => { if (!renameSaving) setRenameOpen(open); }} purpose="form">
        <DialogHeader title="Rename artifact" onOpenChange={(open) => { if (!renameSaving) setRenameOpen(open); }} />
        <form ref={renameFormRef} className="rename-form" onSubmit={(event) => void rename(event)}>
          <VStack gap={4} hAlign="stretch">
            {renameError && <Banner status="error" title={renameError} role="alert" container="section" />}
            <TextInput
              label="Title"
              htmlName="title"
              isRequired
              hasAutoFocus
              autoComplete="off"
              value={draftTitle}
              isDisabled={renameSaving}
              onChange={setDraftTitle}
              width="100%"
            />
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" onClick={() => setRenameOpen(false)} isDisabled={renameSaving} />
              <Button label="Save" type="submit" variant="primary" isLoading={renameSaving} />
            </HStack>
          </VStack>
        </form>
      </Dialog>
    </>
  );
}
