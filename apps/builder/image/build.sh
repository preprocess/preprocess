#!/bin/sh
# Builds one commit. stdin is the commit's tarball (GitHub's archive, one
# top-level directory). DIRECTORY is the agent's directory inside the
# repository, ENTRY its module, TIMEOUT the wall-clock limit in seconds.
# Prints the build log, then the marker line and the bundle as JSON.
set -eu

src=/workspace/src
mkdir -p "$src"
tar -xz --strip-components=1 -C "$src"
agent="$src/${DIRECTORY:-.}"
[ -d "$agent" ] || { echo "directory ${DIRECTORY} is not in the repository"; exit 2; }

# The lockfile names the package manager: the nearest one above the agent's
# directory, up to the repository root.
dir=$agent
install=
while :; do
	if [ -f "$dir/pnpm-lock.yaml" ]; then
		install="corepack pnpm install --frozen-lockfile"
	elif [ -f "$dir/yarn.lock" ]; then
		if [ -f "$dir/.yarnrc.yml" ]; then
			install="corepack yarn install --immutable"
		else
			install="corepack yarn install --frozen-lockfile"
		fi
	elif [ -f "$dir/package-lock.json" ] || [ -f "$dir/npm-shrinkwrap.json" ]; then
		install="npm ci --no-audit --no-fund"
	elif [ -f "$dir/bun.lock" ] || [ -f "$dir/bun.lockb" ]; then
		echo "bun lockfiles are not supported yet; commit an npm, pnpm or yarn lockfile"
		exit 2
	fi
	[ -n "$install" ] || [ "$dir" = "$src" ] || { dir=$(dirname "$dir"); continue; }
	break
done
[ -n "$install" ] || { echo "no lockfile found; commit package-lock.json, pnpm-lock.yaml or yarn.lock"; exit 2; }

echo "\$ $install (in ${dir#"$src"}/)"
cd "$dir"
export agent install
# shellcheck disable=SC2016
timeout --kill-after=10 "$TIMEOUT" sh -c '
	$install &&
	cd "$agent" &&
	echo "\$ preprocess bundle $ENTRY" &&
	node /opt/preprocess/bundle.ts "$ENTRY" /workspace/bundle.json
' 2>&1

printf '\n::preprocess-bundle::\n'
cat /workspace/bundle.json
