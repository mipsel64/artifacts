import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading, Text } from '@astryxdesign/core/Text';
import { ARTIFACT_TYPES, type ArtifactType } from '../../../types';
import { api } from '../api';
import { useFeedback } from '../Shell';

const TYPE_OPTIONS = [...ARTIFACT_TYPES];

export function NewArtifact() {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ArtifactType>('html');
  const [language, setLanguage] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showError, clearError } = useFeedback();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.length === 0) {
      showError('Title is required');
      return;
    }
    if (content.length === 0) {
      showError('Content is required');
      return;
    }
    setSubmitting(true);
    clearError();
    try {
      const input: { title: string; type: ArtifactType; content: string; language?: string } = { title, type, content };
      const trimmedLanguage = language.trim();
      if (type === 'code' && trimmedLanguage) input.language = trimmedLanguage;
      const created = await api<{ url: string }>('POST', '/api/artifacts', input);
      if (created === null) throw new Error('The create response did not include an artifact');
      location.assign(created.url);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not create the artifact');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VStack gap={6} hAlign="stretch">
      <VStack gap={1} className="artifact-editor-header">
        <Text type="supporting" color="secondary">Personal workspace</Text>
        <Heading level={1} type="display-3">New artifact</Heading>
        <Text as="p" color="secondary">Choose a format and add its source. The artifact stays private until you share it.</Text>
      </VStack>
      <form method="post" data-form="new" onSubmit={submit}>
        <FormLayout>
          <TextInput
            label="Title"
            htmlName="title"
            value={title}
            onChange={(value) => setTitle(value.slice(0, 200))}
            isRequired
            autoComplete="off"
          />
          <Selector
            label="Type"
            htmlName="type"
            options={TYPE_OPTIONS}
            value={type}
            onChange={(value) => setType(value as ArtifactType)}
          />
          {type === 'code' && (
            <TextInput
              label="Language"
              htmlName="language"
              value={language}
              onChange={(value) => setLanguage(value.slice(0, 32))}
              placeholder="e.g. python"
              autoComplete="off"
            />
          )}
          <TextArea
            label="Content"
            htmlName="content"
            value={content}
            onChange={setContent}
            isRequired
            rows={10}
            hasSpellCheck={false}
            controlClassName="artifact-content-editor"
          />
          <HStack gap={2}>
            <Button label="Create artifact" type="submit" variant="primary" isLoading={submitting} />
            <Button label="Cancel" href="/" />
          </HStack>
        </FormLayout>
      </form>
    </VStack>
  );
}
