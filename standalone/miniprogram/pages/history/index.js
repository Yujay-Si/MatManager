'use strict';

var calculation = require('../../utils/calculation');
var parameterStore = require('../../utils/parameter-store');
var historyStore = require('../../utils/history-store');
var batchData = require('../../utils/batch-data');
var resultOutput = require('../../utils/result-output');
var format = require('../../utils/format');
var fileShare = require('../../utils/file-share');

Page({
  data: {
    query: '',
    records: [],
    countText: '',
    emptyText: '暂无历史记录。',
    status: '',
    statusError: false
  },

  expanded: {},

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    var records;
    try {
      records = historyStore.readRecords();
    } catch (error) {
      this.setData({ records: [], countText: '', status: error.message, statusError: true });
      return;
    }

    var query = this.data.query.trim().toLowerCase();
    var expanded = this.expanded;
    var self = this;
    var visible = records.filter(function (record) {
      var result = record.result;
      var terms = [
        result.input.material,
        result.input.mode === 'single' ? '单排' : '双排',
        result.quantity,
        format.dateTime(result.calculatedAt)
      ];
      return terms.join(' ').toLowerCase().indexOf(query) !== -1;
    }).map(function (record) {
      var result = record.result;
      return {
        id: record.id,
        quantityText: format.thousands(result.quantity),
        meta: result.input.material + ' · ' +
          (result.input.mode === 'single' ? '单排' : '双排') +
          (result.input.formula === 3 ? ' · 方片换算' : '') +
          ' · ' + format.dateTime(result.calculatedAt),
        expanded: !!expanded[record.id],
        detailPairs: resultOutput.detailPairs(result)
      };
    });

    this.setData({
      records: visible,
      countText: '显示 ' + visible.length + ' 条，共 ' + records.length + ' / ' + historyStore.MAX_RECORDS + ' 条',
      emptyText: records.length ? '没有符合条件的历史记录。' : '暂无历史记录，先去「单次计算」算一条吧。'
    });
  },

  onFilterInput: function (event) {
    this.setData({ query: event.detail.value }, this.refresh.bind(this));
  },

  onToggleDetail: function (event) {
    var id = event.currentTarget.dataset.id;
    this.expanded[id] = !this.expanded[id];
    this.refresh();
  },

  onRecalculate: function (event) {
    var id = event.currentTarget.dataset.id;
    try {
      var records = historyStore.readRecords();
      var record = null;
      for (var i = 0; i < records.length; i += 1) {
        if (records[i].id === id) {
          record = records[i];
          break;
        }
      }
      if (!record) throw new Error('未找到该历史记录，可能已被删除。');
      var input = calculation.currentInputFromHistory(record.result);
      var fresh = calculation.calculate(input, parameterStore.readState().parameters);
      historyStore.addResults([fresh]);
      this.refresh();
      this.setData({ status: '已按当前参数生成新记录；原历史记录未改变。', statusError: false });
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
    }
  },

  onDelete: function (event) {
    var id = event.currentTarget.dataset.id;
    var self = this;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条历史记录吗？删除后无法撤销。',
      confirmText: '删除',
      confirmColor: '#9c392d',
      success: function (result) {
        if (!result.confirm) return;
        try {
          historyStore.remove(id);
          delete self.expanded[id];
          self.refresh();
          self.setData({ status: '历史记录已删除。', statusError: false });
        } catch (error) {
          self.setData({ status: error.message, statusError: true });
        }
      }
    });
  },

  onBackup: function () {
    var self = this;
    try {
      var backup = historyStore.exportBackup();
      fileShare.exportTextFile('材料计算历史备份.json', JSON.stringify(backup, null, 2), {
        onSuccess: function () {
          self.setData({ status: '已生成包含 ' + backup.records.length + ' 条记录的 JSON 备份。', statusError: false });
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
        if (file.size > batchData.MAX_FILE_BYTES) {
          self.setData({ status: '备份文件超过 2 MB 上限。', statusError: true });
          return;
        }
        var backup;
        try {
          backup = JSON.parse(wx.getFileSystemManager().readFileSync(file.path, 'utf-8'));
        } catch (error) {
          self.setData({ status: 'JSON 备份文件格式错误。', statusError: true });
          return;
        }
        var total = Array.isArray(backup.records) ? backup.records.length : 0;
        wx.showModal({
          title: '恢复历史备份',
          content: '确定合并导入 ' + total + ' 条历史备份吗？现有记录不会被覆盖，重复记录会自动跳过。',
          confirmText: '导入',
          success: function (modal) {
            if (!modal.confirm) return;
            try {
              var outcome = historyStore.importBackup(backup);
              self.refresh();
              self.setData({
                status: '已导入 ' + outcome.imported + ' 条，跳过重复 ' + outcome.skipped + ' 条。',
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
    return { title: '圆片算量 · 历史记录', path: '/pages/single/index' };
  }
});
