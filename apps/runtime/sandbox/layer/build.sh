#!/usr/bin/env bash
# Builds a custom environment layer (spec 3) in a fresh container of a preset.
# Reads the build spec as JSON on stdin, runs its steps over overlays of the
# preset's top-level directories and squashes what they changed into
# /.preprocess/layer.sqfs, which mount.sh lays over the preset at every start.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$(dirname "$0")/lib.sh"
trap 'echo "layer: build failed at line $LINENO" >&2' ERR

CA=/etc/cloudflare/certs/cloudflare-containers-ca.crt
BUNDLE=/etc/ssl/certs/ca-certificates.crt
WORKSPACE=/workspace

spec=$(cat)
jq -e '.packages.apt, .packages.pip, .packages.npm, .run, .files, .env' \
  <<<"$spec" >/dev/null || die "stdin must be a build spec in JSON with every key"

# Lists one spec field's strings, separated by NUL.
strings() {
  jq -j "$1 | . + \"\u0000\"" <<<"$spec"
}

step() {
  local name=$1
  shift
  log "step: $name"
  "$@" </dev/null || die "step failed (exit $?): $name"
}

write_file() {
  local key=$1 target=$2
  mkdir -p "$(dirname "$target")"
  jq -j --arg key "$key" \
    '.files[$key] | if type == "string" then . else error("not a string") end' \
    <<<"$spec" >"$target"
  chmod 0644 "$target"
  if [[ $target == "$WORKSPACE" || $target == "$WORKSPACE"/* ]]; then
    chown sandbox:sandbox "$target"
  else
    chown root:root "$target"
  fi
}

# Outbound HTTPS goes through a gateway with its own CA. Trusting it before
# capture keeps it out of the layer; the runtime trusts it again at start.
mkdir -p "$ROOT"
cp "$BUNDLE" "$ROOT/bundle.orig"
if [[ -f $CA ]]; then cat "$CA" >>"$BUNDLE"; fi

dirs=()
for d in usr etc opt var home srv root workspace; do
  if [[ -d /$d && ! -L /$d ]]; then dirs+=("$d"); fi
done

capture() {
  local mode=$1 d mounted=()
  scratch_init "$mode" || return 1
  for d in "${dirs[@]}"; do
    if ! overlay_dir "$mode" "$d" "/$d" "/$d"; then
      overlay_drop "${mounted[@]}"
      scratch_drop
      return 1
    fi
    mounted+=("$d")
  done
}

mode=$(initial_mode)
if [[ $mode == kernel ]] && ! capture kernel; then
  log "kernel mounts failed, falling back to FUSE"
  mode=fuse
fi
if [[ $mode == fuse ]]; then
  capture fuse || die "could not overlay the preset's directories"
fi
log "capturing with $mode overlays"

while IFS= read -r -d '' kv; do
  export "${kv?}"
done < <(jq -j '.env | to_entries[] | "\(.key)=\(.value)\u0000"' <<<"$spec")

cd "$WORKSPACE"
while IFS= read -r -d '' key; do
  path=$key
  [[ $path == /* ]] || path=$WORKSPACE/$path
  step "write $key" write_file "$key" "$(realpath -m -- "$path")"
done < <(strings '.files | keys[]')

mapfile -d '' -t apt < <(strings '.packages.apt[]')
mapfile -d '' -t pip < <(strings '.packages.pip[]')
mapfile -d '' -t npm < <(strings '.packages.npm[]')
mapfile -d '' -t run < <(strings '.run[]')
if ((${#apt[@]})); then
  step "apt-get update" env DEBIAN_FRONTEND=noninteractive apt-get update
  step "apt-get install ${apt[*]}" env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends "${apt[@]}"
fi
if ((${#pip[@]})); then
  step "pip install ${pip[*]}" runuser -u sandbox -- \
    pip install --no-input "${pip[@]}"
fi
if ((${#npm[@]})); then
  step "npm install ${npm[*]}" runuser -u sandbox -- \
    npm install --no-audit --no-fund "${npm[@]}"
fi
for i in "${!run[@]}"; do
  step "run[$i]: ${run[$i]%%$'\n'*}" bash -euo pipefail -c "${run[$i]}"
done
# Only what isn't the sandbox user's yet, so unchanged files aren't copied up.
step "chown $WORKSPACE" find "$WORKSPACE" \( ! -uid 1000 -o ! -gid 1000 \) \
  -exec chown -h sandbox:sandbox {} +

cd /
overlay_drop "${dirs[@]}"
upper=$SCRATCH/upper
cd "$upper"

# Caches, logs and the container's own network files don't belong in a layer.
rm -rf var/cache/apt var/lib/apt/lists var/log var/tmp tmp root/.cache \
  root/.npm workspace/.cache workspace/.npm home/*/.cache etc/resolv.conf \
  etc/hosts etc/hostname

# A step that rewrote the CA bundle captured it with the gateway CA appended.
bundle=$upper$BUNDLE
if [[ -f $CA && -f $bundle && ! -L $bundle ]]; then
  ca_bytes=$(stat -c %s "$CA")
  bundle_bytes=$(stat -c %s "$bundle")
  if ((bundle_bytes >= ca_bytes)) &&
    cmp -s <(tail -c "$ca_bytes" "$bundle") "$CA"; then
    truncate -s $((bundle_bytes - ca_bytes)) "$bundle"
    if cmp -s "$bundle" "$ROOT/bundle.orig"; then rm "$bundle"; fi
  fi
fi

# Normalises the upper tree to kernel overlay format: whiteouts are 0/0
# character devices and opaque directories carry trusted.overlay.opaque=y.
# fuse-overlayfs may write .wh. files and user xattrs instead, and its upper
# may sit on a filesystem that refuses trusted.overlay xattrs and whiteout
# devices, so both go in as mksquashfs pseudo definitions.
quote() {
  local s=${1//\\/\\\\}
  printf '"%s"' "${s//\"/\\\"}"
}
pseudo=$ROOT/pseudo
{
  while IFS= read -r -d '' path; do
    name=${path##*/}
    rm -f "$path"
    if [[ $name == .wh..wh..opq ]]; then
      echo "$(quote "${path%/*}") x trusted.overlay.opaque=y"
    else
      echo "$(quote "${path%/*}/${name#.wh.}") c 0 0 0 0 0"
    fi
  done < <(find . -mindepth 2 -name '.wh.*' -printf '%P\0')
  getfattr -R -h -d -e text \
    -m '^(trusted\.overlay|user\.overlay|user\.fuseoverlayfs)\.opaque$' . \
    2>/dev/null | awk '
      /^# file: / { path = substr($0, 9) }
      /\.opaque="y"$/ { print "\"" path "\" x trusted.overlay.opaque=y" }
    '
} | sort -u >"$pseudo"

unpacked=$(du -sb "$upper" | cut -f 1)
mksquashfs "$upper" "$ROOT/layer.sqfs" -comp zstd -noappend -xattrs \
  -xattrs-exclude '^(trusted|user)\.(overlay|fuseoverlayfs)\.' \
  -pf "$pseudo" -quiet -no-progress >&2

echo "LAYER_BYTES=$(stat -c %s "$ROOT/layer.sqfs")"
echo "LAYER_UNPACKED_BYTES=$unpacked"
