#!/usr/bin/env bash
# Fidelity test for custom environment layers (../layer): builds a layer in
# one container of a preset, mounts it in a fresh container of the same image
# and checks that the result is the filesystem the build steps left. Each
# preset runs on the kernel path and on the FUSE path. Needs Docker with
# privileged containers. Usage: layer.sh [preset...] (standard and python by
# default).
set -euo pipefail

sandbox=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
containers=()
cleanup() {
  if ((${#containers[@]})); then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

start() {
  local id
  id=$(docker run -d --privileged -v "$work/certs:/etc/cloudflare/certs:ro" "$@")
  containers+=("$id")
  echo "$id"
}

# Stands in for the gateway CA a Cloudflare container mounts, which the build
# must trust and keep out of the layer.
mkdir "$work/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=preprocess-layer-test \
  -keyout "$work/ca.key" -out "$work/certs/cloudflare-containers-ca.crt" 2>/dev/null
ca_line=$(sed -n 2p "$work/certs/cloudflare-containers-ca.crt")

spec() {
  jq -n --arg preset "$1" '{
    packages: {
      apt: ["libcap2-bin"],
      pip: (if $preset == "python" then ["six==1.17.0"] else [] end),
      npm: []
    },
    run: [
      "grep -qF \"$(sed -n 2p /etc/cloudflare/certs/cloudflare-containers-ca.crt)\" /etc/ssl/certs/ca-certificates.crt",
      "getent hosts deb.debian.org",
      "cat /etc/ssl/certs/ca-certificates.crt > /tmp/bundle && cat /tmp/bundle > /etc/ssl/certs/ca-certificates.crt",
      "rm /etc/issue.net",
      "rm -rf /etc/skel && mkdir /etc/skel && echo new > /etc/skel/only",
      "install -m 4755 /bin/true /usr/local/bin/suid-true",
      "cp /bin/true /usr/local/bin/cap-true && setcap cap_net_bind_service=+ep /usr/local/bin/cap-true",
      "printf secret > /opt/secret && chown 1000:1000 /opt/secret && chmod 0600 /opt/secret",
      "ln -s /opt/secret /opt/secret-link",
      "echo linked > /opt/hard-a && ln /opt/hard-a /opt/hard-b",
      "echo \"$GREETING\" > /opt/greeting"
    ],
    files: {
      "app/config.json": "{\"name\": \"layer\"}\n",
      "/etc/preprocess-test.conf": "mode = test\n"
    },
    env: { GREETING: "hello from the layer" }
  }'
}

# Runs inside the mounted container: $1 is the preset, $2 the hash of
# /etc/resolv.conf before the mount, $3 a line of the gateway CA.
cat >"$work/assert.sh" <<'EOF'
set -uo pipefail
preset=$1 resolv=$2 ca_line=$3 failed=0
check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then echo "  ok    $name"; else echo "  FAIL  $name"; failed=1; fi
}
is() { test "$(eval "$1")" = "$2"; }
check "deleted preset file stays deleted" test ! -e /etc/issue.net
check "replaced preset dir shows only its new file" is "ls -A /etc/skel" only
check "setuid binary keeps 4755 root" is "stat -c %a:%u:%g /usr/local/bin/suid-true" 4755:0:0
check "file capability survives" is "getcap /usr/local/bin/cap-true" "/usr/local/bin/cap-true cap_net_bind_service=ep"
check "0600 file keeps owner 1000" is "stat -c %a:%u:%g /opt/secret" 600:1000:1000
check "sandbox user reads its 0600 file" is "runuser -u sandbox -- cat /opt/secret" secret
check "symlink survives" is "readlink /opt/secret-link" /opt/secret
check "hardlink survives" test /opt/hard-a -ef /opt/hard-b
check "hardlink count is 2" is "stat -c %h /opt/hard-a" 2
check "apt package is installed" is "dpkg-query -W -f='\${Status}' libcap2-bin" "install ok installed"
check "workspace file has its content" is "cat /workspace/app/config.json" '{"name": "layer"}'
check "workspace file is 644 owned by 1000" is "stat -c %a:%u:%g /workspace/app/config.json" 644:1000:1000
check "workspace dirs are owned by 1000" is "stat -c %u:%g /workspace /workspace/app" "1000:1000
1000:1000"
check "etc file has its content" is "cat /etc/preprocess-test.conf" "mode = test"
check "etc file is 644 owned by root" is "stat -c %a:%u:%g /etc/preprocess-test.conf" 644:0:0
check "env var reached the run command" is "cat /opt/greeting" "hello from the layer"
check "root writes to /usr" sh -c 'echo x > /usr/local/bin/after && rm /usr/local/bin/after'
check "root overwrites a layer file" sh -c 'echo changed > /opt/greeting && grep -q changed /opt/greeting'
check "sandbox writes to /workspace" runuser -u sandbox -- sh -c 'echo x > /workspace/after'
check "sandbox's new file is owned by 1000" is "stat -c %u /workspace/after" 1000
check "/etc/resolv.conf is still the container's mount" findmnt -n /etc/resolv.conf
check "/etc/resolv.conf content unchanged" is "sha256sum < /etc/resolv.conf" "$resolv"
check "gateway CA is not in the layer's bundle" sh -c "! grep -qF '$ca_line' /etc/ssl/certs/ca-certificates.crt"
check "gateway CA dir is still mounted" test -s /etc/cloudflare/certs/cloudflare-containers-ca.crt
if [[ $preset == python ]]; then
  check "pip package imports as sandbox" runuser -u sandbox -- python3 -c 'import six'
  check "pip package is owned by 1000" is "stat -c %u \"\$(python3 -c 'import six; print(six.__file__)')\"" 1000
fi
exit "$failed"
EOF

run_case() {
  local preset=$1 mode=$2 image=preprocess-sandbox-test:$1 env=() builder mounter resolv out
  if [[ $mode == fuse ]]; then env=(-e PREPROCESS_LAYER_FUSE=1); fi
  echo "== $preset, $mode"

  builder=$(start "${env[@]}" "$image")
  if ! spec "$preset" | docker exec -i "$builder" /opt/preprocess/layer/build.sh \
    >"$work/build.out" 2>"$work/build.err"; then
    tail -n 30 "$work/build.out" "$work/build.err"
    return 1
  fi
  grep -q "capturing with $mode overlays" "$work/build.err" ||
    { echo "  FAIL  build did not take the $mode path" && return 1; }
  tail -n 2 "$work/build.out" | grep -Eq '^LAYER_(UNPACKED_)?BYTES=[0-9]+$' ||
    { echo "  FAIL  build output does not end with the sizes" && return 1; }
  tail -n 2 "$work/build.out" | sed 's/^/  /'
  # Exclusions: what the container owns, caches, logs and the CA bundle.
  out=$(docker exec "$builder" unsquashfs -lls /.preprocess/layer.sqfs)
  for path in etc/resolv.conf etc/hosts etc/hostname var/log var/lib/apt/lists \
    var/cache/apt etc/ssl/certs/ca-certificates.crt workspace/.cache; do
    if grep -q "squashfs-root/$path\$" <<<"$out"; then
      echo "  FAIL  layer contains $path"
      return 1
    fi
  done
  grep -Eq '^c--------- root/root +0, +0 .* squashfs-root/etc/issue.net$' <<<"$out" ||
    { echo "  FAIL  layer lacks the whiteout for etc/issue.net" && return 1; }
  docker cp -q "$builder:/.preprocess/layer.sqfs" "$work/layer.sqfs"
  docker rm -f "$builder" >/dev/null

  mounter=$(start "${env[@]}" "$image")
  resolv=$(docker exec "$mounter" sh -c 'sha256sum < /etc/resolv.conf')
  out=$(docker exec -i "$mounter" /opt/preprocess/layer/mount.sh <"$work/layer.sqfs")
  [[ $out == "MOUNT=$mode" ]] || { echo "  FAIL  mount printed '$out'" && return 1; }
  out=$(docker exec -i "$mounter" /opt/preprocess/layer/mount.sh <"$work/layer.sqfs")
  [[ -z $out ]] || { echo "  FAIL  second mount printed '$out'" && return 1; }
  docker exec -i "$mounter" bash -s -- "$preset" "$resolv" "$ca_line" <"$work/assert.sh" ||
    return 1
  docker rm -f "$mounter" >/dev/null
}

presets=("$@")
if ((${#presets[@]} == 0)); then presets=(standard python); fi
failed=0
for preset in "${presets[@]}"; do
  echo "== building $preset"
  docker build --quiet --build-arg "PRESET=$preset" -t "preprocess-sandbox-test:$preset" \
    -f "$sandbox/Dockerfile" "$sandbox" >/dev/null
  for mode in kernel fuse; do
    run_case "$preset" "$mode" || failed=1
  done
done
if ((failed)); then echo "layer test failed" && exit 1; fi
echo "layer test passed"
