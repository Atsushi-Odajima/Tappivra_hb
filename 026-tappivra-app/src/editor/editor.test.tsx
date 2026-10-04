import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildFiveStepGraph } from '../../tests/helpers/fixtures';
import { MockStorage } from '../platform/mockStorage';
import { ConflictError } from '../platform/storage';
import { Editor } from './Editor';

vi.mock('virtual:tappivra-viewer-runtime', () => ({ runtimeJs: '', runtimeCss: '' }));

class RO {
  observe() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
URL.createObjectURL = () => 'blob:mock';
URL.revokeObjectURL = () => undefined;

async function setup() {
  const storage = new MockStorage();
  storage.controls.saveDelayMs = 50;
  const { graph, images } = buildFiveStepGraph();
  await storage.createProject(
    graph,
    Object.values(graph.assets).map((meta) => ({ meta, bytes: images.get(meta.id)! })),
  );
  const loaded = await storage.loadProject(graph.project.id);
  const utils = render(<Editor storage={storage} initial={loaded} onBack={() => undefined} />);
  return { storage, graph, ...utils };
}

const status = () => screen.getByTestId('save-status').textContent;

describe('T14 自動保存・競合', () => {
  it('最終編集の800ms後に保存し、コミット完了まで「保存済み」を出さない', async () => {
    const { storage, graph } = await setup();
    const spy = vi.spyOn(storage, 'saveProject');
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      fireEvent.click(screen.getByRole('button', { name: /クリック箇所を追加/ }));
      expect(status()).toBe('未保存の変更');
      await act(async () => vi.advanceTimersByTime(700));
      expect(spy).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(120));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(status()).toBe('保存中…');
      await act(async () => vi.advanceTimersByTime(100));
      expect(status()).toBe('保存済み');
      expect((await storage.loadProject(graph.project.id)).project.revision).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('revision不一致は上書きを拒否し、競合として表示', async () => {
    const { storage, graph } = await setup();
    // 別の編集が先に保存された状態
    const other = await storage.loadProject(graph.project.id);
    await storage.saveProject(other, 1);
    await expect(storage.saveProject(other, 1)).rejects.toBeInstanceOf(ConflictError);
    fireEvent.click(screen.getByRole('button', { name: /クリック箇所を追加/ }));
    await waitFor(() => expect(status()).toBe('競合しました'), { timeout: 3000 });
    expect(screen.getByRole('alert').textContent).toMatch(/上書きはしません/);
    expect((await storage.loadProject(graph.project.id)).project.revision).toBe(2);
  });
});

describe('T15 ストレージ失敗', () => {
  it('書込失敗で再試行導線を出し、直前の正常データを保持する', async () => {
    const { storage, graph } = await setup();
    storage.controls.failNextSave = 1;
    fireEvent.click(screen.getByRole('button', { name: /クリック箇所を追加/ }));
    await waitFor(() => expect(status()).toBe('保存できませんでした'), { timeout: 3000 });
    expect(screen.getByRole('alert').textContent).toMatch(/直前に保存できた内容は保持/);
    const kept = await storage.loadProject(graph.project.id);
    expect(kept.project.revision).toBe(1);
    expect(kept.steps[graph.project.stepOrder[0]!]!.hotspots).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'もう一度保存' }));
    await waitFor(() => expect(status()).toBe('保存済み'), { timeout: 3000 });
    expect((await storage.loadProject(graph.project.id)).steps[graph.project.stepOrder[0]!]!.hotspots).toHaveLength(2);
  });
});

describe('エディター表示', () => {
  it('主要ボタンが実ボタンとして存在する', async () => {
    await setup();
    for (const name of ['プレビュー', '書き出し', '＋ クリック箇所を追加', '隠す', 'フィット']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByText('＋ 画像を追加')).toBeInTheDocument();
  });
});
