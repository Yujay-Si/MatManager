(function (global) {
  'use strict';
  const D = global.MaterialDomain, store = global.MaterialStore;
  const byId = id => document.getElementById(id);
  const titles = { orders: '材料订货单', receipts: '材料收货单', payments: '材料付款单', statement: '材料对账单', suppliers: '供应商资料' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const uid = () => global.crypto.randomUUID();
  let state = D.empty(), page = 'orders', ready = false, busy = false, editingId = null, dirty = false;
  let query = { supplierId: '', start: '', end: today() };
  let supplierQuery = { search: '', status: '', date: today() };
  const content = byId('material-content'), dialog = byId('material-dialog');
  function status(message, error = false) {
    const node = byId('material-status');
    node.textContent = message; node.hidden = !message; node.classList.toggle('is-error', error);
    node.setAttribute('role', error ? 'alert' : 'status');
    if (error && !byId('material-view').hidden) node.focus();
  }
  const supplierName = id => state.suppliers.find(s => s.id === id)?.name || '供应商不存在';
  function options(selected = '', all = false, includeInactive = false) {
    return `<option value="">${all ? '全部供应商' : '请选择供应商'}</option>` + state.suppliers.filter(s => all || includeInactive || s.active !== false || s.id === selected).map(s => `<option value="${escape(s.id)}" ${s.id === selected ? 'selected' : ''}>${escape(s.name)}${s.active === false ? '（已停用）' : ''}</option>`).join('');
  }
  function field(label, name, value = '', type = 'text', extra = '') {
    return `<label class="field"><span>${escape(label)}</span><input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
  }
  function selectSupplier(name, selected, includeInactive = false) { return `<label class="field"><span>供应商</span><select name="${name}" required>${options(selected, false, includeInactive)}</select></label>`; }
  function table(headers, rows) {
    return `<div class="table-scroll"><table class="results-table material-table"><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">暂无记录</td></tr>`}</tbody></table></div>`;
  }
  function download(text, name, type = 'application/json') {
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function confirmDiscard() { return !dirty || global.confirm('有尚未保存的单据内容，确定放弃本次输入吗？'); }
  function updateFilter() {
    const current = byId('material-supplier-filter').value;
    byId('material-supplier-filter').innerHTML = options(current, true);
  }
  async function refresh() { state = await store.read(); ready = true; updateFilter(); }
  async function action(work) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#material-view button, #material-dialog button').forEach(b => { b.disabled = true; });
    try { await work(); }
    catch (error) {
      if (dialog.open) {
        let node = dialog.querySelector('[role="alert"]');
        if (!node) { node = document.createElement('p'); node.className = 'material-error'; node.setAttribute('role', 'alert'); dialog.prepend(node); }
        node.textContent = error.message || '操作失败。';
      } else status(error.message || '操作失败。', true);
    } finally {
      busy = false;
      document.querySelectorAll('#material-view button, #material-dialog button').forEach(b => { b.disabled = false; });
    }
  }
  function choosePage(next) {
    if (busy || !confirmDiscard()) return;
    page = next; editingId = null; dirty = false;
    byId('calculator-module').hidden = true; byId('material-view').hidden = false;
    byId('page-title').textContent = titles[page]; byId('page-section').textContent = (page === 'suppliers' ? '供应商管理 / ' : '材料管理 / ') + titles[page];
    byId('supplier-filter-field').hidden = page === 'suppliers';
    byId('material-add-supplier').hidden = page !== 'suppliers';
    document.querySelectorAll('.sidebar-link').forEach(b => {
      const active = b.dataset.materialPage === page;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      if (active) expandNavigation(b.closest('nav').id);
    });
    status(''); render(); global.scrollTo({ top: 0, behavior: 'instant' });
  }
  function render() {
    if (!ready) { content.innerHTML = '<p class="material-muted">正在读取材料数据…</p>'; return; }
    if (page === 'statement') { renderStatement(); return; }
    if (page === 'suppliers') { renderSuppliers(); return; }
    const selected = byId('material-supplier-filter').value;
    const docs = state[page].filter(d => !selected || d.supplierId === selected).slice().sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
    const rows = docs.map(doc => {
      let summary;
      if (page === 'orders') {
        const linked = D.relatedReceipts(state, doc.id);
        summary = doc.lines.map(l => `${l.material} / ${l.spec}：订${l.quantity}件，已收${Number(l.quantity) - D.remaining(state, doc.id, l.id)}，结欠${D.remaining(state, doc.id, l.id)}`).join('；') + `；关联收货单 ${linked.length} 张（有效 ${linked.filter(r => !r.doc.voided).length} 张）`;
      }
      else if (page === 'receipts') { const totals = D.receiptTotals(doc); summary = `${doc.lines.reduce((sum, l) => sum + Number(l.quantity), 0)}件 / ${totals.weight} kg / ¥${money(totals.cents)}`; }
      else summary = `还款 ¥${money(D.cents(doc.repayment))} + 退差 ¥${money(D.cents(doc.discount))} = ¥${money(D.paymentCents(doc))}`;
      const id = escape(doc.id);
      return `<tr class="${doc.voided ? 'material-void' : ''}"><td>${escape(doc.date)}</td><td>${escape(supplierName(doc.supplierId))}</td><td>${escape(summary)}</td><td>${doc.voided ? '已作废' : '有效'}</td><td>${escape(doc.note)}</td><td><button data-action="detail" data-id="${id}">查看</button>${doc.voided ? '' : `<button data-action="edit" data-id="${id}">编辑</button><button data-action="void" data-id="${id}">作废</button>`}</td></tr>`;
    }).join('');
    content.innerHTML = `<section class="card material-card document-list"><div class="material-heading"><h2>${titles[page]}</h2><button type="button" class="secondary-button" data-action="new">新增${titles[page]}</button></div><p class="material-muted">共 ${docs.length} 张。作废保留原单据；有效收货参与订货扣减与欠款计算。单价单位：元/kg。</p>${table(['日期', '供应商', '单据摘要', '状态', '备注', '操作'], rows)}</section><section id="material-editor"></section>`;
  }
  function newLine(line = {}) {
    const receipt = page === 'receipts';
    const id = line.id || uid();
    const cells = [];
    if (receipt) cells.push('<label class="field"><span>关联订货单 / 规格（可不关联）</span><select name="orderLink"><option value="">不关联订货单</option></select></label><p class="material-link-note"></p>');
    cells.push(field('材质', 'material', line.material, 'text', 'required maxlength="100"'), field('规格', 'spec', line.spec, 'text', 'required maxlength="200"'), field('件数', 'quantity', line.quantity || '', 'number', 'required min="1" step="1"'));
    if (receipt) cells.push(`<label class="field"><span>各捆重量（kg，最多3位小数；用空格、逗号或换行分隔）</span><textarea name="weights" required rows="3">${escape((line.weights || []).join('\n'))}</textarea></label>`);
    cells.push(field('单价（元/kg）', 'price', line.price ?? '', 'number', 'required min="0" step="0.0001"'));
    if (receipt) cells.push(field('加工进度（人工填写）', 'progress', line.progress, 'text', 'maxlength="500"'), '<p class="material-link-note line-total"></p>');
    else cells.push(field('产品名称', 'product', line.product, 'text', 'maxlength="500"'), field('明细备注', 'lineNote', line.note, 'text', 'maxlength="500"'));
    cells.push('<button type="button" class="secondary-button" data-action="remove-line">移除</button>');
    const html = `<tr class="material-line" data-line-id="${escape(id)}">${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
    const holder = document.createElement('tbody'); holder.innerHTML = html;
    const node = holder.firstElementChild;
    if (receipt) { node.dataset.orderId = line.orderId || ''; node.dataset.orderLineId = line.orderLineId || ''; }
    return node;
  }
  function editDocument(id) {
    if (!confirmDiscard()) return;
    const doc = state[page].find(d => d.id === id);
    if (doc?.voided) throw new Error('已作废单据不能编辑。');
    editingId = doc?.id || null; dirty = false;
    const preferred = state.suppliers.find(s => s.id === byId('material-supplier-filter').value && s.active !== false);
    const supplierId = doc?.supplierId || preferred?.id || state.suppliers.find(s => s.active !== false)?.id || '';
    const entryDate = doc?.date || today();
    const editor = byId('material-editor');
    const payment = page === 'payments';
    const dateLabel = page === 'orders' ? '订料日期' : page === 'receipts' ? '收货日期' : '还款日期';
    const head = `${selectSupplier('supplierId', supplierId)}${field(dateLabel, 'date', entryDate, 'date', 'required')}`;
    const note = field('备注', 'note', doc?.note, 'text', 'maxlength="500"');
    const headers = page === 'receipts' ? ['关联订货单 / 规格', '材质', '规格', '件数', '各捆重量（kg）', '单价（元/kg）', '加工进度（人工填写）', '重量 / 金额', '操作'] : ['材质', '规格', '件数', '单价（元/kg）', '产品名称', '明细备注', '操作'];
    editor.innerHTML = `<form class="document-sheet" id="material-document-form" data-document-type="${page}"><div class="document-tools"><h2>${doc ? '编辑' : '新增'}${titles[page]}</h2><div class="material-actions"><button type="submit" class="secondary-button">保存${titles[page]}</button>${payment ? '' : '<button type="button" class="secondary-button" data-action="add-line">添加材料明细</button>'}<button type="button" class="secondary-button" data-action="cancel">取消</button></div></div>${payment ? `<div class="payment-columns document-head"><div>${head}</div><div>${field('还款金额（元）', 'repayment', doc?.repayment || '0', 'number', 'required min="0" step="0.01"')}${field('退差金额（元）', 'discount', doc?.discount || '0', 'number', 'required min="0" step="0.01"')}<div id="payment-total-label" class="payment-total-label" role="status"></div></div></div><div class="document-note">${note}</div>` : `<div class="document-head document-head-grid">${head}<div class="document-note-wide">${note}</div></div><div class="document-grid-scroll"><table class="document-grid document-edit-grid ${page === 'receipts' ? 'receipt-grid' : 'order-grid'}"><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody id="material-lines"></tbody></table></div>${page === 'receipts' ? '<p class="document-help">各捆重量以kg填写，最多3位小数，用空格、逗号或换行分隔。</p>' : ''}`}<div class="material-totals document-footer" id="material-form-totals" role="status"></div></form>`;
    if (page !== 'payments') {
      (doc?.lines || [{}]).forEach(line => byId('material-lines').append(newLine(line)));
      if (page === 'receipts') updateLinks();
    }
    const form = byId('material-document-form');
    form.addEventListener('input', () => { dirty = true; updateTotals(); });
    form.addEventListener('change', event => {
      dirty = true;
      if (event.target.name === 'supplierId' && page === 'receipts') {
        form.querySelectorAll('.material-line').forEach(row => { row.dataset.orderId = ''; row.dataset.orderLineId = ''; });
        updateLinks();
      }
      if (event.target.name === 'orderLink') {
        const row = event.target.closest('.material-line'), option = event.target.selectedOptions[0];
        row.dataset.orderId = option.dataset.orderId || ''; row.dataset.orderLineId = option.dataset.lineId || '';
        if (row.dataset.orderId) {
          const order = state.orders.find(o => o.id === row.dataset.orderId);
          const line = order.lines.find(l => l.id === row.dataset.orderLineId);
          row.querySelector('[name="material"]').value = line.material;
          row.querySelector('[name="spec"]').value = line.spec;
          row.querySelector('[name="price"]').value = line.price;
        }
        updateLinks();
      }
      updateTotals();
    });
    form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; action(saveDocument); });
    updateTotals(); editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector('select').focus({ preventScroll: true });
  }
  function updateLinks() {
    const form = byId('material-document-form'); if (!form) return;
    const selected = form.elements.supplierId.value;
    let choices = [], remainingCount = 0;
    state.orders.filter(o => !o.voided && o.supplierId === selected).forEach(order => {
      order.lines.forEach(line => {
        let remaining = D.remaining(state, order.id, line.id);
        if (editingId) for (const old of state.receipts.find(r => r.id === editingId)?.lines || []) if (old.orderId === order.id && old.orderLineId === line.id) remaining += Number(old.quantity);
        if (remaining > 0) remainingCount++;
        choices.push({ order, line, remaining });
      });
    });
    form.querySelectorAll('.material-line').forEach(row => {
      const select = row.querySelector('[name="orderLink"]');
      select.innerHTML = '<option value="">不关联订货单</option>' + choices.filter(c => c.remaining > 0 || (c.order.id === row.dataset.orderId && c.line.id === row.dataset.orderLineId)).map((c, index) => `<option value="${index + 1}" data-order-id="${escape(c.order.id)}" data-line-id="${escape(c.line.id)}" ${c.order.id === row.dataset.orderId && c.line.id === row.dataset.orderLineId ? 'selected' : ''}>${escape(c.order.date)} / #${c.order.sequence} / ${escape(c.line.material)} / ${escape(c.line.spec)} / 未收${c.remaining}件 / ${escape(c.line.price)}元/kg</option>`).join('');
      row.querySelector('.material-link-note').textContent = `此供应商有 ${remainingCount} 条可关联的未完成订货明细。保存后按件数扣减；重量用于金额计算。`;
    });
  }
  function readDocument() {
    const form = byId('material-document-form');
    const get = name => form.elements[name].value.trim();
    const doc = { id: editingId || uid(), supplierId: get('supplierId'), date: get('date'), note: get('note') };
    if (page === 'payments') { doc.repayment = get('repayment'); doc.discount = get('discount'); }
    else doc.lines = [...form.querySelectorAll('.material-line')].map(row => {
      const value = name => row.querySelector(`[name="${name}"]`).value.trim();
      const line = { id: row.dataset.lineId, material: value('material'), spec: value('spec'), quantity: Number(value('quantity')), price: value('price') };
      if (page === 'receipts') Object.assign(line, { orderId: row.dataset.orderId || '', orderLineId: row.dataset.orderLineId || '', weights: value('weights').split(/[\s,，;；]+/).filter(Boolean), progress: value('progress') });
      else Object.assign(line, { product: value('product'), note: value('lineNote') });
      return line;
    });
    return doc;
  }
  function updateTotals() {
    const node = byId('material-form-totals'); if (!node) return;
    try {
      const doc = readDocument();
      if (page === 'receipts') {
        const total = D.receiptTotals(doc);
        node.textContent = `总重量 ${total.weight} kg　总金额 ¥${money(total.cents)}（各明细金额四舍五入到分后相加）`;
        byId('material-document-form').querySelectorAll('.material-line').forEach((row, i) => {
          const subtotal = D.receiptTotals({ lines: [doc.lines[i]] });
          row.querySelector('.line-total').textContent = `本明细：${subtotal.weight} kg / ¥${money(subtotal.cents)}`;
        });
      } else if (page === 'payments') {
        const next = D.save(state, 'payments', doc), balance = D.paymentBalance(next, doc.id);
        const total = `合计金额：¥${money(D.paymentCents(doc))}`;
        byId('payment-total-label').textContent = total;
        node.innerHTML = `<span>上期欠款（本笔付款前）：¥${money(balance.beforeCents)}</span><span>本期欠款（本笔付款后）：¥${money(balance.afterCents)}</span>`;
      } else node.textContent = '单价按元/kg记录；订货件数用于核对收货数量。';
    } catch (error) { node.textContent = '待核对：' + error.message; if (byId('payment-total-label')) byId('payment-total-label').textContent = '合计金额：待核对'; }
  }
  async function saveDocument() {
    const doc = readDocument(), key = page;
    state = await store.save(key, doc); dirty = false; editingId = null;
    render(); status(`${titles[key]}已保存。`);
    detail(key, doc.id);
  }
  function renderSuppliers() {
    content.innerHTML = `<section class="card material-card"><div class="material-heading"><h2>供应商资料</h2></div><p class="material-muted">统一维护供应商、期初欠款与联系方式。停用保留历史账目，新增单据只可选择启用的供应商。</p><form id="supplier-search-form"><div class="material-grid">${field('搜索名称、联系人或电话', 'search', supplierQuery.search, 'search', 'maxlength="500"')}<label class="field"><span>使用状态</span><select name="status"><option value="">全部</option><option value="active" ${supplierQuery.status === 'active' ? 'selected' : ''}>启用</option><option value="inactive" ${supplierQuery.status === 'inactive' ? 'selected' : ''}>停用</option></select></label>${field('欠款截至日期', 'date', supplierQuery.date, 'date', 'required')}</div><button type="submit" class="secondary-button">查询 / 更新余额</button></form><p id="supplier-count" class="material-muted" role="status"></p><div id="supplier-list"></div></section>`;
    const form = byId('supplier-search-form');
    form.elements.search.addEventListener('input', () => { supplierQuery.search = form.elements.search.value; renderSupplierRows(); });
    form.elements.status.addEventListener('change', () => { supplierQuery.status = form.elements.status.value; renderSupplierRows(); });
    form.elements.date.addEventListener('input', () => { byId('supplier-count').textContent = '日期已更改，请点击“查询 / 更新余额”。'; byId('supplier-list').replaceChildren(); });
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      action(async () => { await refresh(); supplierQuery = { search: form.elements.search.value, status: form.elements.status.value, date: form.elements.date.value }; renderSupplierRows(); status('供应商余额已更新。'); });
    });
    renderSupplierRows();
  }
  function renderSupplierRows() {
    const needle = supplierQuery.search.trim().toLocaleLowerCase('zh-CN');
    const suppliers = state.suppliers.filter(s => (!supplierQuery.status || (s.active !== false ? 'active' : 'inactive') === supplierQuery.status) && [s.name, s.contact, s.phone].some(v => String(v || '').toLocaleLowerCase('zh-CN').includes(needle)));
    const rows = suppliers.map(s => {
      const balance = D.supplierBalance(state, s.id, supplierQuery.date), id = escape(s.id);
      return `<tr><td>${escape(s.name)}</td><td>${escape(s.contact || '')}</td><td>${escape(s.phone || '')}</td><td>${escape(s.openingDate)}</td><td>${money(D.cents(s.openingAmount, '期初欠款', true))}</td><td>${balance === null ? '未到起算日期' : money(balance)}</td><td>${s.active === false ? '停用' : '启用'}</td><td><div class="supplier-row-actions"><button data-action="supplier-detail" data-id="${id}">详情 / 单据</button><button data-action="supplier-edit" data-id="${id}">编辑</button><button data-action="supplier-toggle" data-id="${id}">${s.active === false ? '启用' : '停用'}</button></div></td></tr>`;
    }).join('');
    byId('supplier-count').textContent = `显示 ${suppliers.length} / ${state.suppliers.length} 家供应商；欠款截至 ${supplierQuery.date}。负数表示预付款余额。`;
    byId('supplier-list').innerHTML = table(['供应商', '联系人', '电话', '期初起算日期', '期初欠款（元）', '截至日期欠款（元）', '状态', '操作'], rows);
  }
  function supplierDetail(id) {
    const s = state.suppliers.find(v => v.id === id); if (!s) throw new Error('供应商不存在。');
    const balance = D.supplierBalance(state, id, supplierQuery.date);
    const rows = [['供应商名称', s.name], ['联系人', s.contact || '未填写'], ['电话', s.phone || '未填写'], ['地址', s.address || '未填写'], ['备注', s.note || '无'], ['状态', s.active === false ? '停用' : '启用'], ['期初起算日期', s.openingDate], ['期初欠款（元）', money(D.cents(s.openingAmount, '期初欠款', true))], [`截至 ${supplierQuery.date} 欠款（元）`, balance === null ? '未到起算日期' : money(balance)]];
    const buttons = ['orders', 'receipts', 'payments', 'statement'].map(key => {
      const count = key === 'statement' ? '' : `（${state[key].filter(d => d.supplierId === id).length}张，含作废）`;
      return `<button type="button" class="secondary-button" data-supplier-jump="${key}" data-id="${escape(id)}">${titles[key]}${count}</button>`;
    }).join('');
    dialog.innerHTML = `<h2>供应商详情</h2><dl class="data-grid">${rows.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><h3>关联业务</h3><div class="material-actions">${buttons}</div><p class="material-muted">跳转后自动按该供应商筛选。停用不改变历史单据或欠款。</p><button type="button" class="secondary-button" data-close-dialog>关闭</button>`;
    dialog.showModal();
  }
  function supplierDialog(id) {
    const supplier = state.suppliers.find(s => s.id === id);
    dialog.innerHTML = `<h2>${supplier ? '维护' : '新增'}供应商与期初欠款</h2><p class="material-muted">期初欠款为起算日开始前的余额；该日及之后的单据另行累计。欠款填正数，预付款余额可填负数。修改期初会重新核算该供应商账目。</p><form id="material-supplier-form"><div class="material-grid">${field('供应商名称', 'name', supplier?.name, 'text', 'required maxlength="100"')}${field('期初起算日期', 'openingDate', supplier?.openingDate || today(), 'date', 'required')}${field('期初欠款（元）', 'openingAmount', supplier?.openingAmount ?? '0', 'number', 'required step="0.01"')}</div><p class="material-error" role="alert"></p><div class="material-actions"><button type="submit" class="secondary-button">保存供应商</button><button type="button" class="secondary-button" data-close-dialog>取消</button></div></form>`;
    dialog.querySelector('.material-grid').insertAdjacentHTML('beforeend', `${field('联系人（选填）', 'contact', supplier?.contact, 'text', 'maxlength="500"')}${field('电话（选填）', 'phone', supplier?.phone, 'tel', 'maxlength="500"')}${field('地址（选填）', 'address', supplier?.address, 'text', 'maxlength="500"')}${field('备注（选填）', 'note', supplier?.note, 'text', 'maxlength="500"')}`);
    dialog.showModal();
    byId('material-supplier-form').addEventListener('submit', event => {
      event.preventDefault(); const form = event.target;
      if (!form.reportValidity()) return;
      action(async () => {
        const doc = { ...supplier, id: supplier?.id || uid(), name: form.elements.name.value.trim(), openingDate: form.elements.openingDate.value, openingAmount: form.elements.openingAmount.value, active: supplier?.active !== false };
        for (const name of ['contact', 'phone', 'address', 'note']) doc[name] = form.elements[name].value.trim();
        if (supplier && (supplier.openingDate !== doc.openingDate || supplier.openingAmount !== doc.openingAmount) && !global.confirm('修改期初起算日期或欠款将重新计算该供应商余额，确定保存吗？')) return;
        state = await store.save('suppliers', doc); updateFilter();
        byId('material-supplier-filter').value = doc.id;
        dialog.close(); render(); status('供应商与期初欠款已保存。');
      });
    });
  }
  function detail(key, id, returnOrderId = '') {
    const doc = state[key].find(d => d.id === id); if (!doc) throw new Error('单据不存在。');
    const readFields = fields => `<dl class="document-meta">${fields.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
    const metadata = [['供应商', supplierName(doc.supplierId)], [key === 'orders' ? '订料日期' : key === 'receipts' ? '收货日期' : '还款日期', doc.date], ['单据编号', `#${doc.sequence}`], ['状态', doc.voided ? '已作废' : '有效']];
    let body = `<div class="document-head">${readFields(metadata)}<p class="document-read-note">备注：${escape(doc.note || '无')}</p></div>`;
    if (key === 'payments') {
      body = `<div class="payment-columns document-head">${readFields(metadata)}${readFields([['还款金额（元）', money(D.cents(doc.repayment))], ['退差金额（元）', money(D.cents(doc.discount))], ['合计金额（元）', money(D.paymentCents(doc))]])}</div><div class="document-note document-read-note">备注：${escape(doc.note || '无')}</div>`;
      if (!doc.voided) { const b = D.paymentBalance(state, id); body += `<div class="material-totals document-footer"><span>上期欠款（本笔付款前）：¥${money(b.beforeCents)}</span><span>本期欠款（本笔付款后）：¥${money(b.afterCents)}</span></div><p class="document-help">按日期、同日录入顺序计算。编辑或补录更早单据后，余额自动重新核算。</p>`; }
    } else {
      const headers = key === 'orders' ? ['材质', '规格', '件数', '单价（元/kg）', '产品名称', '已收 / 结欠件数', '备注'] : ['材质', '规格', '件数', '各捆重量（kg）', '总重量（kg）', '单价（元/kg）', '金额（元）', '加工进度', '关联订货'];
      const rows = doc.lines.map(line => {
        let values;
        if (key === 'orders') { const remaining = D.remaining(state, id, line.id); values = [line.material, line.spec, line.quantity, line.price, line.product || '', `${Number(line.quantity) - remaining} / ${remaining}`, line.note || '']; }
        else { const total = D.receiptTotals({ lines: [line] }); const order = state.orders.find(o => o.id === line.orderId); values = [line.material, line.spec, line.quantity, line.weights.join(' + '), total.weight, line.price, money(total.cents), line.progress || '', order ? `${order.date} / #${order.sequence} / ${line.spec}` : '未关联']; }
        return `<tr>${values.map(v => `<td>${escape(v)}</td>`).join('')}</tr>`;
      }).join('');
      body += table(headers, rows);
      if (key === 'orders') {
        const linked = D.relatedReceipts(state, id);
        const receiptRows = linked.map(row => {
          const values = [`#${row.doc.sequence}`, row.doc.date, row.lines.map(l => `${l.material} / ${l.spec}（${l.quantity}件）`).join('；'), row.quantity, row.weight, money(row.cents), row.doc.voided ? '已作废，不计入已收件数' : '有效'];
          return `<tr class="${row.doc.voided ? 'material-void' : ''}">${values.map(v => `<td>${escape(v)}</td>`).join('')}<td><button type="button" class="secondary-button" data-related-receipt="${escape(row.doc.id)}" data-return-order="${escape(id)}">查看详情</button></td></tr>`;
        }).join('');
        body += `<section id="order-related-receipts"><h3>关联材料收货单（${linked.length}张）</h3><p class="material-muted">件数、重量及金额仅统计本订货单关联明细；查看详情可查看整张收货单。作废单据保留供查询。</p>${linked.length ? table(['收货单编号', '收货日期', '关联材质 / 规格', '关联件数', '关联重量（kg）', '关联金额（元）', '状态', '操作'], receiptRows) : '<p class="material-muted">暂无关联收货单。</p>'}</section>`;
      }
      if (key === 'receipts') { const totals = D.receiptTotals(doc); body += `<div class="material-totals document-footer"><span>总重量 ${totals.weight} kg</span><strong>总金额 ¥${money(totals.cents)}</strong></div>`; }
    }
    dialog.innerHTML = `<section class="document-sheet document-detail-sheet" data-document-type="${key}"><div class="document-tools"><h2>${titles[key]}</h2><div class="material-actions">${returnOrderId ? `<button type="button" class="secondary-button" data-return-order-detail="${escape(returnOrderId)}">返回订货单</button>` : ''}<button type="button" class="secondary-button" data-print-detail>打印单据</button><button type="button" class="secondary-button" data-close-dialog>关闭</button></div></div><div id="material-detail-body">${body}</div></section>`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function renderStatement() {
    const selected = byId('material-supplier-filter').value;
    if (selected && selected !== query.supplierId) { query.supplierId = selected; query.start = state.suppliers.find(s => s.id === selected)?.openingDate || ''; }
    content.innerHTML = `<section class="document-sheet" data-document-type="statement"><form id="material-statement-form"><div class="document-tools"><h2>供应商材料对账</h2><div class="material-actions"><button type="submit" class="secondary-button">查询对账单</button><button type="button" class="secondary-button" data-action="export-statement">导出对账 CSV</button><button type="button" class="secondary-button" data-action="print-statement">打印对账单</button></div></div><div class="document-head document-head-grid">${selectSupplier('supplierId', query.supplierId, true)}${field('开始日期', 'start', query.start || today(), 'date', 'required')}${field('结束日期', 'end', query.end, 'date', 'required')}</div></form><p class="document-help">查询范围之前的有效单据计入期初余额。同日单据按录入顺序排列；作废单据不计入账目。</p><div id="material-statement-result"></div></section>`;
    const form = byId('material-statement-form');
    form.elements.supplierId.addEventListener('change', () => {
      const s = state.suppliers.find(s => s.id === form.elements.supplierId.value);
      if (s) form.elements.start.value = s.openingDate;
      byId('material-statement-result').replaceChildren();
    });
    form.addEventListener('input', () => byId('material-statement-result').replaceChildren());
    form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) action(async () => { await refresh(); showStatement(); }); });
  }
  function report() {
    const form = byId('material-statement-form');
    query = { supplierId: form.elements.supplierId.value, start: form.elements.start.value, end: form.elements.end.value };
    return D.statement(state, query.supplierId, query.start, query.end);
  }
  function showStatement() {
    const result = report();
    const rows = result.rows.map(r => `<tr><td>${escape(r.doc.date)}</td><td>${titles[r.type]}</td><td><button data-action="statement-detail" data-type="${r.type}" data-id="${escape(r.doc.id)}">查看 #${r.doc.sequence}</button></td><td>${r.type === 'receipts' ? money(r.increaseCents) : ''}</td><td>${r.type === 'payments' ? money(r.decreaseCents) : ''}</td><td>${money(r.balanceCents)}</td><td>${escape(r.doc.note)}</td></tr>`).join('');
    byId('material-statement-result').innerHTML = `<h3 class="document-report-heading">${escape(supplierName(query.supplierId))} · ${escape(query.start)} 至 ${escape(query.end)}</h3>${table(['日期', '单据类型', '单据详情', '增加金额（元）', '减少金额（元）', '累计欠款（元）', '备注'], rows)}<div class="material-totals document-footer"><span>期初欠款 ¥${money(result.openingCents)}</span><span>增加 ¥${money(result.rows.reduce((s, r) => s + r.increaseCents, 0))}</span><span>减少 ¥${money(result.rows.reduce((s, r) => s + r.decreaseCents, 0))}</span><strong>期末欠款 ¥${money(result.closingCents)}</strong></div>`;
    status('对账查询完成。'); return result;
  }
  function print(html, title) {
    byId('print-area').innerHTML = `<article class="document-print"><h1>${escape(title)}</h1>${html}</article>`;
    if (dialog.open) dialog.close();
    global.print();
  }
  content.addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const name = button.dataset.action, id = button.dataset.id;
    if (busy) return;
    if (name.startsWith('supplier-')) {
      if (name === 'supplier-edit') supplierDialog(id);
      else if (name === 'supplier-detail') supplierDetail(id);
      else if (name === 'supplier-toggle') action(async () => {
        await refresh();
        const supplier = state.suppliers.find(s => s.id === id); if (!supplier) throw new Error('供应商不存在。');
        const active = supplier.active === false;
        if (!global.confirm(`${active ? '启用' : '停用'}供应商“${supplier.name}”？${active ? '启用后可用于新增单据。' : '停用后不能新增单据，历史单据和欠款保留。'}`)) return;
        state = await store.save('suppliers', { ...supplier, active }); updateFilter(); render(); status(`供应商已${active ? '启用' : '停用'}。`);
      });
      return;
    }
    if (name === 'new' || name === 'edit') {
      if (name === 'new' && !state.suppliers.some(s => s.active !== false)) { status('请到“供应商管理 → 供应商资料”新增或启用供应商，并填写期初欠款及起算日期。', true); return; }
      try { editDocument(name === 'edit' ? id : null); } catch (error) { status(error.message, true); }
    } else if (name === 'cancel') { if (confirmDiscard()) { dirty = false; editingId = null; byId('material-editor').replaceChildren(); } }
    else if (name === 'add-line') { byId('material-lines').append(newLine()); dirty = true; if (page === 'receipts') updateLinks(); updateTotals(); }
    else if (name === 'remove-line') {
      const rows = content.querySelectorAll('.material-line');
      if (rows.length <= 1) { status('每张单据至少保留一条明细。', true); return; }
      button.closest('.material-line').remove(); dirty = true; updateTotals();
    } else if (name === 'void') action(async () => {
      if (!confirmDiscard() || !global.confirm('确定作废此单据吗？将重新核算关联订货件数与供应商欠款，原单据保留。')) return;
      state = await store.voidDocument(page, id); dirty = false; editingId = null; render(); status('单据已作废，关联件数和欠款已重新核算。');
    });
    else if (name === 'detail' || name === 'statement-detail') { try { detail(name === 'detail' ? page : button.dataset.type, id); } catch (error) { status(error.message, true); } }
    else if (name === 'export-statement' || name === 'print-statement') action(async () => {
      await refresh(); const result = showStatement();
      if (name === 'print-statement') { print(byId('material-statement-result').innerHTML, '材料对账单'); return; }
      const cells = v => { let text = String(v ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
      const data = [
        ['供应商', supplierName(query.supplierId), '开始日期', query.start, '结束日期', query.end],
        ['期初欠款（元）', money(result.openingCents)],
        ['日期', '单据类型', '单据编号', '增加金额（元）', '减少金额（元）', '累计欠款（元）', '备注'],
        ...result.rows.map(r => [r.doc.date, titles[r.type], r.doc.sequence, r.type === 'receipts' ? (r.increaseCents / 100).toFixed(2) : '', r.type === 'payments' ? (r.decreaseCents / 100).toFixed(2) : '', (r.balanceCents / 100).toFixed(2), r.doc.note]),
        ['期末欠款（元）', money(result.closingCents)]
      ];
      download('\uFEFF' + data.map(row => row.map(cells).join(',')).join('\r\n'), `材料对账单_${query.start}_${query.end}.csv`, 'text/csv;charset=utf-8');
    });
  });
  dialog.addEventListener('click', event => {
    const receipt = event.target.closest('[data-related-receipt]');
    const back = event.target.closest('[data-return-order-detail]');
    if ((receipt || back) && !busy) {
      try {
        if (receipt) detail('receipts', receipt.dataset.relatedReceipt, receipt.dataset.returnOrder);
        else detail('orders', back.dataset.returnOrderDetail);
      } catch (error) { dialog.close(); status(error.message, true); }
      return;
    }
    const jump = event.target.closest('[data-supplier-jump]');
    if (jump && !busy) {
      dialog.close(); byId('material-supplier-filter').value = jump.dataset.id;
      if (jump.dataset.supplierJump === 'statement') {
        const supplier = state.suppliers.find(s => s.id === jump.dataset.id);
        query = { supplierId: supplier.id, start: supplier.openingDate, end: supplierQuery.date < supplier.openingDate ? supplier.openingDate : supplierQuery.date };
      }
      choosePage(jump.dataset.supplierJump);
      if (page === 'statement') { try { showStatement(); } catch (error) { status(error.message, true); } }
    }
    if (event.target.closest('[data-close-dialog]') && !busy) dialog.close();
    if (event.target.closest('[data-print-detail]')) print(byId('material-detail-body').innerHTML, dialog.querySelector('h2').textContent);
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  document.querySelectorAll('[data-material-page]').forEach(b => b.addEventListener('click', () => choosePage(b.dataset.materialPage)));
  function expandNavigation(id) {
    const button = document.querySelector(`.sidebar-group[aria-controls="${id}"]`);
    byId(id).hidden = false; button.setAttribute('aria-expanded', 'true'); button.querySelector('span').textContent = '▾';
  }
  document.querySelectorAll('.sidebar-group').forEach(button => button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    byId(button.getAttribute('aria-controls')).hidden = !expanded;
    button.querySelector('span').textContent = expanded ? '▾' : '▸';
  }));
  byId('open-calculator').addEventListener('click', () => {
    if (busy || !confirmDiscard()) return;
    dirty = false; editingId = null;
    byId('calculator-module').hidden = false; byId('material-view').hidden = true;
    byId('page-title').textContent = '数据计算'; byId('page-section').textContent = '数据管理 / 数据计算';
    expandNavigation('data-navigation');
    document.querySelectorAll('.sidebar-link').forEach(b => {
      const active = b.id === 'open-calculator'; b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  });
  byId('material-supplier-filter').addEventListener('change', () => {
    if (!confirmDiscard()) { byId('material-supplier-filter').value = content.querySelector('[name="supplierId"]')?.value || ''; return; }
    dirty = false; editingId = null; render();
  });
  byId('material-add-supplier').addEventListener('click', () => { if (ready && !busy && confirmDiscard()) { dirty = false; editingId = null; render(); supplierDialog(); } });
  byId('material-refresh').addEventListener('click', () => action(async () => {
    if (!confirmDiscard()) return;
    await refresh(); dirty = false; editingId = null; render(); status('已刷新材料数据。');
  }));
  byId('material-backup').addEventListener('click', () => action(async () => {
    download(JSON.stringify(await store.backup(), null, 2), `材料管理备份_${today()}.json`); status('已导出材料管理备份，包含供应商、期初欠款及全部单据。');
  }));
  byId('material-restore').addEventListener('change', event => action(async () => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('材料备份不能超过20 MB。');
      const backup = JSON.parse(await file.text());
      D.merge(state, backup);
      if (!confirmDiscard() || !global.confirm('确定合并恢复材料备份吗？相同记录跳过；同编号内容冲突或关联不合法时整体取消。请先备份现有数据。')) return;
      state = await store.restore(backup); updateFilter(); dirty = false; editingId = null; render(); status('材料备份已合并恢复。');
    } finally { event.target.value = ''; }
  }));
  global.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  global.MaterialUI = Object.freeze({ refresh, choosePage });
  action(async () => { await refresh(); render(); });
})(window);
