'use client';

import { documentSections, updateContentItem, type DocumentTypeWire } from '@devimpact/shared';
import { Calculator } from 'lucide-react';
import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * DocumentEditor (DESIGN_SYSTEM §5.2, D-027): structured per-claim fields instead of rich text.
 * Stored claims are plain text with their own citations, so editing the text keeps each claim's
 * evidence attached (no HTML, no Markdown, no editor dependency). Engine sections are read-only.
 * Loaded with `next/dynamic` only in edit mode; the viewer owns autosave (900 ms → PATCH).
 */
export default function DocumentEditor({
  type,
  content,
  onChange,
}: {
  type: DocumentTypeWire;
  content: unknown;
  onChange: (content: unknown) => void;
}) {
  const baseId = useId();
  const { sections } = documentSections(type, content, { keepEmpty: true });
  return (
    <div className="flex flex-col gap-7" data-testid="document-editor">
      {sections.map((section) => {
        if (section.kind !== 'items') {
          return (
            <section
              key={section.key}
              className="flex flex-col gap-1.5"
              aria-labelledby={`${baseId}-${section.key}`}
            >
              <h2 id={`${baseId}-${section.key}`} className="text-lg font-semibold">
                {section.label}
              </h2>
              <p className="flex items-center gap-1.5 text-base text-muted-foreground">
                <Calculator className="size-4" aria-hidden="true" />
                Calculated by DevImpact — read-only while editing.
              </p>
            </section>
          );
        }
        return (
          <fieldset key={section.key} className="flex flex-col gap-3">
            <legend className="mb-2 text-lg font-semibold">{section.label}</legend>
            {section.items.map((item, i) => {
              const fieldId = `${baseId}-${section.key}-${i}`;
              const name =
                section.items.length > 1 ? `${section.label}, item ${i + 1}` : section.label;
              return (
                <div key={item.id ?? i} className="flex flex-col gap-1.5">
                  {item.title !== null ? (
                    <>
                      <Label htmlFor={`${fieldId}-title`} className="sr-only">
                        {`${name} title`}
                      </Label>
                      <Input
                        id={`${fieldId}-title`}
                        value={item.title}
                        maxLength={200}
                        className="font-semibold"
                        onChange={(e) => {
                          onChange(
                            updateContentItem(content, section.key, item.index, {
                              title: e.target.value,
                            }),
                          );
                        }}
                      />
                    </>
                  ) : null}
                  <Label htmlFor={fieldId} className="sr-only">
                    {name}
                  </Label>
                  <Textarea
                    id={fieldId}
                    value={item.text}
                    maxLength={section.cited ? 2000 : 1000}
                    rows={Math.min(8, Math.max(2, Math.ceil(item.text.length / 90)))}
                    className="field-sizing-content text-md leading-relaxed"
                    onChange={(e) => {
                      onChange(
                        updateContentItem(content, section.key, item.index, {
                          text: e.target.value,
                        }),
                      );
                    }}
                  />
                  {section.cited && item.citations.length ? (
                    <span className="font-mono text-caption text-subtle-foreground">
                      Evidence kept: {item.citations.join(', ')}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
