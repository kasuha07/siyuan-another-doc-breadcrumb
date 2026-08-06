.PHONY: build clean

# 构建插件（typecheck + 打包到 dist/）
build:
	npm run build

# 清理构建产物（dist/ 与 package.zip）
clean:
	node scripts/clean.js
	rm -f package.zip
