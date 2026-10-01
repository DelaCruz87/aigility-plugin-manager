export class App {}

export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand() {}
  addSettingTab() {}
  register() {}
  registerEvent() {}
  registerInterval() {}
  registerView() {}
}

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class ItemView {}
export class Modal {}
export class Menu {}
export class Setting {}
export class Notice {}

export const Platform = {
  isDesktopApp: true,
  isDesktop: true,
  isMobile: false,
};

export const apiVersion = '1.14.3';

let requestUrlHandler;

export function setRequestUrlHandler(handler) {
  requestUrlHandler = handler;
}

export async function requestUrl(request) {
  if (!requestUrlHandler) {
    throw new Error('obsidian-stub requestUrl must be configured by the test');
  }
  return requestUrlHandler(request);
}
