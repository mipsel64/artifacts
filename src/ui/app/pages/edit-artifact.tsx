import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading, Text } from '@astryxdesign/core/Text';
import { api } from '../api';
import { useFeedback } from '../Shell';

export interface EditArtifactProps {
  id: string;
  title: string;
  content: string;
}

export function EditArtifact({ id, title: initialTitle, content: initialContent }: EditArtifactProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const { showError, clearError } = useFeedback();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body: Record<string, string> = {};
    if (title !== initialTitle) body.title = title;
    if (content !== initialContent) body.content = content;
    if (Object.keys(body).length === 0) {
      location.assign(`/a/${id}`);
      return;
    }
    if (title.length === 0) {
      showError('Title is required');
      return;
    }
    if (content.length === 0) {
      showError('Content is required');
      return;
    }
    setSaving(true);
    clearError();
    try {
      await api('PATCH', `/api/artifacts/${id}`, body);
      location.assign(`/a/${id}`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not save the artifact');
    } finally {
      setSaving(false);
    }
  }

  return (
    <VStack gap={6} hAlign="stretch">
      <VStack gap={1} className="artifact-editor-header">
        <Text type="supporting" color="secondary">Personal workspace</Text>
        <Heading level={1} type="display-3">Edit artifact</Heading>
        <Text as="p" color="secondary">You are editing the latest version. Saving a content change creates a new version.</Text>
      </VStack>
      <form method="post" data-form="edit" data-id={id} onSubmit={submit}>
        <FormLayout>
          <TextInput
            label="Title"
            htmlName="title"
            value={title}
            onChange={(value) => setTitle(value.slice(0, 200))}
            isRequired
            autoComplete="off"
          />
          <TextArea
            label="Content"
            htmlName="content"
            value={content}
            onChange={setContent}
            isRequired
            rows={14}
            hasSpellCheck={false}
            controlClassName="artifact-content-editor"
          />
          <HStack gap={2}>
            <Button label="Save changes" type="submit" variant="primary" isLoading={saving} />
            <Button label="Cancel" href={`/a/${id}`} />
          </HStack>
        </FormLayout>
      </form>
    </VStack>
  );
}
