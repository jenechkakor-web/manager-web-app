(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = value => new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB' }).format(value);
  const columns = [
    { id:'date', label:'Дата транзакции', width:175, date:true, value:entry => entry.date || null },
    { id:'number', label:'Номер сделки', width:150, value:entry => entry.number || null },
    { id:'title', label:'Название сделки', width:220, value:entry => entry.title },
    { id:'counterparty', label:'Контрагент', width:220, value:entry => entry.counterparty || null },
    { id:'dealAmount', label:'Сумма сделки', width:165, numeric:true, value:entry => entry.kind === 'deal' ? entry.dealAmount : null },
    { id:'accrued', label:'Начисленный бонус', width:185, numeric:true, tone:'credit', value:entry => entry.accrued },
    { id:'paid', label:'Выплачено', width:150, numeric:true, tone:'debit', value:entry => entry.paid },
    { id:'reason', label:'Основание', width:210, value:entry => entry.kind === 'deal' ? 'Выплата по сделке' : (entry.reason || null) },
    { id:'manager', label:'Менеджер', width:170, admin:true, value:entry => entry.manager },
  ];
  window.createPayoutTable = (table, auth) => {
    const available = columns.filter(column => !column.admin || auth.isAdmin);
    const byId = new Map(available.map(column => [column.id,column]));
    const storageKey = auth.storageKey('payout-table-layout-v1');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Default layout if storage is unavailable. */ }
    let order = [...new Set([...(Array.isArray(saved.order) ? saved.order : []), ...byId.keys()])].filter(id => byId.has(id));
    if (!Array.isArray(saved.order) || !saved.order.includes('date')) order = ['date', ...order.filter(id => id !== 'date')];
    const widths = Object.fromEntries(available.map(column => [column.id,
      Number.isFinite(saved.widths?.[column.id]) ? Math.max(64, Math.min(10000,saved.widths[column.id])) : column.width]));
    let sort = byId.has(saved.sort?.id) ? { id:saved.sort.id, direction:saved.sort.direction === -1 ? -1 : 1 } : null;
    let entries = [];
    const collator = new Intl.Collator('ru', { numeric:true, sensitivity:'base' });
    const head = table.tHead;
    const body = table.tBodies[0];
    const colgroup = table.querySelector('colgroup');
    const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({order,widths,sort})); } catch { /* Layout remains usable without persistence. */ } };
    const display = (column, entry) => {
      const value = column.value(entry);
      return value == null ? (column.date ? 'Дата не зафиксирована' : '—') : column.date ? value.split('-').reverse().join('.') : column.numeric ? money(value) : String(value);
    };
    function layout() {
      table.style.width = `${order.reduce((sum,id) => sum + widths[id],0)}px`;
      colgroup.querySelectorAll('col').forEach(col => { col.style.width = `${widths[col.dataset.column]}px`; });
    }
    function renderRows() {
      const rows = [...entries];
      if (sort) {
        const column = byId.get(sort.id);
        rows.sort((a,b) => {
          const left = column.value(a), right = column.value(b);
          if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
          return (column.numeric ? left - right : collator.compare(String(left),String(right))) * sort.direction;
        });
      }
      body.innerHTML = rows.map(entry => `<tr>${order.map(id => {
        const column = byId.get(id), text = display(column,entry);
        return `<td data-column="${id}" class="${column.numeric ? 'amount' : ''} ${column.tone || ''}" title="${escape(text)}">${escape(text)}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td class="payout-empty" colspan="${order.length}">За выбранный период нет закрытых сделок с бонусом и операций.</td></tr>`;
    }
    function render() {
      colgroup.innerHTML = order.map(id => `<col data-column="${id}">`).join('');
      head.innerHTML = `<tr>${order.map(id => {
        const column = byId.get(id), active = sort?.id === id;
        return `<th data-column="${id}" scope="col" aria-sort="${active ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="payout-drag" data-drag="${id}" title="Перетащить столбец. С клавиатуры: Alt + стрелки." aria-label="Переместить столбец ${column.label}">⋮⋮</button><button type="button" class="payout-sort" data-sort="${id}" title="Сортировать: ${column.label}"><span>${column.label}</span><span aria-hidden="true">${active ? (sort.direction === 1 ? '↑' : '↓') : '↕'}</span></button><span class="payout-resize" data-resize="${id}" role="separator" aria-orientation="vertical" aria-label="Ширина столбца ${column.label}" tabindex="0" title="Перетащите границу. Двойной клик — автоподбор ширины."></span></th>`;
      }).join('')}</tr>`;
      layout();
      renderRows();
    }
    function autoFit(id) {
      const measurement = document.createElement('span');
      measurement.className = 'payout-measurement';
      document.body.append(measurement);
      const measure = (text, target) => {
        const style = getComputedStyle(target);
        measurement.style.font = style.font;
        measurement.style.letterSpacing = style.letterSpacing;
        measurement.textContent = text;
        return measurement.getBoundingClientRect().width;
      };
      const column = byId.get(id);
      let width = measure(column.label, head.querySelector(`[data-sort="${id}"]`)) + 60;
      const target = body.querySelector(`td[data-column="${id}"]`) || table;
      for (const entry of entries) width = Math.max(width,measure(display(column,entry),target) + 22);
      measurement.remove();
      widths[id] = Math.max(64,Math.ceil(width));
      layout();
      save();
    }
    head.addEventListener('click', event => {
      const button = event.target.closest('[data-sort]');
      if (!button) return;
      sort = {id:button.dataset.sort, direction:sort?.id === button.dataset.sort ? -sort.direction : 1};
      save();
      render();
      head.querySelector(`[data-sort="${sort.id}"]`).focus({preventScroll:true});
    });
    head.addEventListener('dblclick', event => {
      const handle = event.target.closest('[data-resize]');
      if (handle) { event.preventDefault(); autoFit(handle.dataset.resize); }
    });
    head.addEventListener('mousedown', event => {
      const resize = event.target.closest('[data-resize]');
      const drag = event.target.closest('[data-drag]');
      if (event.button !== 0 || (!resize && !drag)) return;
      event.preventDefault();
      if (resize && event.detail >= 2) { autoFit(resize.dataset.resize); return; }
      const source = (resize || drag).closest('th');
      const id = source.dataset.column;
      const startX = event.clientX, startWidth = source.getBoundingClientRect().width;
      let targetId, after = false;
      table.classList.add(resize ? 'is-resizing' : 'is-reordering');
      source.classList.add('is-dragging');
      const clearIndicators = () => head.querySelectorAll('.drop-before,.drop-after').forEach(th => th.classList.remove('drop-before','drop-after'));
      const move = next => {
        if (resize) {
          widths[id] = Math.max(64,startWidth + next.clientX - startX);
          layout();
        } else {
          clearIndicators();
          const target = document.elementFromPoint(next.clientX,next.clientY)?.closest('th[data-column]');
          targetId = null;
          if (!target || !head.contains(target) || target === source || Math.abs(next.clientX-startX) < 4) return;
          targetId = target.dataset.column;
          const rect = target.getBoundingClientRect();
          after = next.clientX > rect.left + rect.width / 2;
          target.classList.add(after ? 'drop-after' : 'drop-before');
        }
      };
      const finish = event => {
        document.removeEventListener('mousemove',move);
        document.removeEventListener('mouseup',finish);
        window.removeEventListener('blur',finish);
        clearIndicators();
        source.classList.remove('is-dragging');
        table.classList.remove('is-resizing','is-reordering');
        if (drag && targetId && event.type !== 'blur') {
          order = order.filter(key => key !== id);
          order.splice(order.indexOf(targetId) + (after ? 1 : 0),0,id);
          render();
        }
        save();
      };
      document.addEventListener('mousemove',move);
      document.addEventListener('mouseup',finish);
      window.addEventListener('blur',finish);
    });
    head.addEventListener('keydown', event => {
      const resize = event.target.closest('[data-resize]'), drag = event.target.closest('[data-drag]');
      if (resize && event.key === 'Enter') { event.preventDefault(); autoFit(resize.dataset.resize); }
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      if (resize) {
        event.preventDefault(); widths[resize.dataset.resize] = Math.max(64,widths[resize.dataset.resize] + delta * 10); layout(); save();
      } else if (drag && event.altKey) {
        event.preventDefault();
        const index = order.indexOf(drag.dataset.drag), next = index + delta;
        if (next < 0 || next >= order.length) return;
        [order[index],order[next]] = [order[next],order[index]];
        save(); render(); head.querySelector(`[data-drag="${drag.dataset.drag}"]`).focus();
      }
    });
    return { render(rows) { entries = rows; render(); } };
  };
})();
