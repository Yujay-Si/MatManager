'use strict';

/**
 * 页面级模拟测试：用假的 wx / Page 运行四个页面的核心交互，
 * 在不开微信开发者工具的情况下抓出 setData、格式化、导出回调里的运行时错误。
 * 运行：node test/pages.js
 */

var assert = require('node:assert/strict');
var path = require('node:path');

/* ---------- 假 wx 环境 ---------- */
var store = Object.create(null);
var files = Object.create(null);
var calls = { toast: [], modal: [], clipboard: [], share: 0, switchTab: [] };
var modalConfirm = true;
var pendingChooseFiles = [];

global.wx = {
  env: { USER_DATA_PATH: '/user' },
  getStorageSync: function (key) {
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : '';
  },
  setStorageSync: function (key, value) {
    store[key] = value;
  },
  removeStorageSync: function (key) {
    delete store[key];
  },
  getStorageInfoSync: function () {
    return { currentSize: 1, limitSize: 10240, keys: Object.keys(store) };
  },
  showToast: function (options) {
    calls.toast.push(options.title);
    if (options.success) options.success();
  },
  showModal: function (options) {
    calls.modal.push(options.content);
    if (options.success) options.success({ confirm: modalConfirm, cancel: !modalConfirm });
  },
  switchTab: function (options) {
    calls.switchTab.push(options.url);
  },
  setClipboardData: function (options) {
    calls.clipboard.push(options.data);
    if (options.success) options.success();
  },
  getFileSystemManager: function () {
    return {
      writeFileSync: function (filePath, data) {
        files[filePath] = String(data);
      },
      readFileSync: function (filePath) {
        return files[filePath] || '';
      }
    };
  },
  shareFileMessage: function (options) {
    calls.share += 1;
    if (options.success) options.success();
  },
  chooseMessageFile: function (options) {
    var next = pendingChooseFiles.shift();
    if (!next) {
      if (options.fail) options.fail({ errMsg: 'chooseMessageFile:fail cancel' });
      return;
    }
    if (options.success) options.success({ tempFiles: [next] });
  },
  getDeviceInfo: function () {
    return { platform: 'mock', system: 'mock' };
  }
};

/* ---------- 假 Page ---------- */
var captured = null;
global.Page = function (config) {
  captured = config;
};

function applyPatch(target, patch) {
  Object.keys(patch).forEach(function (pathKey) {
    var segments = pathKey.replace(/\[(\d+)\]/g, '.$1').split('.');
    var cursor = target;
    for (var i = 0; i < segments.length - 1; i += 1) {
      var segment = segments[i];
      if (cursor[segment] === undefined || cursor[segment] === null) {
        cursor[segment] = /^\d+$/.test(segments[i + 1]) ? [] : {};
      }
      cursor = cursor[segment];
    }
    cursor[segments[segments.length - 1]] = patch[pathKey];
  });
}

function loadPage(relativePath) {
  captured = null;
  var resolved = require.resolve(path.join(__dirname, '..', relativePath));
  delete require.cache[resolved];
  require(resolved);
  assert.ok(captured, relativePath + ' 未调用 Page()');
  var page = {};
  Object.keys(captured).forEach(function (key) {
    page[key] = captured[key];
  });
  page.data = JSON.parse(JSON.stringify(captured.data || {}));
  page.setData = function (patch, callback) {
    applyPatch(page.data, patch);
    if (typeof callback === 'function') callback();
  };
  return page;
}

function event(dataset, value) {
  return {
    currentTarget: { dataset: dataset || {} },
    detail: { value: value }
  };
}

/* ---------- 页面 1：单次计算 ---------- */
var single = loadPage('pages/single/index.js');
single.onShow();
assert.equal(single.data.parameterVersion, '默认参数 v0');
assert.equal(single.data.formulas.length, 2, '双排默认只显示 2 套公式');

single.onThicknessInput(event({}, '0.3'));
single.onWidthInput(event({}, '600'));
single.onWeightInput(event({}, '100'));
single.onCalculate();
assert.ok(single.data.result, '应生成结果：' + single.data.error);
assert.equal(single.data.result.quantityText, '430', '单次计算结果应为 430');
assert.equal(single.data.statusError, false);
assert.ok(single.data.status.indexOf('已保存') !== -1, '结果应写入历史');
assert.equal(single.data.result.inputPairs.length, 6);
assert.ok(single.data.result.basisPairs.length >= 9);
assert.ok(single.data.result.basisPairs.some(function (pair) {
  return pair.key === '角料重量' && pair.value === '12 kg';
}), '双排 100 kg 结果应显示角料 12 kg');
assert.ok(single.data.result.basisPairs.some(function (pair) {
  return pair.key === '双排角料比例系数' && Number(pair.value) === 0.12;
}), '结果应显示双排角料比例系数 0.12');

single.onCopy();
assert.ok(calls.clipboard[0].indexOf('预计数量：430 个') !== -1, '复制内容应包含数量');

single.onExportCsv();
assert.equal(calls.share, 1, '导出 CSV 应调用转发');
assert.ok(Object.keys(files).some(function (name) { return /\.csv$/.test(name); }), '应生成 csv 文件');
var csvText = files[Object.keys(files).filter(function (name) { return /\.csv$/.test(name); })[0]];
assert.ok(csvText.charCodeAt(0) === 0xfeff, 'CSV 应带 BOM');

/* 第 3 套只在单排出现，且切回双排时自动回落 */
single.onModeChange(event({}, '0'));
assert.equal(single.data.formulas.length, 3, '单排应出现第 3 套');
single.onFormulaSelect(event({ value: '3' }));
assert.equal(single.data.formula, '3');
single.onModeChange(event({}, '1'));
assert.equal(single.data.formula, '1', '切回双排应回落第 1 套');
assert.equal(single.data.formulas.length, 2);

/* 非法输入 */
single.onThicknessInput(event({}, ''));
single.onCalculate();
assert.equal(single.data.result, null);
assert.ok(single.data.error.indexOf('厚度') !== -1);

/* ---------- 页面 2：批量计算 ---------- */
var batch = loadPage('pages/batch/index.js');
batch.onTextInput(event({}, '材质,厚度(mm),宽度(mm),材料重量(kg),冲料方式,单重公式\n201,0.3,600,100,双排,2\n304,0.5,600,80,单排,3'));
batch.onRun();
assert.equal(batch.data.rows.length, 2, '应解析出 2 行');
assert.equal(batch.data.rows[0].quantityText, '430');
assert.equal(batch.data.rows[0].scrapText, 12, '批量行应显示角料 12 kg');
assert.equal(batch.data.rows[0].isError, false);
assert.equal(batch.data.rows[1].isError, false, '单排第 3 套应成功');
assert.equal(batch.data.rows[1].scrapText, 17.6, '单排 80 kg 材料的角料应为 17.6 kg');
assert.ok(batch.data.summary.indexOf('成功 2 条') !== -1);
assert.equal(batch.validResults.length, 2);

batch.onExportCsv();
assert.ok(calls.share >= 2, '批量导出应再次调用转发');

batch.onCopyTemplate();
assert.ok(calls.clipboard[calls.clipboard.length - 1].indexOf('材质,厚度(mm)') !== -1, '模板应可复制');

/* 错误行 */
batch.onTextInput(event({}, '材质,厚度(mm),宽度(mm),材料重量(kg),冲料方式,单重公式\n201,,600,100,双排,2'));
batch.onRun();
assert.equal(batch.data.rows[0].isError, true);
assert.ok(batch.data.rows[0].stateText.indexOf('厚度') !== -1);
batch.onCopyInvalid();
assert.ok(calls.clipboard[calls.clipboard.length - 1].indexOf('第 2 行') !== -1);

/* 从聊天选择 CSV 文件 */
files['/tmp/import.csv'] = '\uFEFF材质,厚度(mm),宽度(mm),材料重量(kg),冲料方式,单重公式\r\n410,0.4,500,50,单排,1\r\n';
pendingChooseFiles.push({ name: 'import.csv', size: 120, path: '/tmp/import.csv' });
batch.onChooseFile();
assert.equal(batch.data.fileName, 'import.csv');
batch.onRun();
assert.equal(batch.data.rows.length, 1);
assert.equal(batch.data.rows[0].material, '410');

/* ---------- 页面 3：历史记录 ---------- */
var history = loadPage('pages/history/index.js');
history.onShow();
assert.ok(history.data.records.length >= 3, '历史应有记录，实际 ' + history.data.records.length);
assert.ok(history.data.countText.indexOf('/ 500 条') !== -1);

var firstId = history.data.records[0].id;
history.onToggleDetail(event({ id: firstId }));
assert.equal(history.data.records[0].expanded, true, '应能展开详情');
history.onToggleDetail(event({ id: firstId }));
assert.equal(history.data.records[0].expanded, false);

var beforeCount = history.data.records.length;
history.onRecalculate(event({ id: firstId }));
assert.equal(history.data.records.length, beforeCount + 1, '重算应新增一条记录');
assert.ok(history.data.status.indexOf('新记录') !== -1);

history.onFilterInput(event({}, '201'));
assert.ok(history.data.records.length >= 1);
history.onFilterInput(event({}, 'zzz-not-exist'));
assert.equal(history.data.records.length, 0);
assert.equal(history.data.emptyText, '没有符合条件的历史记录。');
history.onFilterInput(event({}, ''));

modalConfirm = false;
history.onDelete(event({ id: firstId }));
assert.equal(history.data.records.length, beforeCount + 1, '取消删除时不应变化');
modalConfirm = true;
history.onDelete(event({ id: firstId }));
assert.equal(history.data.records.length, beforeCount, '确认删除后应减少一条');

history.onBackup();
assert.ok(history.data.status.indexOf('JSON 备份') !== -1);
assert.ok(Object.keys(files).some(function (name) { return /\.json$/.test(name); }), '应生成 json 备份');

/* ---------- 页面 4：参数维护 ---------- */
var parameters = loadPage('pages/parameters/index.js');
parameters.onShow();
assert.equal(parameters.data.fields.length, 13, '应有 13 个可编辑参数（含单排/双排角料比例系数）');
assert.equal(parameters.data.fields[2].value, '0.793', '201 第 1 套密度系数初始为 0.793');

parameters.onFieldInput(event({ key: 'materials.201.radius', index: 2 }, '0.8'));
assert.equal(parameters.data.fields[2].value, '0.8');
parameters.onSave();
assert.ok(calls.modal[calls.modal.length - 1].indexOf('0.793 → 0.8') !== -1, '保存前应显示新旧值');
assert.equal(parameters.loadedRevision, 1, '保存后版本应为 1');
assert.ok(parameters.data.versionText.indexOf('本机参数 v1') !== -1);

/* 新参数必须影响后续计算 */
var single2 = loadPage('pages/single/index.js');
single2.onShow();
assert.equal(single2.data.parameterVersion, '本机参数 v1');
single2.onThicknessInput(event({}, '0.3'));
single2.onWidthInput(event({}, '600'));
single2.onWeightInput(event({}, '100'));
single2.onCalculate();
assert.equal(single2.data.result.quantityText, '427', '201 第 1 套系数改为 0.8 后第 1 套测算应为 427');

/* 越界校验 */
parameters.onFieldInput(event({ key: 'modes.double.widthDivisor', index: 12 }, '0'));
parameters.onSave();
assert.equal(parameters.data.statusError, true);
assert.ok(parameters.data.status.indexOf('1 到 100') !== -1);

/* 恢复默认 */
parameters.onShow();
parameters.onRestoreDefaults();
assert.equal(parameters.loadedRevision, 2);
assert.equal(parameters.data.fields[2].value, '0.793');

/* 参数备份 / 恢复 */
parameters.onBackup();
assert.ok(Object.keys(files).some(function (name) { return /参数备份\.json$/.test(name); }));

console.log('页面模拟测试通过：单次 430/427、批量解析与错误行、历史重算与删除、参数保存校验与恢复默认、CSV/JSON 导出回调均正常。');
