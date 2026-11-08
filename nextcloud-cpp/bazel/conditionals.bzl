"""Named platform-conditional helpers, modeled on TensorFlow's if_* pattern (if_android, if_mobile, etc), for the axes congelado actually has: OS and CPU, not CUDA/mobile."""

def if_windows(a, otherwise = []):
    return select({"@platforms//os:windows": a, "//conditions:default": otherwise})

def if_linux(a, otherwise = []):
    return select({"@platforms//os:linux": a, "//conditions:default": otherwise})

def if_macos(a, otherwise = []):
    return select({"@platforms//os:macos": a, "//conditions:default": otherwise})

def if_x86_64(a, otherwise = []):
    return select({"@platforms//cpu:x86_64": a, "//conditions:default": otherwise})
