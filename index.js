/*
 * YABDP4Nitro Stream Bypass — Unbound experimental port
 *
 * Original project: https://github.com/riolubruh/YABDP4Nitro
 * Original author: Riolubruh
 *
 * YABDP4Nitro is licensed under OSL-3.0.
 * This derivative keeps the attribution/license notice.
 * License: https://opensource.org/license/osl-3-0-php
 *
 * IMPORTANT:
 * The original streamBypass was written for BetterDiscord/Desktop Discord.
 * This file is an EXPERIMENTAL mobile/Unbound port. Discord's mobile
 * internal modules are different, so successful patch discovery is required.
 */

import { unbound } from "@unbound-app/api";

const CONFIG = {
  // Main goal copied from the supplied YABDP4Nitro configuration.
  resolution: 1440,
  fps: 60,

  // Set to true to override bitrate values.
  customBitrateEnabled: false,
  minBitrateKbps: -1,
  targetBitrateKbps: -1,
  maxBitrateKbps: -1,
  voiceBitrateKbps: -1,

  // The original plugin exposes a screenSharing bypass switch.
  screenSharingBypass: true,

  // Useful while we are testing against a particular Discord mobile build.
  debug: true,
};

const patches = [];
const seen = new Set();

function log(...args) {
  if (CONFIG.debug) console.info("[YABDP4Nitro-Unbound]", ...args);
}

function warn(...args) {
  console.warn("[YABDP4Nitro-Unbound]", ...args);
}

function toBps(kbps) {
  return typeof kbps === "number" && kbps >= 0 ? kbps * 1000 : null;
}

function rememberPatch(target, key, original) {
  patches.push({ target, key, original });
}

function replaceMethod(target, key, factory) {
  if (!target || typeof target[key] !== "function") return false;
  if (seen.has(target)) return false;

  const original = target[key];
  const patched = factory(original);
  if (typeof patched !== "function") return false;

  target[key] = patched;
  rememberPatch(target, key, original);
  seen.add(target);
  log("patched", key, target);
  return true;
}

function restoreAll() {
  for (let i = patches.length - 1; i >= 0; i--) {
    const { target, key, original } = patches[i];
    try {
      target[key] = original;
    } catch (e) {
      console.warn("[YABDP4Nitro-Unbound] failed to restore", key, e);
    }
  }
  patches.length = 0;
  seen.clear();
}

function getPropsModule(...props) {
  try {
    return unbound?.metro?.findByProps?.(...props) ?? null;
  } catch (e) {
    log("findByProps failed", props, e);
    return null;
  }
}

function getStore(name) {
  try {
    return unbound?.metro?.findStore?.(name) ?? null;
  } catch (e) {
    log("findStore failed", name, e);
    return null;
  }
}

function patchVideoQualityModule() {
  const candidates = [];

  // Discord versions can export the class differently. Try both the direct
  // module and a few tightly-scoped property combinations.
  const direct = getPropsModule("updateVideoQuality");
  if (direct) candidates.push(direct, direct.default);

  const byQuality = getPropsModule(
    "updateVideoQuality",
    "setVoiceBitRate"
  );
  if (byQuality) candidates.push(byQuality, byQuality.default);

  let patched = false;

  for (const candidate of candidates) {
    if (!candidate) continue;

    // Desktop YABDP4Nitro patches the prototype.
    if (candidate.prototype?.updateVideoQuality) {
      patched ||= replaceMethod(
        candidate.prototype,
        "updateVideoQuality",
        (original) => function patchedUpdateVideoQuality(...args) {
          applyQualityOverrides(this);
          return original.apply(this, args);
        }
      );
    }

    // Some mobile builds expose the methods directly.
    if (typeof candidate.updateVideoQuality === "function") {
      patched ||= replaceMethod(
        candidate,
        "updateVideoQuality",
        (original) => function patchedUpdateVideoQuality(...args) {
          applyQualityOverrides(this);
          return original.apply(this, args);
        }
      );
    }
  }

  return patched;
}

function applyQualityOverrides(connection) {
  try {
    const vqm = connection?.videoQualityManager;
    if (!vqm) return;

    // This is the core logic carried over from YABDP4Nitro's streamBypass:
    // setGoliveQuality(...) plus the videoBitrateFloor override.
    const quality = {
      bitrateMax:
        CONFIG.customBitrateEnabled && CONFIG.maxBitrateKbps > 0
          ? toBps(CONFIG.maxBitrateKbps)
          : null,
      bitrateMin:
        CONFIG.customBitrateEnabled && CONFIG.minBitrateKbps >= 0
          ? toBps(CONFIG.minBitrateKbps)
          : null,
      bitrateTarget:
        CONFIG.customBitrateEnabled && CONFIG.targetBitrateKbps >= 0
          ? toBps(CONFIG.targetBitrateKbps)
          : null,
    };

    if (typeof CONFIG.voiceBitrateKbps === "number" && CONFIG.voiceBitrateKbps >= 0) {
      if (typeof connection.setVoiceBitRate === "function") {
        connection.setVoiceBitRate(toBps(CONFIG.voiceBitrateKbps));
      }
    }

    if (vqm.options && CONFIG.customBitrateEnabled) {
      vqm.options.videoBitrateFloor =
        CONFIG.minBitrateKbps > 0 ? toBps(CONFIG.minBitrateKbps) : 150000;
    }

    if (typeof vqm.setGoliveQuality === "function") {
      vqm.setGoliveQuality(quality);
    }

    if (
      connection.context === "default" &&
      typeof vqm.setQualityOverwrite === "function"
    ) {
      vqm.setQualityOverwrite({ ...quality });
    }

    // These are only applied when the current build actually exposes such
    // option keys. We never invent a property on the object, which keeps this
    // experimental port conservative across Discord versions.
    if (vqm.options && typeof vqm.options === "object") {
      const fpsKeys = ["fps", "frameRate", "maxFramerate", "maxFrameRate"];
      for (const key of fpsKeys) {
        if (key in vqm.options) vqm.options[key] = CONFIG.fps;
      }

      const resolutionKeys = ["resolution", "maxResolution"];
      for (const key of resolutionKeys) {
        if (key in vqm.options) vqm.options[key] = CONFIG.resolution;
      }
    }
  } catch (e) {
    warn("quality override failed", e);
  }
}

function patchScreenSharePermission() {
  if (!CONFIG.screenSharingBypass) return false;

  // Method names differ between Discord mobile versions. Only patch a method
  // when the exact property is present, rather than scanning every module.
  const methodCandidates = [
    "isScreenShareAllowed",
    "canScreenShare",
    "canUseScreenShare",
    "canStartScreenShare",
    "isScreensharingAllowed",
  ];

  let patched = false;

  for (const key of methodCandidates) {
    const mod = getPropsModule(key);
    if (!mod) continue;

    if (typeof mod[key] === "function") {
      patched ||= replaceMethod(mod, key, () => function patchedPermission() {
        return true;
      });
    }

    if (mod.prototype && typeof mod.prototype[key] === "function") {
      patched ||= replaceMethod(mod.prototype, key, () => function patchedPermission() {
        return true;
      });
    }
  }

  return patched;
}

function inspectStreamingStore() {
  const store = getStore("ApplicationStreamingSettingsStore");
  if (!store) {
    log("ApplicationStreamingSettingsStore not found");
    return;
  }

  try {
    const state =
      typeof store.getState === "function" ? store.getState() : undefined;

    log("ApplicationStreamingSettingsStore found", {
      hasGetState: typeof store.getState === "function",
      stateKeys: state && typeof state === "object" ? Object.keys(state) : [],
      currentResolution: state?.resolution,
      currentFps: state?.fps,
    });

    // We intentionally do NOT mutate the store blindly. The mobile stream
    // settings store is the next target if the Discord build exposes a stable
    // setter/dispatcher; this first port only records what is actually there.
  } catch (e) {
    warn("store inspection failed", e);
  }
}

function start() {
  log("starting", CONFIG);

  const qualityPatched = patchVideoQualityModule();
  const sharePatched = patchScreenSharePermission();

  inspectStreamingStore();

  log("result", {
    qualityPatched,
    sharePatched,
    patchCount: patches.length,
    target: `${CONFIG.resolution}p @ ${CONFIG.fps} FPS`,
  });

  console.info(
    `[YABDP4Nitro-Unbound] target stream settings: ${CONFIG.resolution}p @ ${CONFIG.fps} FPS`
  );
  console.info(
    "[YABDP4Nitro-Unbound] If no quality module was patched, this Discord mobile build needs a version-specific Metro target."
  );
}

function stop() {
  restoreAll();
  log("stopped");
}

export default {
  start,
  stop,
};
