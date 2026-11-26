#!/usr/bin/env bash
# Lays a custom environment layer (built by build.sh) over the preset at
# container start, before any user command. Reads the squashfs on stdin. Each
# directory gets a writable upper, so packages and agents can still write
# anywhere.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$(dirname "$0")/lib.sh"
trap 'echo "layer: mount failed at line $LINENO" >&2' ERR

if [[ -e $ROOT/ready ]]; then exit 0; fi
mkdir -p "$ROOT/layer"
cat >"$ROOT/layer.sqfs"
[[ -s $ROOT/layer.sqfs ]] || die "stdin carried no layer"

mount_layer() {
  local mode=$1 d dirs=() mounted=()
  if [[ $mode == kernel ]]; then
    mount -t squashfs -o loop,ro "$ROOT/layer.sqfs" "$ROOT/layer" || return 1
  else
    # The low-level squashfuse keeps inode numbers, so hardlinks stay linked.
    squashfuse_ll -o allow_other "$ROOT/layer.sqfs" "$ROOT/layer" || return 1
  fi
  mapfile -t dirs < <(find "$ROOT/layer" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
  if ! scratch_init "$mode"; then
    umount -l "$ROOT/layer"
    return 1
  fi
  for d in "${dirs[@]}"; do
    [[ -d /$d && ! -L /$d ]] || die "the layer has /$d, which this image lacks"
    if ! overlay_dir "$mode" "$d" "$ROOT/layer/$d:/$d" "$ROOT/layer/$d"; then
      overlay_drop "${mounted[@]}"
      scratch_drop
      umount -l "$ROOT/layer"
      return 1
    fi
    mounted+=("$d")
  done
}

mode=$(initial_mode)
if [[ $mode == kernel ]] && ! mount_layer kernel; then
  log "kernel mounts failed, falling back to FUSE"
  mode=fuse
fi
if [[ $mode == fuse ]]; then
  mount_layer fuse || die "could not mount the layer"
fi
touch "$ROOT/ready"
echo "MOUNT=$mode"
