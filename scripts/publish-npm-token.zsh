#!/bin/zsh
set -eu
set +x

replay_script_dir=${0:A:h}
replay_mode=${1:---publish}
if (( $# > 1 )) || [[ "$replay_mode" != --publish && "$replay_mode" != --dry-run && "$replay_mode" != --check ]]; then
  print -u2 'Usage: zsh scripts/publish-npm-token.zsh [--check|--dry-run|--publish]'
  exit 1
fi

# Fail before requesting credentials when the functional split is not ready.
node "$replay_script_dir/publish-npm-token.mjs" --check
if [[ "$replay_mode" == --check ]]; then
  exit 0
fi

if [[ "$replay_mode" == --publish ]]; then
  if [[ -z ${REPLAY_NPM_TOKEN:-} ]]; then
    read -rs 'REPLAY_NPM_TOKEN?npm token: '
    printf '\n'
  fi
  [[ -n "$REPLAY_NPM_TOKEN" ]] || { print -u2 'An npm token is required.'; exit 1; }
  export REPLAY_NPM_TOKEN
  trap 'unset REPLAY_NPM_TOKEN' EXIT
fi

node "$replay_script_dir/publish-npm-token.mjs" "$replay_mode"
