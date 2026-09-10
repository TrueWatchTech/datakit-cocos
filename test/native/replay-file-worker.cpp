#include "../../native/shared/FTReplayFileWorker.h"
#include <cassert>
#include <fstream>
#include <iterator>
#include <chrono>

static std::string wait(ft_cocos::ReplayFileWorker& worker) {
    for (int i = 0; i < 5000; ++i) {
        const std::string status = worker.poll();
        if (status != "pending") return status;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    assert(false && "file worker timed out");
    return "timeout";
}

int main(int argc, char** argv) {
    assert(argc == 2);
    ft_cocos::ReplayFileWorker worker;
    const std::string path = std::string(argv[1]) + "/frame.rgba";
    std::vector<unsigned char> bytes(1024 * 1024, 42);
    assert(worker.write(bytes.data(), bytes.size(), path));
    assert(!worker.write(bytes.data(), bytes.size(), path));
    std::fill(bytes.begin(), bytes.end(), 0);
    assert(wait(worker) == "written");
    std::ifstream input(path, std::ios::binary);
    const std::vector<unsigned char> saved((std::istreambuf_iterator<char>(input)), {});
    assert(saved.size() == bytes.size());
    for (auto value : saved) assert(value == 42);
    input.close();
    assert(!worker.write(bytes.data(), bytes.size(), path));
    assert(!worker.remove(path + "-stale"));
    assert(worker.remove(path));
    assert(wait(worker) == "removed");
    assert(!std::ifstream(path).good());
    assert(worker.write(bytes.data(), bytes.size(), path + "/missing/frame"));
    assert(wait(worker) == "error");
    assert(worker.write(bytes.data(), bytes.size(), path));
    assert(wait(worker) == "written");
    worker.cancel();
    for (int i = 0; i < 5000 && std::ifstream(path).good(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    assert(!std::ifstream(path).good());
    return 0;
}
