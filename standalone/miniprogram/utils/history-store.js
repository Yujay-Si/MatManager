'use strict';

/**
 * 历史记录 · 本地存储（微信小程序版）
 * 与原 Web 版 src/history-store.js 等价：最多 500 条、写入前全量校验、
 * 备份合并导入、记录不可变（重新计算会新增一条）。
 */

var storage = require('./storage');

var STORAGE_KEY = 'material-calculator-history-v1';
var MAX_RECORDS = 500;
var PARAMETER_KEYS = ['squareFactor', 'radiusFactor', 'widthDivisor', 'usableFactor', 'cutStep', 'pi'];

function validRecord(record) {
  if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 200 || !record.result) return false;
  var result = record.result;
  var input = result.input;
  var parameters = result.parameters;
  if (!input || !parameters) return false;

  if (['410', '201', '304', '316'].indexOf(input.material) === -1) return false;
  if (['single', 'double'].indexOf(input.mode) === -1) return false;
  if ([1, 2, 3].indexOf(Number(input.formula)) === -1) return false;
  if (!isFinite(input.thickness) || input.thickness <= 0) return false;
  if (!isFinite(input.width) || input.width <= 0) return false;
  if (!isFinite(input.weight) || input.weight <= 0) return false;
  if (typeof result.formulaVersion !== 'string' || !/^\d+\./.test(result.formulaVersion)) return false;
  if (typeof result.calculatedAt !== 'string' || isNaN(Date.parse(result.calculatedAt))) return false;
  if (typeof result.quantity !== 'number' || Math.floor(result.quantity) !== result.quantity || result.quantity < 0) return false;
  if (!isFinite(result.cut) || result.cut <= 0) return false;
  if (!isFinite(result.selectedUnitWeight) || result.selectedUnitWeight <= 0) return false;
  for (var i = 0; i < PARAMETER_KEYS.length; i += 1) {
    var key = PARAMETER_KEYS[i];
    if (!isFinite(parameters[key]) || parameters[key] <= 0) return false;
  }
  return true;
}

function readRecords() {
  var raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error('无法读取本地历史存储，请检查小程序的本地数据权限。');
  }
  if (raw === null || raw === undefined || raw === '') return [];
  try {
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data) || data.length > MAX_RECORDS) throw new Error('invalid history');
    for (var i = 0; i < data.length; i += 1) {
      if (!validRecord(data[i])) throw new Error('invalid history');
    }
    return data;
  } catch (error) {
    throw new Error('历史数据格式异常。为避免覆盖原数据，已停止历史写入。');
  }
}

function writeRecords(records) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    throw new Error('历史保存失败：本地存储不可用或空间不足。计算结果仍可查看。');
  }
}

function newId() {
  return Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10);
}

function addResults(results) {
  if (!Array.isArray(results) || results.length === 0) return 0;
  var records = readRecords();
  if (records.length + results.length > MAX_RECORDS) {
    throw new Error('历史最多保存 ' + MAX_RECORDS + ' 条；本次结果未写入，请先备份并删除不需要的旧记录。');
  }
  var additions = [];
  for (var i = 0; i < results.length; i += 1) {
    additions.push({ id: newId(), result: JSON.parse(JSON.stringify(results[i])) });
  }
  writeRecords(additions.concat(records));
  return additions.length;
}

function remove(id) {
  var records = readRecords();
  var next = [];
  for (var i = 0; i < records.length; i += 1) {
    if (records[i].id !== id) next.push(records[i]);
  }
  if (next.length === records.length) throw new Error('未找到要删除的历史记录。');
  writeRecords(next);
}

function clearAll() {
  writeRecords([]);
}

function exportBackup() {
  var records = readRecords();
  return {
    format: 'material-calculator-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records
  };
}

function importBackup(backup) {
  if (!backup || backup.format !== 'material-calculator-history' || backup.version !== 1 ||
      !Array.isArray(backup.records) || backup.records.length > MAX_RECORDS) {
    throw new Error('历史备份格式无效，未写入任何记录。');
  }
  var i;
  for (i = 0; i < backup.records.length; i += 1) {
    if (!validRecord(backup.records[i])) throw new Error('历史备份格式无效，未写入任何记录。');
  }
  var existing = readRecords();
  var ids = {};
  for (i = 0; i < existing.length; i += 1) ids[existing[i].id] = true;
  var additions = [];
  for (i = 0; i < backup.records.length; i += 1) {
    var record = backup.records[i];
    if (ids[record.id]) continue;
    ids[record.id] = true;
    additions.push(record);
  }
  if (existing.length + additions.length > MAX_RECORDS) {
    throw new Error('导入后将超过 ' + MAX_RECORDS + ' 条历史上限，未写入任何记录。');
  }
  if (additions.length > 0) writeRecords(additions.concat(existing));
  return { imported: additions.length, skipped: backup.records.length - additions.length };
}

module.exports = {
  readRecords: readRecords,
  addResults: addResults,
  remove: remove,
  clearAll: clearAll,
  exportBackup: exportBackup,
  importBackup: importBackup,
  MAX_RECORDS: MAX_RECORDS,
  STORAGE_KEY: STORAGE_KEY
};
