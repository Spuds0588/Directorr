import { create } from 'zustand';

/**
 * Global app state.
 *
 * Per agents.md the store is intentionally thin: it holds the *outputs* (Blobs)
 * and shared metadata, while the two rendering engines keep their own
 * frame-loop state locally so a re-render never disturbs a running rAF loop.
 */
export const useAppStore = create((set, get) => ({
  // Final compiled recording: { blob, url, size, mimeType, name, mode }
  output: null,
  setOutput: (output) => {
    const previous = get().output;
    if (previous && previous.url && previous.url !== output?.url) {
      URL.revokeObjectURL(previous.url);
    }
    console.log('[Store] output set', { size: output?.size, mimeType: output?.mimeType });
    set({ output });
  },
  clearOutput: () => {
    const previous = get().output;
    if (previous?.url) URL.revokeObjectURL(previous.url);
    set({ output: null });
  },

  // Creator-uploaded ephemeral assets: [{ id, name, size, url, type, path }]
  assets: [],
  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
  removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
  clearAssets: () => set({ assets: [] }),

  // Last generated magic link (used by the Create page after publish).
  magicLink: '',
  setMagicLink: (magicLink) => set({ magicLink }),
}));
