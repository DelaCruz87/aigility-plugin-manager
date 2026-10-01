declare const eruda: {
  init(options?: { container?: HTMLElement; tool?: unknown[]; useShadowDom?: boolean }): void;
  show(): void;
  hide(): void;
  destroy(): void;
};

export default eruda;
