These are raw 720 × 405 RGBA screenshots (gzip compressed, no image header)
from the local Starport Cocos Creator 3.8.8 iOS diagnostic sample. Each pair
contains a saved frame and a later frame incorrectly discarded by the original
whole-screen approximate-static filter. They contain generated game graphics.

Pair 0: player movement, enemies and bullets (2.117 seconds apart).
Pair 1: kills 6 → 9, enemies 3 → 1 (4.099 seconds apart).
Pair 2: kills 11 → 15, enemies 4 → 0 (6.102 seconds apart).

All three have at most 1% changed luminance samples and average luminance
difference below 2.5. Local motion must still keep each later image.
