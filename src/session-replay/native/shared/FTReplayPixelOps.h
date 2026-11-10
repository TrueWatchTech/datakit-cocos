#pragma once

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

namespace ft_cocos {

inline void makeReplayPixelsOpaque(uint8_t* bytes, size_t size) {
    for (size_t alpha = 3; alpha < size; alpha += 4) bytes[alpha] = 255;
}

// Matches the JS full-buffer fingerprint, including unaligned views and tails.
// Keep these loops out of iOS's non-JIT game VM; never sample or omit channels.
inline std::string replayFrameFingerprint(const uint8_t* bytes, size_t size) {
    uint32_t hash = 2166136261U;
    const size_t wordEnd = size - size % 4;
    for (size_t offset = 0; offset < wordEnd; offset += 4) {
        uint32_t word;
        std::memcpy(&word, bytes + offset, sizeof(word));
        hash = (hash ^ word) * 16777619U;
        hash ^= hash >> 16;
    }
    for (size_t offset = wordEnd; offset < size; ++offset) {
        hash = (hash ^ bytes[offset]) * 16777619U;
    }
    char result[64];
    std::snprintf(result, sizeof(result), "%zx-%x", size, static_cast<unsigned int>(hash));
    return result;
}

} // namespace ft_cocos
