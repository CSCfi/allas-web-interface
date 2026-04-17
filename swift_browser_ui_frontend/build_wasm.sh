#!/usr/bin/env sh

set -e

SCRIPT="$(realpath "$0")"
SCRIPT_ROOT=$(dirname "$SCRIPT")
WASM_ROOT="${SCRIPT_ROOT}/wasm"

buildWasm() {
    mkdir -p "${WASM_ROOT}/build"
    (
        cd "$SCRIPT_ROOT"
        npx webpack --config "${WASM_ROOT}/wasm-webpack.config.js"
    )

    if [ "$1" = "docker" ]; then
        docker run --rm -it --mount type=bind,source="${WASM_ROOT}",target=/src/ ghcr.io/cscfi/docker-emscripten-crypt4gh all
    elif [ "$1" = "emsdk" ]; then
        bash -lc 'source /emsdk/emsdk_env.sh && cd "'"$WASM_ROOT"'" && emmake make all'
    fi
}

if [ -f "/emsdk/emsdk_env.sh" ]; then
    echo "Running in an environment with emsdk. Building WASM contents using that."
    export EMCC_CFLAGS="-I/emsdk/upstream/include -L/emsdk/upstream/lib -sINITIAL_MEMORY=26214400"
    export EMCC_FORCE_STDLIBS="libc"

    bash -lc 'source /emsdk/emsdk_env.sh && cd "'"$WASM_ROOT"'" && emmake make clean'
    buildWasm "emsdk"
else
    echo "emsdk was not available, checking for docker"
    [ ! -x "$(command -v docker)" ] && echo "Docker is used to build the javascript WebAssembly dependencies, but it's not installed." && exit 1
    if ! docker version > /dev/null 2>&1; then echo "Docker is installed, but it seems like there's an error."; exit 1; fi

    docker run --rm -it --mount type=bind,source="${WASM_ROOT}",target=/src/ ghcr.io/cscfi/docker-emscripten-crypt4gh clean
    buildWasm "docker"
fi

cp "${WASM_ROOT}/build/upworker.js" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/downworker.js" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/upworker-post.js.map" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/downworker-post.js.map" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/upworker.wasm" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/downworker.wasm" "${SCRIPT_ROOT}/public/"

cp "${WASM_ROOT}/build/s3upworker.js" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/s3upworker.wasm" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/s3upworker-post.js.map" "${SCRIPT_ROOT}/public/"

cp "${WASM_ROOT}/build/s3downworker.js" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/s3downworker.wasm" "${SCRIPT_ROOT}/public/"
cp "${WASM_ROOT}/build/s3downworker-post.js.map" "${SCRIPT_ROOT}/public/"