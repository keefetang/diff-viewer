<script lang="ts">
  import { onMount } from 'svelte';
  import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
  import { EditorView, lineNumbers, placeholder } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { computeStats } from '../lib/stats';
  import type { DiffStats } from '../lib/types';

  interface Props {
    original: string;
    modified: string;
    readonly?: boolean;
    stats: DiffStats;
    onchange: (side: 'a' | 'b', content: string) => void;
    onstats: (stats: DiffStats) => void;
  }

  let { original, modified, readonly = false, stats, onchange, onstats }: Props = $props();

  let containerEl: HTMLDivElement;
  let mergeView: MergeView | undefined;
  const readOnlyCompartment = new Compartment();

  // Expose imperative methods via exported functions
  export function setCollapse(enabled: boolean): void {
    mergeView?.reconfigure({
      collapseUnchanged: enabled ? { margin: 3, minSize: 4 } : undefined,
    });
  }

  export function goToNext(): void {
    if (mergeView) goToNextChunk(mergeView.b);
  }

  export function goToPrev(): void {
    if (mergeView) goToPreviousChunk(mergeView.b);
  }

  function makeExtensions(isOriginal: boolean) {
    return [
      lineNumbers(),
      placeholder(isOriginal ? 'Paste original text here…' : 'Paste modified text here…'),
      readOnlyCompartment.of(EditorState.readOnly.of(readonly)),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          onchange(isOriginal ? 'a' : 'b', update.state.doc.toString());
          // Re-emit stats after each change — chunks update synchronously
          if (mergeView) {
            onstats(computeStats(mergeView.chunks, mergeView.a.state.doc, mergeView.b.state.doc));
          }
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
    ];
  }

  onMount(() => {
    mergeView = new MergeView({
      a: { doc: original, extensions: makeExtensions(true) },
      b: { doc: modified, extensions: makeExtensions(false) },
      parent: containerEl,
      highlightChanges: true,
      // collapseUnchanged NOT set — start expanded (user enables via toolbar)
      // revertControls NOT set — opt-in only ("a-to-b" | "b-to-a"), off by default
    });

    // Emit initial stats
    onstats(computeStats(mergeView.chunks, mergeView.a.state.doc, mergeView.b.state.doc));

    return () => mergeView?.destroy();
  });

  // Sync readOnly prop changes via Compartment
  $effect(() => {
    if (!mergeView) return;
    const effect = readOnlyCompartment.reconfigure(EditorState.readOnly.of(readonly));
    mergeView.a.dispatch({ effects: effect });
    mergeView.b.dispatch({ effects: effect });
  });

  // Sync content when props change externally (e.g., swap, session load)
  $effect(() => {
    if (!mergeView) return;
    let changed = false;
    const currentA = mergeView.a.state.doc.toString();
    const currentB = mergeView.b.state.doc.toString();
    if (currentA !== original) {
      mergeView.a.dispatch({
        changes: { from: 0, to: currentA.length, insert: original },
      });
      changed = true;
    }
    if (currentB !== modified) {
      mergeView.b.dispatch({
        changes: { from: 0, to: currentB.length, insert: modified },
      });
      changed = true;
    }
    if (changed) {
      onstats(computeStats(mergeView.chunks, mergeView.a.state.doc, mergeView.b.state.doc));
    }
  });

  // Derived empty / identical states for overlay
  let isEmpty = $derived(!original.trim() && !modified.trim());
  let isIdentical = $derived(original === modified && original.trim().length > 0);
</script>

<div class="diff-editor-wrap">
  <div class="pane-labels" aria-hidden="true">
    <div class="pane-label">Original{#if stats.originalLines > 0}<span class="pane-line-count"> · {stats.originalLines} {stats.originalLines === 1 ? 'line' : 'lines'}</span>{/if}</div>
    <div class="pane-label">Modified{#if stats.modifiedLines > 0}<span class="pane-line-count"> · {stats.modifiedLines} {stats.modifiedLines === 1 ? 'line' : 'lines'}</span>{/if}</div>
  </div>
  <div class="merge-view-container" bind:this={containerEl}></div>

  {#if isEmpty}
    <div class="empty-overlay" role="status">
      <p>Paste text into both sides to compare</p>
    </div>
  {:else if isIdentical}
    <div class="empty-overlay" role="status">
      <p>Texts are identical — no differences found</p>
    </div>
  {/if}
</div>

<style>
  .diff-editor-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    min-width: 0;
  }

  .pane-labels {
    display: flex;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }

  .pane-label {
    flex: 1;
    padding: var(--space-1) var(--space-3);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .pane-line-count {
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .pane-label + .pane-label {
    border-left: 2px solid var(--border);
  }

  .merge-view-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* MergeView fills its container */
  .merge-view-container :global(.cm-mergeView) {
    height: 100%;
  }

  .merge-view-container :global(.cm-mergeViewEditors) {
    height: 100%;
    display: flex;
  }

  .merge-view-container :global(.cm-mergeViewEditor) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    min-width: 0;
  }

  /* Pane divider — stronger border between the two editors */
  .merge-view-container :global(.cm-mergeViewEditor + .cm-mergeViewEditor) {
    border-left: 2px solid var(--border);
  }

  .empty-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    top: 2rem; /* below pane labels */
  }

  .empty-overlay p {
    color: var(--text-muted);
    font-size: 0.9rem;
    background: var(--surface-elevated);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
  }
</style>
