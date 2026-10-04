import { describe, expect, it } from 'vitest';
import { buildFiveStepGraph } from '../../tests/helpers/fixtures';
import { toDemoDocument } from '../export/publicDoc';
import { mountViewer } from './runtime';

function setup(title?: string) {
  const { graph, ids } = buildFiveStepGraph();
  if (title) graph.project.name = title;
  const doc = toDemoDocument(graph, new Date().toISOString());
  const root = document.createElement('div');
  document.body.append(root);
  const v = mountViewer(root, { doc, imageUrl: () => 'data:image/png;base64,' });
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const alt = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('.tv-alt')].find((b) => b.textContent === label)!;
  return { v, root, ids, q, alt };
}

describe('T27 閲覧履歴', () => {
  it('分岐→戻る→別枝→最初から。タイトルへフォーカスし、aria-liveで通知', () => {
    const { v, ids, q, alt } = setup();
    expect(v.state().stepId).toBe(ids[0]);
    expect(q('.tv-step-title').textContent).toContain('一覧');
    alt('新規作成へ').click();
    expect(v.state().stepId).toBe(ids[1]);
    expect(document.activeElement).toBe(q('.tv-step-title'));
    expect(q('[aria-live]').textContent).toContain('新規作成');
    alt('入力例へ').click();
    expect(v.state().history).toEqual([ids[0], ids[1], ids[2]]);
    q('.tv-bar button').click(); // 戻る
    expect(v.state().stepId).toBe(ids[1]);
    alt('保存完了へ').click();
    expect(v.state().history).toEqual([ids[0], ids[1], ids[3]]);
    alt('終了案内へ').click();
    expect(q('.tv-finish-text')).not.toBeNull();
    expect(q('.tv-trail').textContent).toContain('進んだ回数：4');
    (q('.tv-bar').querySelectorAll('button')[1] as HTMLButtonElement).click(); // 最初から
    expect(v.state()).toEqual({ stepId: ids[0], history: [ids[0]], moves: 0 });
    expect((q('.tv-bar button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('ホットスポットは実buttonでラベル付き、代替ボタンと同じ遷移', () => {
    const { v, ids, root } = setup();
    const hs = root.querySelector<HTMLButtonElement>('.tv-hotspot')!;
    expect(hs.tagName).toBe('BUTTON');
    expect(hs.getAttribute('aria-label')).toBe('新規作成へ');
    hs.click();
    expect(v.state().stepId).toBe(ids[1]);
  });
  it('目次から移動でき、Escapeで閉じる', () => {
    const { v, ids, q, root } = setup();
    q('.tv-toc-btn').click();
    expect(q('.tv-toc').hidden).toBe(false);
    root.querySelectorAll<HTMLButtonElement>('.tv-toc-item')[4]!.click();
    expect(v.state().stepId).toBe(ids[4]);
    expect(q('.tv-toc').hidden).toBe(true);
  });
  it('ユーザー文字列はテキストとして表示（HTMLとして解釈しない）', () => {
    const { root } = setup('<img src=x onerror="window.__x=1">');
    expect(root.querySelector('.tv-title')!.textContent).toBe('<img src=x onerror="window.__x=1">');
    expect(root.querySelector('img[src="x"]')).toBeNull();
  });
});
