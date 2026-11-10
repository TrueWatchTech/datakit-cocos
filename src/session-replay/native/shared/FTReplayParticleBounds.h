#pragma once

#if !FT_COCOS_CREATOR3 && __has_include("cocos/editor-support/MiddlewareManager.h")
#define FT_COCOS_PARTICLE_BOUNDS 1
#include "cocos/editor-support/MiddlewareManager.h"
#include "cocos/renderer/scene/NodeProxy.hpp"
#include "cocos/renderer/scene/assembler/CustomAssembler.hpp"
#include "cocos/renderer/renderer/InputAssembler.h"
#include "cocos/renderer/gfx/VertexBuffer.h"
#include "cocos/renderer/renderer/EffectVariant.hpp"
#include "cocos/scripting/js-bindings/auto/jsb_renderer_auto.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace ft_cocos {

// Read only the indices submitted by this emitter, not the shared middleware buffer.
static bool readReplayParticleBounds(se::State& state) {
    state.rval().setNull();
    const auto& args = state.args();
    if (args.size() != 1 || !args[0].isObject()) return true;
    auto* object = args[0].toObject();
    if (object->_getClass() != __jsb_cocos2d_renderer_NodeProxy_class) return true;
    auto* node = static_cast<cocos2d::renderer::NodeProxy*>(object->getPrivateData());
    if (!node) return true;
    auto* assembler = dynamic_cast<cocos2d::renderer::CustomAssembler*>(node->getAssembler());
    if (!assembler || assembler->getIACount() == 0) return true;
    auto* buffer = cocos2d::middleware::MiddlewareManager::getInstance()->getMeshBuffer(VF_XYUVC);
    auto& vertices = buffer->getVB();
    auto& indices = buffer->getIB();
    float minX = std::numeric_limits<float>::infinity();
    float minY = minX;
    float minZ = minX;
    float maxX = -minX;
    float maxY = -minX;
    float maxZ = -minX;
    bool found = false;
    size_t inspected = 0;
    for (size_t i = 0; i < assembler->getIACount(); ++i) {
        auto* ia = assembler->getIA(i);
        if (!ia || ia->getCount() == 0) continue;
        auto* effect = assembler->getEffect(i);
        if (!effect) return true;
        const auto* useModel = effect->getDefine("CC_USE_MODEL");
        if (!useModel || useModel->getType() != cocos2d::Value::Type::BOOLEAN) return true;
        // JSB can change positionType without refreshing the material define.
        // Follow the submitted shader as well as the assembler's model matrix.
        const auto* model = assembler->getUseModel() && useModel->asBool()
            ? (assembler->getCustomWorldMatrix() ? assembler->getCustomWorldMatrix() : &node->getWorldMatrix()) : nullptr;
        auto* vb = ia->getVertexBuffer();
        if (!vb || vb != buffer->getGLVB() || ia->getIndexBuffer() != buffer->getGLIB()
            || vb->getFormat().getBytes() != 20 || ia->getStart() < 0 || ia->getCount() < 0) return true;
        const auto start = static_cast<size_t>(ia->getStart());
        const auto count = static_cast<size_t>(ia->getCount());
        if (start > indices.getCurPos() / 2 || count > indices.getCurPos() / 2 - start
            || count > 1000000 - inspected) return true;
        inspected += count;
        for (size_t j = start; j < start + count; ++j) {
            uint16_t index = 0;
            std::memcpy(&index, indices.getBuffer() + j * 2, sizeof(index));
            const size_t offset = static_cast<size_t>(index) * 20;
            if (offset > vertices.getCurPos() || vertices.getCurPos() - offset < 8) return true;
            float x = 0; float y = 0;
            std::memcpy(&x, vertices.getBuffer() + offset, sizeof(x));
            std::memcpy(&y, vertices.getBuffer() + offset + 4, sizeof(y));
            if (!std::isfinite(x) || !std::isfinite(y)) return true;
            cocos2d::Vec3 point(x, y, 0);
            if (model) model->transformPoint(&point);
            if (!std::isfinite(point.x) || !std::isfinite(point.y) || !std::isfinite(point.z)) return true;
            minX = std::min(minX, point.x); minY = std::min(minY, point.y); minZ = std::min(minZ, point.z);
            maxX = std::max(maxX, point.x); maxY = std::max(maxY, point.y); maxZ = std::max(maxZ, point.z);
            found = true;
        }
    }
    if (!found) return true;
    const se::HandleObject bounds(se::Object::createArrayObject(6));
    bounds->setArrayElement(0, se::Value(minX));
    bounds->setArrayElement(1, se::Value(minY));
    bounds->setArrayElement(2, se::Value(minZ));
    bounds->setArrayElement(3, se::Value(maxX));
    bounds->setArrayElement(4, se::Value(maxY));
    bounds->setArrayElement(5, se::Value(maxZ));
    state.rval().setObject(bounds);
    return true;
}
SE_BIND_FUNC(readReplayParticleBounds)

} // namespace ft_cocos
#endif
