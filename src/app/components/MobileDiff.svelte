<script lang="ts">
  import { onMount } from 'svelte';
  import {
    unifiedMergeView,
    updateOriginalDoc,
    getOriginalDoc,
    getChunks,
    goToNextChunk,
    goToPreviousChunk,
  } from '@codemirror/merge';
  import { EditorView, lineNumbers, placeholder } from '@codemirror/view';
  import { EditorState, Compartment, Text, ChangeSet } from '@codemirror/state';
  import { computeStats } from '../lib/stats';
  import type { DiffStats } from '../lib/types';

  interface Props {
    original: string;
    modified: string;
    readonly?: boolean;
    onchange: (content: string) => void;
    onstats?: (stats: DiffStats) => void;
  }

  let { original, modified, readonly = false, onchange, onstats }: Props = $props();

  let containerEl: HTMLDivElement;
  let view: EditorView | undefined;
  const readOnlyCompartment = new Compartment();
  const mergeCompartment = new Compartment();

  // ─── Imperative methods (exported for parent components) ──────────────

  export function setCollapse(enabled: boolean): void {
    if (!view) return;
    view.dispatch({
      effects: mergeCompartment.reconfigure(
        unifiedMergeView({
          original: getOriginalDoc(view.state),
          highlightChanges: true,
          syntaxHighlightDeletions: false,
          mergeControls: false,
          collapseUnchanged: enabled ? { margin: 3, minSize: 4 } : undefined,
        }),
      ),
    });
  }

  export function goToNext(): void {
    if (view) goToNextChunk(view);
  }

  export function goToPrev(): void {
    if (view) goToPreviousChunk(view);
  }

  // ─── View creation ───────────────────────────────────────────────────

  function emitStats(): void {
    if (!view || !onstats) return;
    const chunkInfo = getChunks(view.state);
    if (!chunkInfo) return;
    const origDoc = getOriginalDoc(view.state);
    onstats(computeStats(chunkInfo.chunks, origDoc, view.state.doc));
  }

  function createView(orig: string, mod: string, isReadOnly: boolean): EditorView {
    return new EditorView({
      doc: mod,
      extensions: [
        lineNumbers(),
        placeholder('Paste modified text here…'),
        readOnlyCompartment.of(EditorState.readOnly.of(isReadOnly)),
        mergeCompartment.of(
          unifiedMergeView({
            original: Text.of(orig.split('\n')),
            highlightChanges: true,
            syntaxHighlightDeletions: false,
            mergeControls: false,
          }),
        ),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onchange(update.state.doc.toString());
            emitStats();
          }
        }),
        EditorView.theme({
          '&': { height: '100%', background: 'var(--surface-inset)' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.875rem',
          },
        }),
      ],
      parent: containerEl,
    });
  }

  onMount(() => {
    view = createView(original, modified, readonly);
    emitStats();
    return () => view?.destroy();
  });

  // Sync readOnly prop
  $effect(() => {
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readonly)) });
  });

  // When original changes, update it in-place via updateOriginalDoc effect.
  // This avoids destroying/recreating the view on every swap.
  $effect(() => {
    if (!view) return;
    const newOrigText = Text.of(original.split('\n'));
    const currentOrig = getOriginalDoc(view.state);
    if (currentOrig.toString() !== original) {
      // Build a full-replacement ChangeSet then dispatch the update
      const changes = ChangeSet.of(
        [{ from: 0, to: currentOrig.length, insert: newOrigText }],
        currentOrig.length,
      );
      view.dispatch({ effects: updateOriginalDoc.of({ doc: newOrigText, changes }) });
      emitStats();
    }
  });

  // Sync modified prop when changed externally (e.g., device rotation restoring desktop state)
  $effect(() => {
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== modified) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: modified },
      });
      // Stats will be emitted by the updateListener since docChanged is true
    }
  });
</script>

<div class="mobile-diff" bind:this={containerEl}></div>

<style>
  .mobile-diff {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    min-width: 0;
  }

  .mobile-diff :global(.cm-editor) {
    height: 100%;
  }
</style>
