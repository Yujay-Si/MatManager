'use strict';

var calculation = require('../../utils/calculation');
var parameterStore = require('../../utils/parameter-store');
var fileShare = require('../../utils/file-share');

function nowText(value) {
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

Page({
  data: {
    fields: [],
    versionText: '默认参数 v0',
    status: '',
    statusError: false
  },

  loadedRevision: null,
  rawValues: {},

  onShow: function () {
    this.load();
  },

  load: function () {
    try {
      var state = parameterStore.readState();
      this.loadedRevision = state.revision;
      var rawValues = {};
      var fields = parameterStore.FIELDS.map(function (field) {
        var value = parameterStore.valueAt(state.parameters, field.key);
        rawValues[field.key] = String(value);
        return { key: field.key, label: field.label, value: String(value) };
      });
      this.rawValues = rawValues;
      this.setData({
        fields: fields,
        versionText: state.revision === 0
          ? '默认参数 v0 · 尚未修改'
          : '本机参数 v' + state.revision + ' · 最近修改 ' + nowText(state.updatedAt),
        status: '',
        statusError: false
      });
    } catch (error) {
      this.loadedRevision = null;
      this.setData({
        versionText: '本地参数无法读取',
        status: error.message,
        statusError: true
      });
    }
  },

  onFieldInput: function (event) {
    var key = event.currentTarget.dataset.key;
    var index = Number(event.currentTarget.dataset.index);
    var value = event.detail.value;
    this.rawValues[key] = value;
    var patch = {};
    patch['fields[' + index + '].value'] = value;
    this.setData(patch);
  },

  ensureRevision: function () {
    var current = parameterStore.readState();
    if (current.revision !== this.loadedRevision) {
      throw new Error('参数已在其他页面更新，请重新进入参数维护页后再操作。');
    }
    return current;
  },

  onSave: function () {
    var self = this;
    var current;
    var incoming;
    var changes;
    try {
      current = this.ensureRevision();
      incoming = parameterStore.validateValues(this.rawValues);
      changes = parameterStore.describeChanges(
        parameterStore.editableValues(current.parameters),
        incoming
      );
      if (changes.length === 0) throw new Error('参数没有变化。');
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return;
    }

    wx.showModal({
      title: '确认保存参数',
      content: changes.join('\n') + '\n\n新参数只影响后续计算，历史结果不变。',
      confirmText: '保存',
      success: function (modal) {
        if (!modal.confirm) return;
        try {
          var saved = parameterStore.writeValues(incoming, self.loadedRevision);
          self.load();
          self.setData({
            status: '参数已保存为本机参数 v' + saved.revision + '；历史计算结果未修改。',
            statusError: false
          });
        } catch (error) {
          self.setData({ status: error.message, statusError: true });
        }
      }
    });
  },

  onRestoreDefaults: function () {
    var self = this;
    var current;
    var defaults;
    var changes;
    try {
      current = this.ensureRevision();
      defaults = parameterStore.editableValues(calculation.DEFAULT_PARAMETERS);
      changes = parameterStore.describeChanges(
        parameterStore.editableValues(current.parameters),
        defaults
      );
      if (changes.length === 0) throw new Error('当前已是出厂默认参数。');
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return;
    }

    wx.showModal({
      title: '恢复出厂默认值',
      content: changes.join('\n') + '\n\n新参数只影响后续计算，历史结果不变。',
      confirmText: '恢复',
      success: function (modal) {
        if (!modal.confirm) return;
        try {
          var saved = parameterStore.restoreDefaults(self.loadedRevision);
          self.load();
          self.setData({
            status: '已恢复出厂默认值，当前为本机参数 v' + saved.revision + '；历史计算结果未修改。',
            statusError: false
          });
        } catch (error) {
          self.setData({ status: error.message, statusError: true });
        }
      }
    });
  },

  onBackup: function () {
    var self = this;
    try {
      var backup = parameterStore.exportBackup();
      fileShare.exportTextFile('材料计算参数备份.json', JSON.stringify(backup, null, 2), {
        onSuccess: function () {
          self.setData({ status: '参数 JSON 备份已发送到聊天。', statusError: false });
        },
        onCancel: function () {
          self.setData({ status: '已取消备份。', statusError: false });
        },
        onError: function (error) {
          self.setData({ status: error.message, statusError: true });
        }
      });
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
    }
  },

  onRestore: function () {
    var self = this;
    if (typeof wx.chooseMessageFile !== 'function') {
      this.setData({ status: '当前微信版本不支持选择文件。', statusError: true });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: function (result) {
        var file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        if (file.size > 100 * 1024) {
          self.setData({ status: '参数备份文件超过 100 KB 上限。', statusError: true });
          return;
        }
        var backup;
        try {
          backup = JSON.parse(wx.getFileSystemManager().readFileSync(file.path, 'utf-8'));
        } catch (error) {
          self.setData({ status: 'JSON 备份文件格式错误。', statusError: true });
          return;
        }
        var current;
        var incoming;
        var changes;
        try {
          if (!backup || backup.format !== 'material-calculator-parameters' || backup.version !== 1) {
            throw new Error('参数备份格式无效。');
          }
          current = self.ensureRevision();
          incoming = parameterStore.validateValues(backup.values);
          changes = parameterStore.describeChanges(
            parameterStore.editableValues(current.parameters),
            incoming
          );
          if (changes.length === 0) throw new Error('备份参数与当前参数相同。');
        } catch (error) {
          self.setData({ status: error.message, statusError: true });
          return;
        }

        wx.showModal({
          title: '导入参数备份',
          content: changes.join('\n') + '\n\n新参数只影响后续计算，历史结果不变。',
          confirmText: '导入',
          success: function (modal) {
            if (!modal.confirm) return;
            try {
              var saved = parameterStore.importBackup(backup, self.loadedRevision);
              self.load();
              self.setData({
                status: '已导入参数，本机参数 v' + saved.revision + '；历史计算结果未修改。',
                statusError: false
              });
            } catch (error) {
              self.setData({ status: error.message, statusError: true });
            }
          }
        });
      },
      fail: function (error) {
        var message = (error && error.errMsg) || '';
        if (message.indexOf('cancel') !== -1) return;
        self.setData({ status: '选择文件失败：' + message, statusError: true });
      }
    });
  },

  onShareAppMessage: function () {
    return { title: '圆片算量 · 参数维护', path: '/pages/single/index' };
  }
});
