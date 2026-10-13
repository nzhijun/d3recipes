#!/usr/bin/env bash
# ================================================================
#  d3recipes 发布包打包脚本
#
#  作用：把 web/ 的「运行时文件」打包，产出两个独立 zip：
#        - d3recipes-<版本>-mac.zip   (内含 run-local.sh，适用于 macOS/Linux)
#        - d3recipes-<版本>-win.zip   (内含 run-local.bat，适用于 Windows)
#
#  用法：
#    ./package-release.sh                 # 默认版本号 d3recipes-<日期>
#    ./package-release.sh 1.2.3           # 用指定版本号
#
#  产物放在 dist/ 目录。
# ================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT/web"
VERSION="${1:-$(date +%Y%m%d)}"
OUT_DIR="$ROOT/dist"

# 复制 web/ 的运行时文件到指定目录 (剔除测试/开发文件)
copy_runtime() {
  local dst="$1"
  echo "==> 复制 web/ 运行时内容 (剔除测试/开发文件) -> $dst"
  mkdir -p "$dst"
  for f in "$WEB_DIR"/*; do
    base="$(basename "$f")"
    case "$base" in
      *.test.*) echo "    跳过测试文件: $base"; continue;;
      i18n-harness.mjs) echo "    跳过测试工具: $base"; continue;;
      pkg) continue;;            # 单独处理，排除嵌套
      test) continue;;
    esac
    cp -r "$f" "$dst/"
  done

  echo "==> 复制 pkg/ 引擎 (wasm)"
  mkdir -p "$dst/pkg"
  for pkgfile in "$WEB_DIR"/pkg/*; do
    base="$(basename "$pkgfile")"
    case "$base" in
      *.d.ts) continue;;         # 类型声明，运行时不需要
    esac
    cp "$pkgfile" "$dst/pkg/"
  done
}

# 生成对应平台的 README.txt
write_readme() {
  local dst="$1" platform="$2"
  if [ "$platform" = "mac" ]; then
    cat > "$dst/README.txt" <<'EOF'
d3recipes - 本地离线版 (macOS / Linux)
======================================

运行方式:
  1) 确认已安装 Python 3 (python3)
  2) 双击 ./run-local.sh  或  在终端执行: ./run-local.sh
     - 首次运行如遇权限问题，先执行:  chmod +x run-local.sh

会自动在本地启动网页并打开浏览器，无需联网访问 GitHub。
EOF
  else
    cat > "$dst/README.txt" <<'EOF'
d3recipes - 本地离线版 (Windows)
================================

运行方式:
  1) 确认已安装 Python (安装时勾选 "Add to PATH")
  2) 双击 run-local.bat

会自动在本地启动网页并打开浏览器，无需联网访问 GitHub。
EOF
  fi
}

# 打包单个平台
build_platform() {
  local platform="$1" script="$2"
  local dir="$OUT_DIR/d3recipes-$VERSION-$platform"
  local zip="$OUT_DIR/d3recipes-$VERSION-$platform.zip"

  echo
  echo ">>> 构建 [$platform] 版本"
  rm -rf "$dir"
  rm -f "$zip"

  copy_runtime "$dir"
  echo "==> 附带启动脚本: $script"
  cp "$ROOT/$script" "$dir/"
  write_readme "$dir" "$platform"

  echo "==> 打包 zip"
  (cd "$OUT_DIR" && zip -r -q "$zip" "$(basename "$dir")")
  echo "  已生成: $zip"
}

echo "==> 输出目录: $OUT_DIR"
mkdir -p "$OUT_DIR"

build_platform mac "run-local.sh"
build_platform win "run-local.bat"

echo
echo "完成！发布包已生成:"
echo "  $OUT_DIR/d3recipes-$VERSION-mac.zip   (macOS / Linux)"
echo "  $OUT_DIR/d3recipes-$VERSION-win.zip   (Windows)"
echo "  (已剔除测试/开发文件，各自只含对应平台的启动脚本)"