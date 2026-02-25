cmake_minimum_required(VERSION 3.16)
project(skp_translator LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# SketchUp C API SDK
# ---------------------------------------------------------------------------
# Download the SDK from:
#   https://extensions.sketchup.com/sketchup-sdk
# Extract it so that the headers live under:
#   third_party/sketchup-sdk/headers/
# And the library lives under:
#   third_party/sketchup-sdk/binaries/sketchup/x64/  (Linux .so)
# ---------------------------------------------------------------------------

set(SU_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/sketchup-sdk"
    CACHE PATH "Path to extracted SketchUp C SDK")

if(NOT EXISTS "${SU_SDK_DIR}/headers/SketchUpAPI/common.h")
    message(WARNING
        "SketchUp SDK not found at ${SU_SDK_DIR}. "
        "Download from https://extensions.sketchup.com/sketchup-sdk "
        "and extract to third_party/sketchup-sdk/")
endif()

# SDK include path.
include_directories("${SU_SDK_DIR}/headers")
include_directories("${CMAKE_CURRENT_SOURCE_DIR}/include")

# SDK library.
find_library(SU_API_LIB
    NAMES SketchUpAPI
    HINTS "${SU_SDK_DIR}/binaries/sketchup/x64"
          "${SU_SDK_DIR}/binaries/sketchup/arm64"
)

# ---------------------------------------------------------------------------
# Translator executable
# ---------------------------------------------------------------------------
add_executable(skp_translator
    src/main.cpp
    src/wall_extractor.cpp
    src/dxf_writer.cpp
    src/pdf_writer.cpp
)

target_include_directories(skp_translator PRIVATE include)

if(SU_API_LIB)
    target_link_libraries(skp_translator PRIVATE ${SU_API_LIB})
else()
    message(WARNING "SketchUpAPI library not found — link will fail until SDK is installed.")
endif()

# Install.
install(TARGETS skp_translator RUNTIME DESTINATION bin)
