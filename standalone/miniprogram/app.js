'use strict';

var calculation = require('./utils/calculation');

App({
  globalData: {
    appName: '圆片算量',
    version: '1.1.0',
    formulaVersion: calculation.FORMULA_VERSION,
    /** 跨页面的临时传递（例如从历史页跳回单次页回填参数）。 */
    pendingSingleInput: null
  },

  onLaunch: function () {
    // 纯离线工具：不登录、不请求网络、不上传任何数据。
    // 首次启动时打印一次环境信息，便于在开发者工具里排查问题。
    if (typeof wx !== 'undefined' && wx.getDeviceInfo) {
      try {
        var device = wx.getDeviceInfo();
        console.log('[圆片算量] 启动', this.globalData.version, device.platform, device.system);
      } catch (error) {
        console.log('[圆片算量] 启动', this.globalData.version);
      }
    }
  },

  onError: function (message) {
    console.error('[圆片算量] 运行异常', message);
  }
});
