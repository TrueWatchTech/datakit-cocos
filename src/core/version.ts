/** Version of the installed Cocos SDK package. */
export const FT_COCOS_SDK_VERSION = '0.1.0-alpha.3';

/** Global-context key used to report the Cocos SDK package version. */
export const FT_COCOS_SDK_VERSION_KEY = 'sdk_package_cocos';

/** Event attribute used to identify data emitted through a framework bridge. */
export const FT_COCOS_SDK_BRIDGE_INFO_KEY = 'sdk_bridge_info';

/** Serialized bridge metadata expected by the native SDK data model. */
export const FT_COCOS_SDK_BRIDGE_INFO = JSON.stringify({
  cocos: FT_COCOS_SDK_VERSION,
});
