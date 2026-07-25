#!/usr/bin/env bash

set -euo pipefail

storage_root="${ANYTHING_LLM_STORAGE_ROOT:-/home/mlove/dokploy/anythingllm}"
storage_dir="${storage_root}/storage"
api_dir="${storage_root}/api"
env_file="${storage_root}/.env"

install -d -m 700 "${storage_root}" "${storage_dir}" "${api_dir}"
umask 077

if ! grep -Eq '^AUTH_TOKEN=[[:xdigit:]]{64}$' "${env_file}" 2>/dev/null ||
  ! grep -Eq '^JWT_SECRET=[[:xdigit:]]{64}$' "${env_file}" 2>/dev/null ||
  ! grep -Eq '^SIG_KEY=[[:xdigit:]]{64}$' "${env_file}" 2>/dev/null ||
  ! grep -Eq '^SIG_SALT=[[:xdigit:]]{64}$' "${env_file}" 2>/dev/null; then
  auth_token="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 32)"
  sig_key="$(openssl rand -hex 32)"
  sig_salt="$(openssl rand -hex 32)"

  printf '%s\n' \
    "AUTH_TOKEN=${auth_token}" \
    "JWT_SECRET=${jwt_secret}" \
    "SIG_KEY=${sig_key}" \
    "SIG_SALT=${sig_salt}" >"${env_file}"

  unset auth_token jwt_secret sig_key sig_salt
fi

chmod 600 "${env_file}"
chown -R 1000:1000 "${storage_root}"

printf 'AnythingLLM PoC storage and authentication file are ready.\n'
