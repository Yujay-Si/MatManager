'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// Use software rendering for repeatable screenshot checks on hosts without a stable GPU surface.
app.disableHardwareAcceleration();
require('../../desktop/main.js');
app.whenReady().then(async () => {
  let stage = '启动';
  try {
    const window = BrowserWindow.getAllWindows()[0];
    window.hide();
    window.webContents.setBackgroundThrottling(false);
    if (window.webContents.isLoading() || !window.webContents.getURL().startsWith('ssmatcalc://app/')) await new Promise((resolve, reject) => {
      window.webContents.once('did-finish-load', resolve);
      window.webContents.once('did-fail-load', (_event, code, message) => reject(new Error(`${code}: ${message}`)));
    });
    const errors = [];
    if (process.env.MATERIAL_SMOKE_PHASE === 'file') await window.loadFile(path.resolve(__dirname, '../preview-site/index.html'));
    if (process.env.MATERIAL_SMOKE_PHASE === 'http') await window.loadURL('http://127.0.0.1:8765/');
    window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    stage = '界面业务';
    const result = await window.webContents.executeJavaScript(`(${async function () {
      const wait = async predicate => {
        for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
        throw new Error('等待界面状态超时');
      };
      const check = (value, message) => { if (!value) throw new Error(message); };
      const click = selector => { const node = document.querySelector(selector); check(node, '未找到 ' + selector); node.click(); };
      const input = (root, name, value) => {
        const node = root.querySelector('[name="' + name + '"]'); check(node, '未找到字段 ' + name);
        node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const submit = form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      window.confirm = () => true;
      await wait(() => window.MaterialStore && !document.getElementById('material-add-supplier').disabled);
      check([...document.querySelectorAll('.sidebar-group')].map(b => b.textContent.trim().split(' ')[0]).join(',') === '供应商管理,材料管理,数据管理', '导航模块顺序错误');
      const group = document.querySelector('[aria-controls="supplier-navigation"]');
      group.click(); check(document.getElementById('supplier-navigation').hidden && group.getAttribute('aria-expanded') === 'false', '导航不能收起');
      group.click(); check(!document.getElementById('supplier-navigation').hidden && group.getAttribute('aria-expanded') === 'true', '导航不能展开');
      const existing = await MaterialStore.read();
      if (existing.suppliers.length === 0) {
        click('[data-material-page="suppliers"]');
        click('#material-add-supplier');
        let form = document.getElementById('material-supplier-form');
        input(form, 'name', '验收供应商'); input(form, 'openingDate', '2026-10-01'); input(form, 'openingAmount', '1000');
        submit(form); await wait(() => !document.getElementById('material-dialog').open);
        click('[data-material-page="orders"]');
        click('[data-action="new"]');
        form = document.getElementById('material-document-form');
        check(form.classList.contains('document-sheet'), '订货录入未采用单据模板');
        check(form.querySelector('#material-lines').tagName === 'TBODY', '订货明细未采用表格行');
        input(form, 'date', '2026-10-01');
        let line = form.querySelector('.material-line');
        for (const [name, value] of Object.entries({ material: '201', spec: '0.3×600', quantity: 10, price: 12.5, product: '圆片' })) input(line, name, value);
        click('[data-action="add-line"]');
        line = form.querySelectorAll('.material-line')[1];
        for (const [name, value] of Object.entries({ material: '304', spec: '0.5×600', quantity: 5, price: 20 })) input(line, name, value);
        submit(form); await wait(() => document.getElementById('material-dialog').open);
        check(document.getElementById('material-detail-body').textContent.includes('0 / 10'), '订货结欠未显示');
        check(document.getElementById('order-related-receipts').textContent.includes('暂无关联收货单'), '无收货订单未提示空状态');
        click('[data-close-dialog]');
        click('[data-material-page="receipts"]'); click('[data-action="new"]');
        form = document.getElementById('material-document-form');
        input(form, 'date', '2026-10-02');
        check(form.querySelector('.document-head') && form.querySelector('#material-lines').tagName === 'TBODY', '收货单单头或明细表缺失');
        line = form.querySelector('.material-line');
        const link = line.querySelector('[name="orderLink"]');
        check(link.options.length === 3, '供应商订货提示不完整');
        link.selectedIndex = 1; link.dispatchEvent(new Event('change', { bubbles: true }));
        input(line, 'quantity', 4); input(line, 'weights', '10.125\n20.375'); input(line, 'progress', '已分料，待冲压');
        check(document.getElementById('material-form-totals').textContent.includes('381.25'), '收货总金额错误');
        submit(form); await wait(() => document.getElementById('material-dialog').open);
        click('[data-close-dialog]');
        const beforeInvalid = await MaterialStore.read();
        click('[data-action="new"]');
        form = document.getElementById('material-document-form'); input(form, 'date', '2026-10-02');
        line = form.querySelector('.material-line');
        const badLink = line.querySelector('[name="orderLink"]'); badLink.selectedIndex = 1; badLink.dispatchEvent(new Event('change', { bubbles: true }));
        input(line, 'quantity', 7); input(line, 'weights', 10); submit(form);
        await wait(() => document.getElementById('material-status').textContent.includes('超出'));
        check((await MaterialStore.read()).receipts.length === beforeInvalid.receipts.length, '超额收货写入了数据库');
        click('[data-action="cancel"]');
        click('[data-material-page="payments"]'); click('[data-action="new"]');
        form = document.getElementById('material-document-form'); input(form, 'date', '2026-10-03'); input(form, 'repayment', 200); input(form, 'discount', 10);
        check(form.querySelector('.payment-columns') && form.querySelector('.document-footer'), '付款分区布局缺失');
        check(document.getElementById('material-form-totals').textContent.includes('1,171.25'), '付款后余额错误');
        submit(form); await wait(() => document.getElementById('material-dialog').open);
        click('[data-close-dialog]');
      }
      const state = await MaterialStore.read();
      check(state.suppliers.some(s => s.name === '验收供应商') && state.orders.length === 1 && state.receipts.length === 1 && state.payments.length === 1, '重启后单据不完整');
      const supplier = state.suppliers[0];
      click('[data-material-page="orders"]'); click('[data-action="detail"]');
      check(document.querySelectorAll('#order-related-receipts [data-related-receipt]').length === 1, '订货详情关联收货列表不完整');
      check(document.getElementById('order-related-receipts').textContent.includes('381.25'), '关联收货金额未显示');
      click('[data-related-receipt]');
      check(document.querySelector('#material-dialog h2').textContent === '材料收货单', '关联收货详情未打开');
      check(document.getElementById('material-detail-body').textContent.includes('10.125 + 20.375'), '收货详情缺少各捆重量');
      click('[data-return-order-detail]');
      check(document.querySelector('#material-dialog h2').textContent === '材料订货单', '无法返回原订货单');
      click('[data-close-dialog]');
      click('[data-material-page="receipts"]'); click('[data-action="edit"]');
      let editForm = document.getElementById('material-document-form');
      input(editForm.querySelector('.material-line'), 'quantity', 5);
      submit(editForm); await wait(() => document.getElementById('material-dialog').open); click('[data-close-dialog]');
      let edited = await MaterialStore.read();
      check(MaterialDomain.remaining(edited, edited.orders[0].id, edited.orders[0].lines[0].id) === 5, '编辑收货未重新计算结欠');
      check(edited.receipts[0].sequence === state.receipts[0].sequence, '编辑改变了单据排序');
      click('[data-action="edit"]'); editForm = document.getElementById('material-document-form');
      input(editForm.querySelector('.material-line'), 'quantity', 4);
      submit(editForm); await wait(() => document.getElementById('material-dialog').open); click('[data-close-dialog]');
      const report = MaterialDomain.statement(state, supplier.id, '2026-10-03', '2026-10-08');
      check(report.openingCents === 138125 && report.closingCents === 117125, '跨期余额错误');
      click('[data-material-page="statement"]');
      let form = document.getElementById('material-statement-form');
      input(form, 'supplierId', supplier.id); input(form, 'start', '2026-10-03'); input(form, 'end', '2026-10-08');
      submit(form); await wait(() => document.querySelector('#material-statement-result table'));
      check(document.getElementById('material-statement-result').textContent.includes('1,381.25'), '期初欠款未展示');
      click('[data-action="statement-detail"]');
      check(document.getElementById('material-detail-body').textContent.includes('1,171.25'), '对账详情未显示付款后欠款');
      click('[data-close-dialog]');
      const backup = await MaterialStore.backup();
      await MaterialStore.restore(backup);
      check((await MaterialStore.read()).payments.length === 1, '重复恢复产生了重复付款');
      const invalid = JSON.parse(JSON.stringify(backup)); invalid.state.receipts[0].supplierId = 'missing-supplier';
      let refused = false;
      try { await MaterialStore.restore(invalid); } catch (error) { refused = true; }
      check(refused && (await MaterialStore.read()).receipts[0].supplierId === supplier.id, '无效恢复改写了现有数据');
      click('[data-material-page="suppliers"]');
      check(document.getElementById('page-section').textContent.startsWith('供应商管理'), '独立导航未生效');
      check(document.getElementById('supplier-filter-field').hidden, '供应商页混入单据筛选');
      const supplierSelector = action => `[data-action="${action}"][data-id="${supplier.id}"]`;
      click(supplierSelector('supplier-edit'));
      form = document.getElementById('material-supplier-form');
      input(form, 'contact', '张师傅'); input(form, 'phone', '13800138000'); input(form, 'address', '厂区1号'); input(form, 'note', '<img src=x onerror=alert(1)>');
      submit(form); await wait(() => !document.getElementById('material-dialog').open);
      check((await MaterialStore.read()).suppliers[0].contact === '张师傅', '供应商资料未保存');
      form = document.getElementById('supplier-search-form'); input(form, 'search', '13800138000');
      check(document.querySelectorAll('#supplier-list tbody tr').length === 1, '电话搜索错误');
      input(form, 'search', '不存在的搜索词');
      check(document.getElementById('supplier-list').textContent.includes('暂无记录'), '搜索无结果未提示');
      input(form, 'search', ''); input(form, 'date', '2026-10-01'); submit(form);
      await wait(() => document.getElementById('supplier-count').textContent.includes('2026-10-01'));
      check(document.querySelector('#supplier-list tbody').textContent.includes('1,000.00'), '供应商截至日期余额错误');
      input(form, 'date', '2026-10-08'); submit(form);
      await wait(() => document.getElementById('supplier-count').textContent.includes('2026-10-08'));
      click(supplierSelector('supplier-detail'));
      check(!document.querySelector('#material-dialog img'), '供应商备注被当作HTML执行');
      click('[data-supplier-jump="receipts"]');
      check(document.getElementById('material-supplier-filter').value === supplier.id, '供应商业务跳转丢失筛选');
      click('[data-material-page="suppliers"]'); click(supplierSelector('supplier-toggle'));
      await wait(async () => (await MaterialStore.read()).suppliers[0].active === false);
      check(MaterialDomain.supplierBalance(await MaterialStore.read(), supplier.id, '2026-10-08') === 117125, '停用改变了欠款');
      click(supplierSelector('supplier-detail')); click('[data-supplier-jump="statement"]');
      check(document.getElementById('material-statement-result').textContent.includes('1,171.25'), '停用供应商无法查询对账');
      click('[data-material-page="suppliers"]'); click(supplierSelector('supplier-toggle'));
      await wait(async () => (await MaterialStore.read()).suppliers[0].active === true);
      // Two simultaneous connections must preserve both writes.
      await Promise.all([
        MaterialStore.save('suppliers', { id: 'concurrent-a', name: '并发甲', openingDate: '2026-10-01', openingAmount: '0' }),
        MaterialStore.save('suppliers', { id: 'concurrent-b', name: '并发乙', openingDate: '2026-10-01', openingAmount: '0' })
      ]);
      check((await MaterialStore.read()).suppliers.length === 3, '并发保存丢失数据');
      click('#open-calculator');
      check(!document.getElementById('calculator-module').hidden, '数据计算入口不可用');
      click('[data-view="batch"]');
      check(!document.getElementById('batch-view').hidden, '原批量计算入口不可用');
      click('[data-material-page="statement"]');
      form = document.getElementById('material-statement-form'); input(form, 'supplierId', supplier.id); input(form, 'start', '2026-10-01'); input(form, 'end', '2026-10-08');
      submit(form); await wait(() => document.querySelector('#material-statement-result table'));
      return { supplier: supplier.name, opening: report.openingCents, closing: report.closingCents, remaining: MaterialDomain.remaining(state, state.orders[0].id, state.orders[0].lines[0].id), documents: 3, origin: location.origin };
    }.toString()})()`);
    assert.equal(result.remaining, 6);
    assert.deepEqual(errors, []);
    await window.webContents.executeJavaScript('document.fonts.ready');
    const output = path.join(__dirname, '..', '..', 'work', 'material-verification');
    fs.mkdirSync(output, { recursive: true });
    // Chromium needs a composited surface to capture a window initially hidden during tests.
    window.setOpacity(0); window.showInactive();
    await new Promise(resolve => setTimeout(resolve, 500));
    stage = '对账截图';
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, 'statement-desktop.png'), screenshot.toPNG());
    await window.webContents.executeJavaScript(`MaterialUI.choosePage('orders'); document.querySelector('[data-action="detail"]').click()`);
    window.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 500));
    fs.writeFileSync(path.join(output, 'order-related-receipts.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[data-close-dialog]').click()`);
    window.setSize(1600, 950);
    const beforeLayout = await window.webContents.executeJavaScript('MaterialStore.read()');
    for (const key of ['orders', 'receipts', 'payments']) {
      await window.webContents.executeJavaScript(`(() => {
        MaterialUI.choosePage(${JSON.stringify(key)}); document.querySelector('[data-action="edit"]').click();
        document.getElementById('material-document-form').scrollIntoView({behavior:'instant',block:'start'});
      })()`);
      window.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 300));
      fs.writeFileSync(path.join(output, key + '-layout.png'), (await window.webContents.capturePage()).toPNG());
      const names = await window.webContents.executeJavaScript(`[...document.querySelectorAll('#material-document-form [name]')].map(n => n.name)`);
      const requiredNames = key === 'payments' ? ['supplierId', 'date', 'note', 'repayment', 'discount'] : key === 'receipts' ? ['supplierId', 'date', 'note', 'orderLink', 'material', 'spec', 'quantity', 'weights', 'price', 'progress'] : ['supplierId', 'date', 'note', 'material', 'spec', 'quantity', 'price', 'product', 'lineNote'];
      assert.deepEqual([...new Set(names)].sort(), requiredNames.sort(), key + ' 原录入字段发生变化');
      await window.webContents.executeJavaScript(`document.querySelector('[data-action="cancel"]').click()`);
      await window.webContents.executeJavaScript(`document.querySelector('[data-action="detail"]').click()`);
      window.webContents.invalidate(); await new Promise(resolve => setTimeout(resolve, 200));
      fs.writeFileSync(path.join(output, key + '-detail-layout.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`window.print = () => {}; document.querySelector('[data-print-detail]').click()`);
      const documentPdf = await window.webContents.printToPDF({ printBackground: true });
      assert.ok(documentPdf.length > 1000, key + ' 打印文件为空');
      fs.writeFileSync(path.join(output, key + '-layout.pdf'), documentPdf);
    }
    assert.deepEqual(await window.webContents.executeJavaScript('MaterialStore.read()'), beforeLayout, '排版浏览改写了原单据');
    window.setSize(1200, 820);
    await window.webContents.executeJavaScript(`MaterialUI.choosePage('suppliers')`);
    await new Promise(resolve => setTimeout(resolve, 200));
    stage = '供应商截图';
    fs.writeFileSync(path.join(output, 'suppliers-desktop.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`MaterialUI.choosePage('statement'); document.getElementById('material-statement-form').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))`);
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript(`!!document.querySelector('#material-statement-result table')`)) break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    window.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(output, 'statement-layout.png'), (await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(320, 600); window.setSize(640, 850);
    await new Promise(resolve => setTimeout(resolve, 200));
    const narrow = await window.webContents.executeJavaScript('({scroll: document.documentElement.scrollWidth, width: innerWidth})');
    assert.ok(narrow.scroll <= narrow.width, '窄窗口出现页面横向溢出');
    fs.writeFileSync(path.join(output, 'statement-narrow.png'), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript(`window.print = () => {}; document.querySelector('[data-action="print-statement"]').click()`);
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript(`document.querySelector('#print-area h1')?.textContent === '材料对账单'`)) break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#print-area h1')?.textContent`), '材料对账单');
    const pdf = await window.webContents.printToPDF({ printBackground: true });
    assert.ok(pdf.length > 1000);
    fs.writeFileSync(path.join(output, 'statement-print.pdf'), pdf);
    if (process.env.MATERIAL_SMOKE_PHASE === 'read') {
      const voidResult = await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-material-page="receipts"]').click();
        document.querySelector('[data-action="void"]').click();
        for (let i = 0; i < 100; i++) {
          const state = await MaterialStore.read();
          if (state.receipts[0].voided) return MaterialDomain.remaining(state, state.orders[0].id, state.orders[0].lines[0].id);
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('界面作废收货失败');
      })()`);
      assert.equal(voidResult, 10, '作废收货未恢复未收件数');
      const archivedVisible = await window.webContents.executeJavaScript(`(() => {
        MaterialUI.choosePage('orders'); document.querySelector('[data-action="detail"]').click();
        const visible = document.getElementById('order-related-receipts').textContent.includes('已作废，不计入已收件数');
        document.querySelector('[data-related-receipt]').click();
        return visible && document.getElementById('material-detail-body').textContent.includes('已作废');
      })()`);
      assert.ok(archivedVisible, '作废关联收货不可查看');
    }
    console.log(JSON.stringify({ ...result, pdfBytes: pdf.length, narrowWidth: narrow.width }));
    app.quit();
  } catch (error) { console.error('验收阶段：' + stage, error); app.exit(1); }
});
