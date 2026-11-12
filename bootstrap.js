/**
 * Zotero JournalFlow - Bootstrap Entry
 * Targets Zotero 10 ~ 12 (Gecko 140+ / 153+ modern bootstrap architecture)
 */

/* global Cc, Ci, ChromeUtils, Services, ADDON_UPGRADE, ADDON_INSTALL, ADDON_DOWNGRADE, APP_SHUTDOWN */
"use strict";

var Zotero;
var chromeHandle = null;
var prefPaneId = null;
var startupGeneration = 0;
var cancelZoteroWait = null;

function resolveZoteroFromWindow(domWindow) {
  try {
    return domWindow?.Zotero || domWindow?.wrappedJSObject?.Zotero || null;
  } catch (_) {
    return null;
  }
}

async function waitForZotero() {
  if (typeof Zotero !== "undefined" && Zotero) {
    await Zotero.initializationPromise;
    return;
  }

  const pendingWindows = [];
  const windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    const domWindow = windows.getNext();
    const found = resolveZoteroFromWindow(domWindow);
    if (found) {
      Zotero = found;
      await Zotero.initializationPromise;
      return;
    }
    pendingWindows.push(domWindow);
  }

  await new Promise((resolve) => {
    let settled = false;
    const loads = new Map();
    const cleanup = () => {
      try {
        Services.wm.removeListener(listener);
      } catch (_) {}
      for (const [win, handler] of loads) {
        try {
          win.removeEventListener("load", handler, false);
        } catch (_) {}
      }
      loads.clear();
      cancelZoteroWait = null;
    };
    cancelZoteroWait = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const finish = (domWindow) => {
      if (settled) return;
      const found = resolveZoteroFromWindow(domWindow);
      if (!found) return;
      Zotero = found;
      settled = true;
      cleanup();
      resolve();
    };
    const attachLoad = (domWindow) => {
      if (settled || !domWindow?.addEventListener) return;
      const loadHandler = () => {
        domWindow.removeEventListener("load", loadHandler, false);
        finish(domWindow);
      };
      loads.set(domWindow, loadHandler);
      domWindow.addEventListener("load", loadHandler, false);
      finish(domWindow);
    };
    const listener = {
      onOpenWindow(aWindow) {
        const domWindow = aWindow
          .QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
        attachLoad(domWindow);
      },
    };
    pendingWindows.forEach(attachLoad);
    if (!settled) {
      Services.wm.addListener(listener);
    }
  });

  if (Zotero) {
    await Zotero.initializationPromise;
  }
}

function install() {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  const generation = ++startupGeneration;
  try {
    await waitForZotero();
    if (generation !== startupGeneration || !Zotero) return;

    if (
      typeof Services !== "undefined" &&
      Services?.obs?.notifyObservers &&
      typeof ADDON_UPGRADE !== "undefined" &&
      (reason === ADDON_UPGRADE || reason === ADDON_INSTALL || reason === ADDON_DOWNGRADE)
    ) {
      try {
        Services.obs.notifyObservers(null, "startupcache-invalidate", null);
      } catch (_) {}
    }

    if (!rootURI && resourceURI) {
      rootURI = resourceURI.spec;
    }
    if (rootURI && !rootURI.endsWith("/")) {
      rootURI += "/";
    }
    if (generation !== startupGeneration) return;

    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup
    );
    const manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "journalflow", rootURI + "chrome/content/"],
      ["locale", "journalflow", "en-US", rootURI + "locale/en-US/"],
      ["locale", "journalflow", "zh-CN", rootURI + "locale/zh-CN/"],
    ]);

    const mainWindow =
      Zotero.getMainWindow?.() ||
      Services.wm.getMostRecentWindow("navigator:browser");
    const ctx = {
      rootURI,
      addonId: id,
      version,
      Zotero,
      Services,
      Cc,
      Ci,
      ChromeUtils,
      IOUtils: typeof IOUtils !== "undefined" ? IOUtils : mainWindow?.IOUtils,
      PathUtils: typeof PathUtils !== "undefined" ? PathUtils : mainWindow?.PathUtils,
      fetch: typeof fetch !== "undefined" ? fetch : mainWindow?.fetch?.bind(mainWindow),
      AbortController: typeof AbortController !== "undefined" ? AbortController : mainWindow?.AbortController,
      DOMParser: typeof DOMParser !== "undefined" ? DOMParser : mainWindow?.DOMParser,
      URL: typeof URL !== "undefined" ? URL : mainWindow?.URL,
      URLSearchParams: typeof URLSearchParams !== "undefined" ? URLSearchParams : mainWindow?.URLSearchParams,
      setTimeout: typeof setTimeout !== "undefined" ? setTimeout : mainWindow?.setTimeout?.bind(mainWindow),
      clearTimeout: typeof clearTimeout !== "undefined" ? clearTimeout : mainWindow?.clearTimeout?.bind(mainWindow),
    };

    Services.scriptloader.loadSubScript(`${rootURI}chrome/content/scripts/index.js`, ctx);
    if (generation !== startupGeneration) {
      await Zotero?.JournalFlow?.shutdown?.();
      return;
    }

    prefPaneId = Zotero.PreferencePanes.register({
      pluginID: id,
      src: `${rootURI}chrome/content/preferences.xhtml`,
      scripts: [`${rootURI}chrome/content/scripts/preferences.js`],
      image: `${rootURI}chrome/content/icons/icon-48.png`,
      defaultXUL: true,
    });
  } catch (error) {
    Zotero?.logError?.(`[JournalFlow] Failed to startup addon: ${error}`);
    if (generation === startupGeneration && chromeHandle) {
      try {
        chromeHandle.destruct();
      } catch (_) {}
      chromeHandle = null;
    }
  }
}

async function shutdown({ resourceURI, rootURI }, reason) {
  ++startupGeneration;
  cancelZoteroWait?.();
  if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) {
    return;
  }
  try {
    try {
      Services?.obs?.notifyObservers?.(null, "startupcache-invalidate", null);
    } catch (_) {}
    if (typeof Zotero === "undefined") {
      Zotero = Cc["@zotero.org/Zotero;1"]?.getService?.(Ci.nsISupports)?.wrappedJSObject;
    }
    if (prefPaneId) {
      try {
        Zotero?.PreferencePanes?.unregister?.(prefPaneId);
      } catch (_) {}
      prefPaneId = null;
    }
    await Zotero?.JournalFlow?.shutdown?.();
  } catch (error) {
    Zotero?.logError?.(`[JournalFlow] Error during shutdown: ${error}`);
  }
  try {
    const scriptRootURI = rootURI || resourceURI?.spec;
    if (scriptRootURI) {
      const normalized = scriptRootURI.endsWith("/") ? scriptRootURI : `${scriptRootURI}/`;
      ChromeUtils.unload?.(`${normalized}chrome/content/scripts/index.js`);
      ChromeUtils.unload?.(`${normalized}chrome/content/scripts/preferences.js`);
    }
  } catch (_) {}
  if (chromeHandle) {
    try {
      chromeHandle.destruct();
    } catch (error) {
      Zotero?.logError?.(`[JournalFlow] Failed to release chrome handle: ${error}`);
    } finally {
      chromeHandle = null;
    }
  }
}

function uninstall() {}

async function onMainWindowLoad({ window }) {
  await Zotero?.JournalFlow?.onMainWindowLoad?.(window);
}

async function onMainWindowUnload({ window }) {
  await Zotero?.JournalFlow?.onMainWindowUnload?.(window);
}
