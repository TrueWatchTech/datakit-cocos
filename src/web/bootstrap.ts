import { FTCocosWebSDK } from './client.js';
import { platformGlobal } from '../core/platform-runtime.js';
import { FT_COCOS_SDK_VERSION } from '../core/version.js';
import type { FTWebWindow } from './types.js';

/** Available before game modules, with Browser collectors initialized by bootstrapWeb(). */
platformGlobal().__FT_COCOS_WEB_FACTORY__ = {
  protocol: 1,
  version: FT_COCOS_SDK_VERSION,
  create: (context, target) => new FTCocosWebSDK(context.hooks, context.canvasIsPublic, target as FTWebWindow),
};
export { bootstrapWeb } from './runtime.js';
export type { FTCocosWebConfig, FTWebConfig, FTWebReplayConfig } from './types.js';
