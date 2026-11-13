/* Render the selected matrix from the counts already loaded for the current view. */
(function () {
  'use strict';

  const sortOrders = new Map();
  const kinds = {provider: '三方', merchant: '商户'};
  const directions = {charge: '代收', withdraw: '代付'};
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => (
    {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]
  ));

  function hasCounts(fact) {
    return fact && Number.isSafeInteger(fact.successCount) && fact.successCount >= 0 &&
      Number.isSafeInteger(fact.totalCount) && fact.totalCount >= 0;
  }

  function rateOf(fact) {
    return hasCounts(fact) && fact.totalCount > 0 ? fact.successCount / fact.totalCount : null;
  }

  function compareRank(a, b, descending) {
    if (a.rate === null || b.rate === null) {
      if (a.rate !== b.rate) return a.rate === null ? 1 : -1;
    } else if (a.rate !== b.rate) {
      return descending ? b.rate - a.rate : a.rate - b.rate;
    }
    return a.index - b.index;
  }

  function rateCell(fact, partial, total = false) {
    const rate = rateOf(fact);
    const note = hasCounts(fact)
      ? '成功 ' + fact.successCount.toLocaleString('zh-CN') + ' 笔 / 创建 ' + fact.totalCount.toLocaleString('zh-CN') + ' 笔'
      : '尚无可核验的笔数';
    const subtotal = rate !== null && (fact.partial ?? partial);
    const label = rate === null ? '—' : (100 * rate).toFixed(2) + '%';
    return '<td class="success-rate-cell' + (total ? ' success-total-rate' : '') + '" title="' +
      escape(note + (subtotal ? '（已读小计）' : '')) + '"><span' +
      (rate !== null && rate < 0.4 ? ' class="success-rate-low"' : '') + '>' + label +
      (subtotal ? '<sup aria-label="部分来源">*</sup>' : '') + '</span>' +
      (total && subtotal ? '<small class="success-total-partial">已读小计</small>' : '') + '</td>';
  }

  function typeCell(type) {
    const label = typeof type === 'string' ? type : type?.label;
    if (!label) return '<td class="success-provider-type">—</td>';
    return '<td class="success-provider-type"><span class="provider-business-type" title="' +
      escape(type.detail || label) + '">' + escape(label) + '</span></td>';
  }

  function sortLabel(descending) {
    return '总成功率，当前' + (descending ? '降序，切换为升序' : '升序，切换为降序');
  }

  function sortHeading(descending) {
    return '<th scope="col" class="success-total-rate" aria-sort="' + (descending ? 'descending' : 'ascending') +
      '"><button type="button" class="band-success-sort" onclick="HensemBandSuccessMatricesUI.toggleSort(this)" aria-label="' +
      sortLabel(descending) + '">总成功率 <span aria-hidden="true">' + (descending ? '↓' : '↑') + '</span></button></th>';
  }

  function renderMatrix(matrix, kind, direction, page) {
    const columns = matrix.columns;
    const withType = kind === 'provider';
    const sortKey = page + '/' + direction + '/' + kind;
    const descending = sortOrders.get(sortKey) !== 'ascending';
    const dimension = page === 'amount' ? '分金额段' : '分时';
    const title = directions[direction] + ' · ' + kinds[kind] + dimension + '成功率';
    const ranked = matrix.rows.map((row, index) => ({row, index, rate: rateOf(row.total)}));
    ranked.sort((a, b) => compareRank(a, b, descending));
    const body = ranked.map(({row, index, rate}) => {
      const partial = row.partial ?? matrix.partial;
      return '<tr data-order="' + index + '" data-rate="' + (rate ?? '') + '"><th scope="row" title="' +
        escape(row.name) + '">' + escape(row.name) + '</th>' + (withType ? typeCell(row.type) : '') +
        columns.map(col => rateCell(row.cells[col.key], false)).join('') + rateCell(row.total, partial, true) + '</tr>';
    }).join('');
    const notice = matrix.note || (matrix.partial ? '部分来源尚未读齐，已读小计以 * 标示。' : '');
    const empty = '<tr><td class="band-success-empty" colspan="' + (columns.length + (withType ? 3 : 2)) + '">' +
      (matrix.partial ? '暂无可核验的' + dimension + '数据' : '所选范围没有' + kinds[kind] + dimension + '数据') + '</td></tr>';
    const manual = matrix.excluded?.manual || [], unidentified = matrix.excluded?.unidentified || [];
    const excluded = kind === 'provider' && (manual.length || unidentified.length)
      ? '<details class="success-analysis-other"><summary>商户汇总另含 ' + (manual.length + unidentified.length) +
        ' 个分组</summary>' + (manual.length ? '<p>非三方业务（' + manual.length + '）：' + manual.map(escape).join('、') + '</p>' : '') +
        (unidentified.length ? '<p>三方归属待确认（' + unidentified.length + '）：' + unidentified.map(escape).join('、') + '</p>' : '') + '</details>' : '';
    return '<section class="success-analysis-panel" data-band-matrix="' + sortKey + '"><div class="success-analysis-heading"><h2>' +
      title + '</h2></div>' + (notice ? '<p role="status">' + escape(notice) + '</p>' : '') +
      '<div class="success-analysis-scroll band-success-scroll" tabindex="0" role="region" aria-label="' + title +
      '"><table style="min-width:' + ((withType ? 288 : 208) + columns.length * 78) + 'px"><thead><tr><th scope="col">' +
      kinds[kind] + '</th>' + (withType ? '<th scope="col" class="success-provider-type">类型</th>' : '') +
      columns.map(col => '<th scope="col" class="band-success-slot">' + escape(col.label) + '</th>').join('') +
      sortHeading(descending) + '</tr></thead><tbody>' + (body || empty) + '</tbody></table></div>' + excluded + '</section>';
  }

  function render(model, page, kind) {
    if (!model || !Object.hasOwn(kinds, kind) || !Object.hasOwn(directions, model.direction) || (page !== 'time' && page !== 'amount')) return '';
    return '<div class="live-success-analysis band-success-matrices">' +
      renderMatrix(model[kind], kind, model.direction, page) + '</div>';
  }

  function toggleSort(button) {
    const table = button.closest('table');
    const heading = button.closest('th');
    const section = table.closest('[data-band-matrix]');
    const descending = heading.getAttribute('aria-sort') !== 'descending';
    const order = descending ? 'descending' : 'ascending';
    sortOrders.set(section.dataset.bandMatrix, order);
    heading.setAttribute('aria-sort', order);
    button.setAttribute('aria-label', sortLabel(descending));
    button.querySelector('span').textContent = descending ? '↓' : '↑';
    const body = table.tBodies[0];
    const ranked = Array.from(body.querySelectorAll('tr[data-order]'), element => ({
      element, index: Number(element.dataset.order),
      rate: element.dataset.rate === '' ? null : Number(element.dataset.rate)
    }));
    ranked.sort((a, b) => compareRank(a, b, descending));
    for (const {element} of ranked) body.appendChild(element);
  }

  window.HensemBandSuccessMatricesUI = Object.freeze({render, toggleSort});
})();
