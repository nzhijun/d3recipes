#!/usr/bin/env bash
# 一键本地运行 d3recipes（离线发行版 - 阶段一）
#
# 为什么需要这个脚本？
#   d3recipes 是纯前端静态站（web/ 目录），核心计算是靠本地 wasm 完成的。
#   但它用 fetch() 加载 ./pkg、./data.json，浏览器出于安全限制，
#   用 file:// 直接双击打开会被 CORS 拦截。所以必须起一个本地静态服务器。
#
# 用法：
#   ./run-local.sh          启动并打开浏览器
#   ./run-local.sh --port 9000   指定端口（默认 8080）
#   ./run-local.sh --no-browser  只起服务器，不自动开浏览器
set -euo pipefail

# 项目根目录：脚本所在位置
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 自适应两种布局：
#   开发布局：脚本位于项目根目录，旁边有 web/ 子目录
#   发布布局：脚本与 index.html 等运行时文件同层（打包时已展平）
if [[ -d "$ROOT/web" && -f "$ROOT/web/index.html" ]]; then
  SERVE_DIR="$ROOT/web"
else
  SERVE_DIR="$ROOT"
fi

PORT=8080
OPEN_BROWSER=1

# --- 解析命令行参数 ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --no-browser)
      OPEN_BROWSER=0
      shift
      ;;
    -h|--help)
      echo "用法: $0 [--port 端口] [--no-browser]"
      exit 0
      ;;
    *)
      echo "未知参数: $1 (用 --help 查看用法)" >&2
      exit 1
      ;;
  esac
done

# --- 检查 index.html 是否就绪 ---
if [[ ! -f "$SERVE_DIR/index.html" ]]; then
  echo "错误: 找不到 $SERVE_DIR/index.html，请确认 run-local.sh 位置正确。" >&2
  exit 1
fi

# --- 找一个可用的 python3 ---
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "错误: 未找到 python3，请先安装 Python (https://www.python.org) 或先运行: brew install python" >&2
  exit 1
fi

URL="http://localhost:$PORT"

echo "========================================"
echo "  d3recipes 本地版"
echo "  http://localhost:$PORT"
echo "  按 Ctrl+C 即可停止服务器"
echo "========================================"
echo ""

# --- 可选：自动打开浏览器（预留 0.8s 等服务器起来）---
if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  (
    sleep 0.8
    case "$(uname -s)" in
      Darwin) open "$URL" ;;
      Linux)  xdg-open "$URL" >/dev/null 2>&1 || true ;;
      *)      xdg-open "$URL" >/dev/null 2>&1 || true ;;
    esac
    echo "已在默认浏览器打开 $URL"
  ) &
fi

# --- 用 python3 内置 http.server 提供静态文件 ---
cd "$SERVE_DIR"
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1