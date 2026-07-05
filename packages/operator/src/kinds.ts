import { GenericKind, RegisterKind } from 'kubernetes-fluent-client';
import type { IndexerSpec, IndexerStatus } from '@arclight/core';

export class Indexer extends GenericKind {
  spec?: IndexerSpec;
  status?: IndexerStatus;
}

RegisterKind(Indexer, {
  group: 'arclight.dev',
  version: 'v1alpha1',
  kind: 'Indexer',
  plural: 'indexers',
});
