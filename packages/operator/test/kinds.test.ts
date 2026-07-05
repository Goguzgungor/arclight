import { describe, expect, it } from 'vitest';
import { GenericKind, modelToGroupVersionKind } from 'kubernetes-fluent-client';
import { Indexer } from '../src/kinds.js';

describe('Indexer kind kaydı', () => {
  it('GenericKind türevidir ve GVK kayıtlıdır', () => {
    expect(new Indexer()).toBeInstanceOf(GenericKind);
    const gvk = modelToGroupVersionKind(Indexer.name);
    expect(gvk).toMatchObject({
      group: 'arclight.dev',
      version: 'v1alpha1',
      kind: 'Indexer',
      plural: 'indexers',
    });
  });
});
