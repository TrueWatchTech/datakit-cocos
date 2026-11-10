#include "../../src/session-replay/native/shared/FTReplayPixelOps.h"
#include <cassert>
#include <iostream>
#include <vector>

int main() {
    for (size_t size : {0U, 1U, 3U, 4U, 9U, 257U, 953280U}) {
        std::vector<uint8_t> storage(size + 2, 91);
        auto* bytes = storage.data() + 1; // Deliberately unaligned.
        for (size_t index = 0; index < size; ++index) bytes[index] = (index * 73 + 19) % 256;
        const auto original = storage;
        std::cout << ft_cocos::replayFrameFingerprint(bytes, size) << '\n';
        assert(storage == original);
        ft_cocos::makeReplayPixelsOpaque(bytes, size);
        assert(storage.front() == 91 && storage.back() == 91);
        for (size_t index = 0; index < size; ++index) {
            assert(bytes[index] == (index % 4 == 3 ? 255 : original[index + 1]));
        }
    }
}
