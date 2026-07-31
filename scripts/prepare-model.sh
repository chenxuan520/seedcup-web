#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$repo_root/public/models/pure-nn.rnn"
model_name="dl_bot_model_hard_rnnh512_actionctx_exactcf_head128_anchor075_mix050.rnn"
expected_sha256="33399908cac62017cef4446083ef9ead4a3e25b73d18992f6718c3d40117614b"

source_model="${1:-${SEEDCUP_MODEL:-}}"
if [[ -z "$source_model" ]]; then
  sibling_model="$repo_root/../seedcup-cppsdk/src/$model_name"
  if [[ -f "$target" ]]; then
    source_model="$target"
  elif [[ -f "$sibling_model" ]]; then
    source_model="$sibling_model"
  fi
fi

if [[ -z "$source_model" || ! -f "$source_model" ]]; then
  cat >&2 <<EOF
未找到纯神经网络模型。

用法：
  npm run prepare:model -- /模型目录/$model_name

也可以设置环境变量：
  SEEDCUP_MODEL=/模型目录/$model_name npm run prepare:model

若 seedcup-web-demo 与 seedcup-cppsdk 位于同一父目录，脚本会自动查找：
  ../seedcup-cppsdk/src/$model_name

相关源码：
  https://github.com/chenxuan520/deeplearning
  https://gitee.com/chenxuan520/seedcup-cppsdk
EOF
  exit 1
fi

actual_sha256="$(sha256sum "$source_model" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  cat >&2 <<EOF
模型校验失败：传入的文件不是网页当前适配的权重。
文件：$source_model
实际 SHA-256：$actual_sha256
预期 SHA-256：$expected_sha256
EOF
  exit 1
fi

if [[ "$(head -n 1 "$source_model")" != "DLRNNH1" ]]; then
  echo "模型格式校验失败：文件头不是 DLRNNH1。" >&2
  exit 1
fi

mkdir -p "$(dirname "$target")"
if [[ "$(readlink -f "$source_model")" != "$(readlink -m "$target")" ]]; then
  cp "$source_model" "$target"
fi

size="$(stat -c '%s' "$target")"
echo "模型已准备：public/models/pure-nn.rnn"
echo "大小：$size 字节"
echo "SHA-256：$actual_sha256"
