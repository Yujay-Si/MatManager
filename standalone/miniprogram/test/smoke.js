'use strict';

/**
 * 微信小程序版 · 逻辑冒烟测试（Node 环境运行）
 * 目的：确认迁移到小程序后，公式、参数、历史、批量、导出与原 Web 版完全一致。
 * 运行：node test/smoke.js
 */

var assert = require('node:assert/strict');

var calculation = require('../utils/calculation');
var parameterStore = require('../utils/parameter-store');
var historyStore = require('../utils/history-store');
var batchData = require('../utils/batch-data');
var storage = require('../utils/storage');
var resultOutput = require('../utils/result-output');
var format = require('../utils/format');

var base = {
  material: '201',
  thickness: '0.3',
  width: '600',
  weight: '100',
  mode: 'double',
  formula: 2
};

/* 1. 基本公式 */
var result = calculation.calculate(base);
assert.equal(result.cut, 320, '双排剪口应为 320 mm');
assert.equal(result.squareUnitWeight.toFixed(4), '0.1912', '第 2 套单重应为 0.1912');
assert.equal(result.quantity, 430, '示例预计数量应为 430 个');
assert.equal(result.formulaVersion, '2.1.0');
assert.equal(result.parameterVersion, '默认参数 v0');
assert.equal(result.scrapRatio, 0.12, '双排角料比例应为 12%');
assert.equal(Number(result.scrapWeight.toPrecision(12)), 12, '双排 100 kg 材料的角料重量应为 12 kg');

/* 2. 公式约束 */
assert.throws(function () { calculation.calculate(Object.assign({}, base, { formula: 3 })); }, /第 3 套/, '第 3 套只允许单排');
assert.throws(function () { calculation.calculate(Object.assign({}, base, { thickness: '' })); }, /厚度/, '空厚度应报错');
assert.throws(function () { calculation.calculate(Object.assign({}, base, { material: '999' })); }, /材质/, '非法材质应报错');

/* 3. 第 3 套（单排方片） */
var sheet = calculation.calculate({ material: '201', thickness: 0.3, width: 600, weight: 100, mode: 'single', formula: 3 });
assert.equal(sheet.cut, 600, '单排剪口直接取宽度');
assert.equal(sheet.appliedUsableFactor, null, '第 3 套不乘比例系数');
assert.equal(sheet.usableWeight, 100, '第 3 套使用材料总重');
assert.equal(sheet.scrapRatio, 0.22, '单排角料比例应为 22%');
assert.equal(Number(sheet.scrapWeight.toPrecision(12)), 22, '单排 100 kg 材料的角料重量应为 22 kg');
assert.ok(sheet.quantity > 0);

/* 4. 参数存储：默认 → 修改 → 乐观锁 → 校验 */
var state0 = parameterStore.readState();
assert.equal(state0.revision, 0, '初始参数版本应为 0');
var values = parameterStore.editableValues(state0.parameters);
assert.equal(values['materials.201.radius'], 0.793);
assert.equal(values['modes.double.widthDivisor'], 1.87);
assert.equal(values['modes.single.scrapRatio'], 0.22, '单排角料比例默认应为 0.22');
assert.equal(values['modes.double.scrapRatio'], 0.12, '双排角料比例默认应为 0.12');

var changed = Object.assign({}, values, { 'modes.double.usableFactor': 0.8 });
var saved = parameterStore.writeValues(changed, 0);
assert.equal(saved.revision, 1, '保存后参数版本应为 1');
assert.throws(function () { parameterStore.writeValues(changed, 0); }, /其他页面|没有变化/, '旧修订号不能再次写入');
assert.throws(function () { parameterStore.writeValues(Object.assign({}, changed, { 'modes.double.widthDivisor': 0 }), 1); }, /1 到 100/, '除数越界应报错');

var custom = calculation.calculate(base, saved.parameters);
assert.equal(custom.parameterVersion, '本机参数 v1');
assert.ok(custom.quantity < result.quantity, '比例系数调低后数量应减少');

var restored = parameterStore.restoreDefaults(1);
assert.equal(restored.revision, 2);
assert.equal(parameterStore.readState().parameters.modes.double.usableFactor, 0.824);
assert.equal(parameterStore.readState().parameters.modes.double.scrapRatio, 0.12);

/* 4.5 旧参数缓存（无角料字段）应自动补齐默认值，而不是整页报错 */
storage.setItem('material-calculator-parameters-v1', JSON.stringify({  schema: 1,  revision: 3,
  updatedAt: '2026-10-26T10:00:00.000Z',
  values: {
    'materials.410.radius': 0.785, 'materials.410.square': 6.162,
    'materials.201.radius': 0.793, 'materials.201.square': 6.225,
    'materials.304.radius': 0.793, 'materials.304.square': 6.225,
    'materials.316.radius': 0.798, 'materials.316.square': 6.264,
    'modes.single.usableFactor': 0.776, 'modes.double.usableFactor': 0.824,
    'modes.double.widthDivisor': 1.87
  }
}));
var upgraded = parameterStore.readState();
assert.equal(upgraded.revision, 3);
assert.equal(upgraded.parameters.modes.single.scrapRatio, 0.22, '旧参数应补上单排角料比例默认值');
assert.equal(upgraded.parameters.modes.double.scrapRatio, 0.12, '旧参数应补上双排角料比例默认值');
historyStore.clearAll();

/* 5. 批量解析 */
var rows = batchData.rowsFromText('材质,厚度(mm),宽度(mm),材料重量(kg),冲料方式,单重公式\n201,0.3,600,100,双排,2\n304,0.5,600,80,单排,3');
var batchResults = batchData.calculateRows(rows, function (input) { return calculation.calculate(input); });
assert.equal(batchResults.length, 2);
assert.equal(batchResults[0].result.quantity, 430, '批量结果应与单次一致');
assert.ok(batchResults[1].result.quantity > 0);

var badHeader = batchData.rowsFromText('a,b,c\n1,2,3');
assert.throws(function () { batchData.calculateRows(badHeader, calculation.calculate); }, /表头/, '错误表头应报错');

/* 6. 历史存储 */
historyStore.clearAll();
assert.equal(historyStore.readRecords().length, 0);
historyStore.addResults([result, sheet]);
assert.equal(historyStore.readRecords().length, 2);
var records = historyStore.readRecords();
assert.equal(records[0].result.quantity, result.quantity, '新写入记录应按提交顺序排在最前');
historyStore.remove(records[1].id);
assert.equal(historyStore.readRecords().length, 1);

var backup = historyStore.exportBackup();
assert.equal(backup.format, 'material-calculator-history');
assert.equal(backup.records.length, 1);
var imported = historyStore.importBackup({
  format: 'material-calculator-history',
  version: 1,
  records: [
    backup.records[0],
    Object.assign({}, backup.records[0], { id: 'extra-record' })
  ]
});
assert.equal(imported.imported, 1, '重复 id 应跳过');
assert.equal(imported.skipped, 1);

/* 7. 导出 */
var csv = resultOutput.csv([result, sheet]);
assert.ok(csv.charCodeAt(0) === 0xfeff, 'CSV 应带 UTF-8 BOM');
var csvLines = csv.slice(1).split('\r\n');
assert.equal(csvLines[0].split(',').length, resultOutput.HEADERS.length, '导出列数应与表头一致');
assert.ok(csv.indexOf('"201"') !== -1);
var scrapColumn = resultOutput.HEADERS.indexOf('角料重量(kg)');
assert.ok(scrapColumn !== -1, '导出表头应包含角料重量');
assert.equal(csvLines[1].split(',')[scrapColumn], '"12"', '双排 100 kg 应在导出中显示角料 12 kg');

/* 旧版本（2.0.0）历史记录没有角料字段：导出留空 */
var legacyExport = JSON.parse(JSON.stringify(result));
delete legacyExport.scrapRatio;
delete legacyExport.scrapWeight;
delete legacyExport.parameters.scrapRatio;
var legacyCsv = resultOutput.csv([legacyExport]);
var legacyCells = legacyCsv.slice(1).split('\r\n')[1].split(',');
assert.equal(legacyCells[scrapColumn], '""', '旧记录角料列应为空');

var summary = resultOutput.textSummary(result);
assert.ok(summary.indexOf('预计数量：430 个') !== -1, '摘要应包含数量');
assert.ok(summary.indexOf('第 2 套') !== -1, '摘要应包含公式');
assert.ok(summary.indexOf('角料重量：12 kg') !== -1, '摘要应包含角料重量');

var pairs = resultOutput.detailPairs(sheet);
assert.ok(pairs.some(function (pair) { return pair.key === '方片单重'; }), '第 3 套应显示方片单重');
assert.ok(pairs.some(function (pair) { return pair.key === '角料重量' && pair.value === '22 kg'; }), '第 3 套应显示角料 22 kg');

/* 8. 格式化 */
assert.equal(format.thousands(1234567), '1,234,567');
assert.equal(format.thousands(430), '430');
assert.equal(format.fixed4(0.1912245), '0.1912');
assert.match(format.dateTime('2026-10-26T10:00:00.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

/* 9. 历史重算（含旧版本编号互换） */
var legacy = JSON.parse(JSON.stringify(result));
legacy.formulaVersion = '1.2.0';
legacy.input.formula = 1;
var patched = calculation.currentInputFromHistory(legacy);
assert.equal(patched.formula, 2, 'v1 的编号 1 应映射为 v2 的第 2 套');

console.log('小程序版逻辑冒烟测试通过：单次 430 个、角料 12/22 kg、第 3 套单排换算、参数版本锁、旧参数自动补角料默认值、批量解析、历史备份合并、CSV 导出均正常。');
