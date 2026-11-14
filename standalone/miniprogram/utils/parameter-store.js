'use strict';

/**
 * 参数维护 · 本地参数存储（微信小程序版）
 * 与原 Web 版 src/parameter-store.js 等价，存储介质换成 wx 本地缓存。
 * 关键约束保持不变：修订号乐观锁、字段范围校验、变更前必须显示新旧值。
 */

var calculation = require('./calculation');
var storage = require('./storage');

var STORAGE_KEY = 'material-calculator-parameters-v1';
var defaults = calculation.DEFAULT_PARAMETERS;

var FIELDS = Object.freeze([
  { key: 'materials.410.radius', label: '410 第 1 套密度系数', kind: 'material' },
  { key: 'materials.410.square', label: '410 第 2 套密度系数', kind: 'material' },
  { key: 'materials.201.radius', label: '201 第 1 套密度系数', kind: 'material' },
  { key: 'materials.201.square', label: '201 第 2 套密度系数', kind: 'material' },
  { key: 'materials.304.radius', label: '304 第 1 套密度系数', kind: 'material' },
  { key: 'materials.304.square', label: '304 第 2 套密度系数', kind: 'material' },
  { key: 'materials.316.radius', label: '316 第 1 套密度系数', kind: 'material' },
  { key: 'materials.316.square', label: '316 第 2 套密度系数', kind: 'material' },
  { key: 'modes.single.usableFactor', label: '单排冲料圆片比例系数', kind: 'usable' },
  { key: 'modes.single.scrapRatio', label: '单排角料比例系数', kind: 'scrap' },
  { key: 'modes.double.usableFactor', label: '双排冲料圆片比例系数', kind: 'usable' },
  { key: 'modes.double.scrapRatio', label: '双排角料比例系数', kind: 'scrap' },
  { key: 'modes.double.widthDivisor', label: '双排剪口换算值', kind: 'divisor' }
]);

function valueAt(object, key) {
  return key.split('.').reduce(function (part, name) {
    return part && part[name];
  }, object);
}

function editableValues(parameters) {
  var values = {};
  for (var i = 0; i < FIELDS.length; i += 1) {
    values[FIELDS[i].key] = valueAt(parameters, FIELDS[i].key);
  }
  return values;
}

function validateValues(values) {
  if (!values || typeof values !== 'object') throw new Error('参数数据缺失。');
  var clean = {};
  for (var i = 0; i < FIELDS.length; i += 1) {
    var field = FIELDS[i];
    var raw = values[field.key];
    if (raw === '' || raw === null || raw === undefined || typeof raw === 'boolean') {
      throw new Error(field.label + '不能为空。');
    }
    var number = Number(raw);
    if (!isFinite(number)) throw new Error(field.label + '必须是有效数字。');
    if (field.kind === 'material' && !(number > 0 && number <= 1000)) {
      throw new Error(field.label + '须大于 0 且不超过 1000。');
    }
    if (field.kind === 'usable' && !(number > 0 && number <= 1)) {
      throw new Error(field.label + '须大于 0 且不超过 1。');
    }
    if (field.kind === 'scrap' && !(number >= 0 && number <= 1)) {
      throw new Error(field.label + '须在 0 到 1 之间。');
    }
    if (field.kind === 'divisor' && !(number >= 1 && number <= 100)) {
      throw new Error(field.label + '须在 1 到 100 之间。');
    }
    clean[field.key] = number;
  }
  return clean;
}

function buildParameters(values, revision, updatedAt) {
  var materials = {};
  var list = ['410', '201', '304', '316'];
  for (var i = 0; i < list.length; i += 1) {
    var material = list[i];
    materials[material] = {
      square: values['materials.' + material + '.square'],
      radius: values['materials.' + material + '.radius']
    };
  }
  return {
    materials: materials,
    modes: {
      single: {
        widthDivisor: 1,
        usableFactor: values['modes.single.usableFactor'],
        scrapRatio: values['modes.single.scrapRatio']
      },
      double: {
        widthDivisor: values['modes.double.widthDivisor'],
        usableFactor: values['modes.double.usableFactor'],
        scrapRatio: values['modes.double.scrapRatio']
      }
    },
    cutStep: defaults.cutStep,
    pi: defaults.pi,
    revision: revision,
    updatedAt: updatedAt
  };
}

// 旧版本的参数缓存里没有角料比例字段：读取时先用默认值补齐，避免升级后整页报"参数格式异常"。
function withDefaults(values) {
  var merged = editableValues(defaults);
  if (!values || typeof values !== 'object' || Object.prototype.toString.call(values) === '[object Array]') return merged;
  Object.keys(values).forEach(function (key) {
    merged[key] = values[key];
  });
  return merged;
}

function readState() {
  var raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error('无法读取本地参数，请检查小程序的存储权限。');
  }
  if (raw === null || raw === undefined || raw === '') {
    return {
      revision: 0,
      updatedAt: null,
      parameters: buildParameters(editableValues(defaults), 0, null)
    };
  }
  try {
    var stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!stored || stored.schema !== 1 ||
        typeof stored.revision !== 'number' || Math.floor(stored.revision) !== stored.revision || stored.revision < 1 ||
        typeof stored.updatedAt !== 'string' || isNaN(Date.parse(stored.updatedAt)) ||
        !stored.values || typeof stored.values !== 'object' || Object.prototype.toString.call(stored.values) === '[object Array]') {
      throw new Error('invalid');
    }
    var values = validateValues(withDefaults(stored.values));
    return {
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      parameters: buildParameters(values, stored.revision, stored.updatedAt)
    };
  } catch (error) {
    throw new Error('本地参数格式异常。为避免覆盖原数据，已停止计算和参数修改。');
  }
}

function writeValues(values, expectedRevision) {
  var current = readState();
  if (current.revision !== expectedRevision) {
    throw new Error('参数已在其他页面更新，请返回参数维护页刷新后重试。');
  }
  var clean = validateValues(values);
  var before = editableValues(current.parameters);
  var unchanged = true;
  for (var i = 0; i < FIELDS.length; i += 1) {
    if (clean[FIELDS[i].key] !== before[FIELDS[i].key]) {
      unchanged = false;
      break;
    }
  }
  if (unchanged) throw new Error('参数没有变化。');

  var next = {
    schema: 1,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    values: clean
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    throw new Error('参数保存失败：本地存储不可用或空间不足。原参数未改变。');
  }
  return readState();
}

function restoreDefaults(expectedRevision) {
  return writeValues(editableValues(defaults), expectedRevision);
}

function exportBackup() {
  var state = readState();
  return {
    format: 'material-calculator-parameters',
    version: 1,
    exportedAt: new Date().toISOString(),
    values: editableValues(state.parameters)
  };
}

function importBackup(backup, expectedRevision) {
  if (!backup || backup.format !== 'material-calculator-parameters' || backup.version !== 1) {
    throw new Error('参数备份格式无效，未修改当前参数。');
  }
  return writeValues(validateValues(withDefaults(backup.values)), expectedRevision);
}

/** 表单差异文案，用于保存/恢复前的确认弹窗。 */
function describeChanges(before, after) {
  var lines = [];
  for (var i = 0; i < FIELDS.length; i += 1) {
    var field = FIELDS[i];
    if (before[field.key] !== after[field.key]) {
      lines.push(field.label + '：' + before[field.key] + ' → ' + after[field.key]);
    }
  }
  return lines;
}

module.exports = {
  STORAGE_KEY: STORAGE_KEY,
  FIELDS: FIELDS,
  valueAt: valueAt,
  editableValues: editableValues,
  validateValues: validateValues,
  readState: readState,
  writeValues: writeValues,
  restoreDefaults: restoreDefaults,
  exportBackup: exportBackup,
  importBackup: importBackup,
  describeChanges: describeChanges
};
