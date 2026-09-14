#pragma once

#if __has_include("bindings/jswrapper/SeApi.h")
#define FT_COCOS_CREATOR3 1
#include "bindings/jswrapper/SeApi.h"
#else
#include "cocos/scripting/js-bindings/jswrapper/SeApi.h"
#endif
#include "FTReplayFileWorker.h"

namespace ft_cocos {

static ReplayFileWorker replayFiles;

static bool writeReplayFile(se::State& state) {
    const auto& args = state.args();
    if (args.size() != 2 || !args[0].isObject() || !args[1].isString()) return false;
    auto* object = args[0].toObject();
    if (!object->isTypedArray()) return false;
    uint8_t* bytes = nullptr;
    size_t size = 0;
    if (!object->getTypedArrayData(&bytes, &size)) return false;
    state.rval().setBoolean(replayFiles.write(bytes, size, args[1].toString()));
    return true;
}
SE_BIND_FUNC(writeReplayFile)

static bool pollReplayFile(se::State& state) {
    state.rval().setString(replayFiles.poll());
    return true;
}
SE_BIND_FUNC(pollReplayFile)

static bool removeReplayFile(se::State& state) {
    const auto& args = state.args();
    if (args.size() != 1 || !args[0].isString()) return false;
    state.rval().setBoolean(replayFiles.remove(args[0].toString()));
    return true;
}
SE_BIND_FUNC(removeReplayFile)

static bool registerReplayFileBridge(se::Object* global) {
    replayFiles.cancel();
    const se::HandleObject bridge(se::Object::createPlainObject());
    bridge->defineFunction("write", _SE(writeReplayFile));
    bridge->defineFunction("poll", _SE(pollReplayFile));
    bridge->defineFunction("remove", _SE(removeReplayFile));
    global->setProperty("__ftCocosReplayFile", se::Value(bridge));
    se::ScriptEngine::getInstance()->addBeforeCleanupHook([]() { replayFiles.cancel(); });
    return true;
}

static void installReplayFileBridge() {
#if FT_COCOS_CREATOR3
    se::ScriptEngine::getInstance()->addPermanentRegisterCallback(registerReplayFileBridge);
#else
    // Creator 2 calls AppDelegate again when restarting its script VM.
    se::ScriptEngine::getInstance()->addRegisterCallback(registerReplayFileBridge);
#endif
}

} // namespace ft_cocos
