# YABDP4Nitro Stream Bypass — Unbound experimental port

This is an **experimental Unbound/mobile port** of the stream-related part of YABDP4Nitro.

## What it tries to do

- Target **1440p / 60 FPS** based on the supplied YABDP4Nitro configuration.
- Port the original `streamBypass` bitrate logic.
- Apply a screen-share permission hook when the current Discord build exposes one of the known method names.
- Inspect `ApplicationStreamingSettingsStore` without blindly modifying it.

## Important limitation

The original YABDP4Nitro implementation targets **BetterDiscord/Desktop Discord**. Mobile Discord uses different internal modules. Therefore this plugin is deliberately conservative: it only patches methods that are actually found through Unbound Metro.

A successful plugin load **does not automatically mean 1440p/60 is actually accepted by Discord or the server**. The next step is to test the exact Discord mobile build and then add a version-specific patch for its streaming settings store.

## Configuration

Open `index.js` and edit `CONFIG`:

```js
resolution: 1440,
fps: 60,
customBitrateEnabled: false,
minBitrateKbps: -1,
targetBitrateKbps: -1,
maxBitrateKbps: -1,
voiceBitrateKbps: -1,
screenSharingBypass: true,
debug: true,
```

## Testing

1. Load the plugin in Unbound.
2. Start a Discord screen share.
3. Check the Unbound/Discord JavaScript console for `[YABDP4Nitro-Unbound]` messages.
4. Report whether `qualityPatched` and `sharePatched` are `true` or `false`.
5. If the quality store exposes `resolution` / `fps`, the next patch can target that exact setter.
