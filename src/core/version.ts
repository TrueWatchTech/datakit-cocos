/** Version of the installed Cocos SDK package. */
export const FT_COCOS_SDK_VERSION = '0.1.1-alpha.4';

/** Event attribute used to identify data emitted through a framework bridge. */
export const FT_COCOS_SDK_BRIDGE_INFO_KEY = 'sdk_bridge_info';

/** Serialized bridge metadata expected by the native SDK data model. */
export const FT_COCOS_SDK_BRIDGE_INFO = JSON.stringify({
  cocos: FT_COCOS_SDK_VERSION,
});
