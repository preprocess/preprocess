# shellcheck shell=bash
# Shared by build.sh and mount.sh: scratch space and overlays of top-level
# directories. Kernel mounts work in Cloudflare containers but are not a
# documented feature, so every kernel path has a FUSE twin.

ROOT=/.preprocess

die() {
  echo "layer: $*" >&2
  exit 1
}

log() {
  echo "layer: $*" >&2
}

# PREPROCESS_LAYER_FUSE=1 forces the FUSE path, so tests cover it on hosts
# where kernel mounts work.
initial_mode() {
  if [[ ${PREPROCESS_LAYER_FUSE:-} == 1 ]]; then echo fuse; else echo kernel; fi
}

# Scratch holds overlay upper and work dirs. The root filesystem may itself be
# overlayfs, which a kernel overlay can't use as its upperdir, so the kernel
# path uses a sparse ext4 file as large as the free disk. FUSE needs no such
# filesystem and uses a plain directory.
scratch_init() {
  local mode=$1 image=$ROOT/scratch.img bytes
  SCRATCH=$ROOT/scratch
  mkdir -p "$SCRATCH"
  [[ $mode == kernel ]] || return 0
  bytes=$(df -B1 --output=avail "$ROOT" | tail -n 1 | tr -d ' ')
  if truncate -s "$bytes" "$image" &&
    mkfs.ext4 -q -F -m 0 -O ^has_journal -E nodiscard "$image" &&
    mount -o loop "$image" "$SCRATCH"; then
    return 0
  fi
  rm -f "$image"
  return 1
}

scratch_drop() {
  if mountpoint -q "$SCRATCH"; then umount -l "$SCRATCH"; fi
  rm -rf "$ROOT/scratch.img" "$SCRATCH"
}

# Top-most mount points below /$1. An overlay on /$1 would hide them, and they
# carry the container's DNS files and the gateway's CA.
submounts() {
  local dir=$1 m k keep=()
  while IFS= read -r m; do
    for k in "${keep[@]}"; do [[ $m == "$k"/* ]] && continue 2; done
    keep+=("$m")
  done < <(awk '{ print $5 }' /proc/self/mountinfo | sed 's/\\040/ /g' |
    grep "^/$dir/" | sort -u)
  for k in "${keep[@]}"; do printf '%s\n' "$k"; done
}

# Mounts an overlay of lower onto /dir with its upper and work dirs on
# scratch, binding submounts aside and back on top. The upper dir copies the
# owner and mode of attrs, since the merged directory takes them from it.
overlay_dir() {
  local mode=$1 dir=$2 lower=$3 attrs=$4 failed=0 mounts=() i
  local upper=$SCRATCH/upper/$dir work=$SCRATCH/work/$dir aside=$ROOT/aside/$dir
  mapfile -t mounts < <(submounts "$dir")
  mkdir -p "$SCRATCH/upper" "$work"
  [[ -d $upper ]] || mkdir "$upper"
  chown "$(stat -c %u:%g "$attrs")" "$upper"
  chmod "$(stat -c %a "$attrs")" "$upper"
  for i in "${!mounts[@]}"; do
    mkdir -p "$aside"
    if [[ -d ${mounts[$i]} ]]; then mkdir "$aside/$i"; else touch "$aside/$i"; fi
    mount --rbind "${mounts[$i]}" "$aside/$i"
  done
  if [[ $mode == kernel ]]; then
    mount -t overlay overlay -o "lowerdir=$lower,upperdir=$upper,workdir=$work" "/$dir" || failed=1
  else
    # The daemon would deadlock mounting over /usr directly, since it still
    # loads files from there, so it mounts aside and is bound into place.
    local staged=$ROOT/fuse/$dir
    mkdir -p "$staged"
    if fuse-overlayfs -o "lowerdir=$lower,upperdir=$upper,workdir=$work,allow_other" "$staged"; then
      mount --bind "$staged" "/$dir" || failed=1
      umount -l "$staged"
    else
      failed=1
    fi
  fi
  for i in "${!mounts[@]}"; do
    if [[ $failed == 0 ]]; then mount --rbind "$aside/$i" "${mounts[$i]}"; fi
    umount -R -l "$aside/$i"
  done
  rm -rf "$aside"
  return "$failed"
}

# Unmounts overlays, with the submounts bound back onto them, in reverse
# order. A process may still hold a file open, so a busy one detaches lazily.
overlay_drop() {
  local i dir
  for ((i = $# - 1; i >= 0; i--)); do
    dir=${*:i+1:1}
    mountpoint -q "/$dir" || continue
    umount -R "/$dir" 2>/dev/null || umount -R -l "/$dir"
  done
}
