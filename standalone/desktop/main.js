'use strict';

/**
 * 材料数据计算 · 桌面版主进程
 * 纯离线：把内置的网页计算器装进独立窗口，数据保存在本机用户目录。
 */

const { app, BrowserWindow, Menu, dialog, shell, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_TITLE = '材料数据计算';
const APP_VERSION = '1.1.0';
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'calculator')
  : path.join(__dirname, '..', 'web');

app.setName('SSMaterialDataCalc');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

let mainWindow = null;

function resolveAsset(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch (error) {
    return null;
  }
  const relative = decodeURIComponent(pathname === '' || pathname === '/' ? '/index.html' : pathname);
  const target = path.normalize(path.join(ROOT, relative));
  if (!target.startsWith(ROOT)) return null;
  return target;
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于',
    message: `材料数据计算 v${APP_VERSION}`,
    detail: [
      '离线冲片计算工具：单次/批量计算、角料重量、历史记录、参数维护。',
      '公式版本 2.1.0（双排角料 12%、单排角料 22%）。',
      '',
      '所有数据保存在本机，不联网、不需要账号。',
      '备份请在「历史记录」「参数维护」页分别导出 JSON。'
    ].join('\n'),
    buttons: ['好']
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { label: '开发者工具', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: showAbout },
        {
          label: '项目主页',
          click: () => shell.openExternal('https://github.com/Yujay-Si/MatManager')
        },
        {
          label: '下载最新版',
          click: () => shell.openExternal('https://github.com/Yujay-Si/MatManager/releases/latest')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#f4f5f1',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('app://calculator/index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://calculator/')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setAppUserModelId('com.yujaysi.materialcalculator');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', request => {
      const target = resolveAsset(request.url);
      if (!target) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(target).toString());
    });
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
