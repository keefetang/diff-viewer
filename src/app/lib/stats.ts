import type { Text } from '@codemirror/state';
import type { DiffStats } from './types';

interface Chunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/**
 * Compute diff stats from MergeView chunks and the two editor documents.
 *
 * Chunk positions (fromA, toA, fromB, toB) are CHARACTER OFFSETS into the
 * document — not line numbers. `toA`/`toB` are exclusive end positions
 * pointing to the start of the first unchanged line after the chunk (or
 * past the end of the document).
 *
 * To convert to a line count: `lineAt(to - 1).number - lineAt(from).number + 1`
 * when `to > from`, or 0 for a pure insertion / pure deletion chunk.
 */
export function computeStats(
  chunks: readonly Chunk[],
  docA: Text,
  docB: Text,
): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const chunk of chunks) {
    deletions +=
      chunk.toA > chunk.fromA
        ? docA.lineAt(chunk.toA - 1).number - docA.lineAt(chunk.fromA).number + 1
        : 0;
    additions +=
      chunk.toB > chunk.fromB
        ? docB.lineAt(chunk.toB - 1).number - docB.lineAt(chunk.fromB).number + 1
        : 0;
  }
  return {
    additions,
    deletions,
    chunks: chunks.length,
    originalLines: docA.lines,
    modifiedLines: docB.lines,
  };
}

export function formatStats(stats: DiffStats): string {
  if (stats.chunks === 0) return '';
  const parts: string[] = [];
  if (stats.additions > 0) parts.push(`+${stats.additions}`);
  if (stats.deletions > 0) parts.push(`\u2212${stats.deletions}`);
  parts.push(`\u00b7${stats.chunks}\u00a0${stats.chunks === 1 ? 'change' : 'changes'}`);
  return parts.join('  ');
}

/** Detailed tooltip text for stats hover. */
export function formatStatsTooltip(stats: DiffStats): string {
  const lines: string[] = [
    `Lines: ${stats.originalLines} original \u2192 ${stats.modifiedLines} modified`,
  ];
  if (stats.additions > 0) {
    lines.push(`Additions: +${stats.additions} ${stats.additions === 1 ? 'line' : 'lines'}`);
  }
  if (stats.deletions > 0) {
    lines.push(`Deletions: \u2212${stats.deletions} ${stats.deletions === 1 ? 'line' : 'lines'}`);
  }
  lines.push(`Changed regions: ${stats.chunks}`);
  return lines.join('\n');
}
