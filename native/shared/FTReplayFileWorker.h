#pragma once

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace ft_cocos {

// Accessed only by the script thread. Workers own their buffers and never touch JS.
class ReplayFileWorker {
    enum Status { Pending, Written, Removed, Error };
    struct Job {
        std::string path;
        std::atomic<Status> status{Pending};
        std::atomic<bool> cancelled{false};
    };
    std::shared_ptr<Job> current;

public:
    bool write(const unsigned char* bytes, size_t size, const std::string& path) {
        if (current && current->cancelled.load() && current->status.load() != Pending) current.reset();
        if (current || !bytes || size == 0 || size > 2048U * 2048U * 4U || path.empty()) return false;
        try {
            auto job = std::make_shared<Job>();
            job->path = path;
            // This bounded copy is necessary because the JS buffer can be collected/reused.
            std::vector<unsigned char> pixels(bytes, bytes + size);
            current = job;
            std::thread([job](std::vector<unsigned char> data) {
                FILE* file = std::fopen(job->path.c_str(), "wb");
                bool ok = false;
                if (file) {
                    const bool written = std::fwrite(data.data(), 1, data.size(), file) == data.size();
                    ok = std::fclose(file) == 0 && written;
                }
                if (!ok || job->cancelled.load()) std::remove(job->path.c_str());
                job->status.store(ok ? Written : Error);
                // Covers cleanup racing with the final status transition.
                if (job->cancelled.load()) std::remove(job->path.c_str());
            }, std::move(pixels)).detach();
        } catch (...) {
            current.reset();
            return false;
        }
        return true;
    }

    bool remove(const std::string& path) {
        if (!current || current->path != path || current->status.load() != Written) return false;
        auto job = current;
        job->status.store(Pending);
        try {
            std::thread([job]() {
                const bool ok = std::remove(job->path.c_str()) == 0 || errno == ENOENT;
                job->status.store(ok ? Removed : Error);
            }).detach();
        } catch (...) {
            job->status.store(Written);
            return false;
        }
        return true;
    }

    const char* poll() {
        if (!current) return "error";
        switch (current->status.load()) {
            case Pending: return "pending";
            case Written: return "written";
            case Removed: current.reset(); return "removed";
            case Error: current.reset(); return "error";
        }
        return "error";
    }

    void cancel() {
        if (!current) return;
        auto job = current;
        job->cancelled.store(true);
        if (job->status.load() == Written) remove(job->path);
        // Keep the slot occupied until its worker exits, including across VM restarts.
    }
};

} // namespace ft_cocos
