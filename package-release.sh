#!/usr/bin/env bash
# ================================================================
#  d3recipes 发布包打包脚本 (macOS / Linux)
#
#  作用：把 web/ 的「运行时文件」+ mac/win 启动脚本，打包成一个
#        用户可下载的 zip 发布包（放置于 dist/ 目录）。
#
#  用法：
#    ./package-release.sh                 # 默认包名 d3recipes-<日期>.zip
#    ./package-release.sh 1.2.3           # 用指定版本号做包名
# ================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT/web"
VERSION="${1:-$(date +%Y%m%d)}"
OUT_DIR="$ROOT/dist"
PKG_DIR="$OUT_DIR/d3recipes-$VERSION"
ZIP_NAME="d3recipes-$VERSION.zip"

echo "==> 准备工作目录: $PKG_DIR"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

echo "==> 复制 web/ 运行时内容 (剔除测试/开发文件)"
# 保留 index.html 及运行时 js/json，剔除 *.test.* 与 i18n-harness 测试工具
for f in "$WEB_DIR"/*; do
  base="$(basename "$f")"
  case "$base" in
    *.test.*) echo "    跳过测试文件: $base"; continue;;
    i18n-harness.mjs) echo "    跳过测试工具: $base"; continue;;
    pkg) continue;;            # 单独处理，排除嵌套
    test) continue;;
  esac
  cp -r "$f" "$PKG_DIR/"
done

echo "==> 复制 pkg/ 引擎 (wasm)"
mkdir -p "$PKG_DIR/pkg"
for pkgfile in "$WEB_DIR"/pkg/*; do
  base="$(basename "$pkgfile")"
  case "$base" in
    *.d.ts) continue;;         # 类型声明，运行时不需要
  esac
  cp "$pkgfile" "$PKG_DIR/pkg/"
done

echo "==> 附带启动脚本 (mac/win)"
cp "$ROOT/run-local.sh" "$PKG_DIR/"
cp "$ROOT/run-local.bat" "$PKG_DIR/"

echo "==> 生成极简说明 README.txt"
cat > "$PKG_DIR/README.txt" <<'EOF'
d3recipes - 本地离线版
=====================

运行方式:
  macOS / Linux:
    1) 确认已安装 Python 3 (python3)
    2) 双击 ./run-local.sh  或  在终端执行: ./run-local.sh
       - 第一次可能需执行:   chmod +x run-local.sh

  Windows:
    1) 确认已安装 Python (安装时勾选 "Add to PATH")
    2) 双击 run-local.bat

会自动在本地启动网页并打开浏览器，无需联网访问 GitHub。
EOF

echo "==> 打包 zip"
cd "$OUT_DIR"
rm -f "$ZIP_NAME"
zip -r -q "$ZIP_NAME" "$(basename "$PKG_DIR")"

echo
echo "完成！发布包已生成:"
echo "  $OUT_DIR/$ZIP_NAME"
echo "  (解压后内含运行目录 + mac/win 两个启动脚本)"