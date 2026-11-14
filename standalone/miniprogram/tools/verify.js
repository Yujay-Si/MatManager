'use strict';

/**
 * 小程序工程静态自检：JSON 合法性、WXML 标签闭合、WXSS 花括号、require 路径、
 * 禁用 DOM/浏览器 API、tabBar 图标、页面四件套、主包体积。
 * 运行：node tools/verify.js
 */

var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.resolve(__dirname, '..');
var errors = [];
var warnings = [];
var files = [];

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return;
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  });
}

walk(ROOT);

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

/* 1. JSON */
files.filter(function (file) { return file.endsWith('.json'); }).forEach(function (file) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push('JSON 解析失败 ' + rel(file) + '：' + error.message);
  }
});

/* 2. WXML 标签闭合 */
function checkWxml(file) {
  var source = fs.readFileSync(file, 'utf8');
  if (/<\/?(div|span|p|section|footer|header|form|table|tr|td|h1|h2|h3|a)\b/.test(source)) {
    errors.push('WXML 含 HTML 标签 ' + rel(file));
  }
  var tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  var stack = [];
  var match;
  while ((match = tagPattern.exec(source)) !== null) {
    var closing = match[1] === '/';
    var name = match[2];
    var selfClosing = match[4] === '/';
    if (closing) {
      if (stack.length === 0 || stack[stack.length - 1] !== name) {
        errors.push('WXML 标签不匹配 ' + rel(file) + '：</' + name + '>，栈顶为 ' + (stack[stack.length - 1] || '空'));
        return;
      }
      stack.pop();
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (stack.length) errors.push('WXML 存在未闭合标签 ' + rel(file) + '：' + stack.join(','));
  var mustacheOpen = (source.match(/\{\{/g) || []).length;
  var mustacheClose = (source.match(/\}\}/g) || []).length;
  if (mustacheOpen !== mustacheClose) errors.push('WXML 双花括号不配对 ' + rel(file));
}

/* 3. WXSS 花括号 */
function checkWxss(file) {
  var source = fs.readFileSync(file, 'utf8');
  var open = (source.match(/\{/g) || []).length;
  var close = (source.match(/\}/g) || []).length;
  if (open !== close) errors.push('WXSS 花括号不配对 ' + rel(file) + '（{ ' + open + ' / } ' + close + '）');
}

/* 4. require 路径与禁用 API */
function checkJs(file) {
  var source = fs.readFileSync(file, 'utf8');
  var requirePattern = /require\(['"]([^'"]+)['"]\)/g;
  var match;
  while ((match = requirePattern.exec(source)) !== null) {
    var target = match[1];
    if (target.indexOf('.') !== 0) continue;
    var resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js')) {
      errors.push('require 路径不存在 ' + rel(file) + ' → ' + target);
    }
  }
  var forbidden = [
    [/\bwindow\./, 'window.'],
    [/\bdocument\./, 'document.'],
    [/\blocalStorage\b/, 'localStorage'],
    [/\bsessionStorage\b/, 'sessionStorage'],
    [/\bstructureClone\b/, 'structuredClone'],
    [/\bURL\.createObjectURL\b/, 'URL.createObjectURL']
  ];
  forbidden.forEach(function (pair) {
    if (pair[0].test(source)) errors.push('使用了小程序不支持的 API ' + pair[1] + '：' + rel(file));
  });
}

files.filter(function (file) {
  return file.endsWith('.wxml');
}).forEach(checkWxml);
files.filter(function (file) {
  return file.endsWith('.wxss');
}).forEach(checkWxss);
files.filter(function (file) {
  return file.endsWith('.js') && rel(file).indexOf('tools/') !== 0 && rel(file).indexOf('test/') !== 0;
}).forEach(checkJs);

/* 5. app.json 结构与页面四件套、tabBar 图标 */
var appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
appJson.pages.forEach(function (page) {
  ['.js', '.json', '.wxml', '.wxss'].forEach(function (ext) {
    var file = path.join(ROOT, page + ext);
    if (!fs.existsSync(file)) errors.push('缺少页面文件 ' + page + ext);
  });
});
(appJson.tabBar && appJson.tabBar.list ? appJson.tabBar.list : []).forEach(function (item) {
  if (appJson.pages.indexOf(item.pagePath) === -1) errors.push('tabBar 页面未注册：' + item.pagePath);
  [item.iconPath, item.selectedIconPath].forEach(function (icon) {
    if (!icon) return;
    var file = path.join(ROOT, icon);
    if (!fs.existsSync(file)) {
      errors.push('tabBar 图标不存在：' + icon);
      return;
    }
    var buffer = fs.readFileSync(file);
    if (buffer.slice(1, 4).toString() !== 'PNG') errors.push('tabBar 图标不是 PNG：' + icon);
    if (buffer.length > 40 * 1024) errors.push('tabBar 图标超过 40 KB：' + icon);
  });
});

/* 6. 主包体积（排除 packOptions.ignore 与自检产物） */
var projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
var ignores = ((projectConfig.packOptions || {}).ignore || []).map(function (entry) { return entry.value; });
var packaged = files.filter(function (file) {
  var relative = rel(file);
  return !ignores.some(function (ignore) { return relative === ignore || relative.indexOf(ignore + '/') === 0; });
});
var totalBytes = packaged.reduce(function (sum, file) { return sum + fs.statSync(file).size; }, 0);

/* 7. 页面配置完整性 */
appJson.pages.forEach(function (page) {
  var json = JSON.parse(fs.readFileSync(path.join(ROOT, page + '.json'), 'utf8'));
  if (typeof json.navigationBarTitleText !== 'string') warnings.push(page + '.json 缺少 navigationBarTitleText');
  if (!json.usingComponents) warnings.push(page + '.json 缺少 usingComponents');
});

console.log('文件总数：' + files.length + '；预计上传文件：' + packaged.length + ' 个');
console.log('主包体积：' + (totalBytes / 1024).toFixed(1) + ' KB（上限 2048 KB）');
if (totalBytes > 2 * 1024 * 1024) errors.push('主包体积超过 2 MB 上限');

if (warnings.length) {
  console.log('\n提示：');
  warnings.forEach(function (item) { console.log(' - ' + item); });
}
if (errors.length) {
  console.error('\n发现 ' + errors.length + ' 个问题：');
  errors.forEach(function (item) { console.error(' ✗ ' + item); });
  process.exit(1);
}
console.log('\n静态自检通过。');
