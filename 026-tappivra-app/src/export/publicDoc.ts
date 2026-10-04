import { newId } from '../domain/ids';
import type { DemoDocument, ProjectGraph } from '../domain/types';

/**
 * 編集モデル→公開DemoDocument（許可リスト方式）。
 * privateNotes・description(プロジェクト)・履歴・ExportRecord・作成日時・パスは含めない。
 */
export function toDemoDocument(g: ProjectGraph, generatedAt: string): DemoDocument {
  const steps = g.project.stepOrder.map((id) => {
    const s = g.steps[id]!;
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      altText: s.altText,
      kind: s.kind,
      assetId: s.imageAssetId,
      hotspots: [...s.hotspots]
        .sort((a, b) => a.order - b.order)
        .map((h, i) => ({ id: h.id, label: h.label, helpText: h.helpText, rect: { ...h.rect }, targetStepId: h.targetStepId!, order: i })),
    };
  });
  const used = [...new Set(steps.map((s) => s.assetId))];
  const assets = used.map((aid) => {
    const a = g.assets[aid]!;
    return {
      id: a.id,
      path: `media/${a.id}.${a.mime === 'image/png' ? 'png' : 'jpg'}`,
      mime: a.mime,
      width: a.width,
      height: a.height,
      byteLength: a.byteLength,
      sha256: a.sha256,
    };
  });
  return {
    format: 'tappivra-demo',
    schemaVersion: 1,
    id: newId(),
    productLabel: g.project.brand.productLabel,
    title: g.project.name,
    locale: 'ja',
    startStepId: g.project.entryStepId!,
    steps,
    assets,
    theme: { accentHex: g.project.brand.accentHex },
    generatedAt,
  };
}

export function slugify(name: string): string {
  const ascii = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return ascii || 'demo';
}

/** JSONを<script type="application/json">へ安全に埋め込むためのエスケープ */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
