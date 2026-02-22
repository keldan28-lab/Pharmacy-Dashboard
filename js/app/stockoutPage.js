/* Stockout full timeline page (all items) */
(function(){
    'use strict';

    let cachedMockData = null;

    const _num = (v, d=0)=>{
        const n = Number(v);
        return Number.isFinite(n) ? n : d;
    };
    const _clamp = (v, a, b)=> Math.max(a, Math.min(b, v));

    // Simple sublocation map passthrough (if provided by other files)
    function getSublocationMap(){
        return (window.SUBLOCATION_MAP || {});
    }

    const __forecastCache = { stockoutKey:null, stockout:null };

    function _getDailyUsageByCode(md){
        const out = Object.create(null);
        try{
            const agg = (md && md.canonicalDailyUsage) ? md.canonicalDailyUsage : (md && md.dailyUsageByItemCode) ? md.dailyUsageByItemCode : null;
            if (agg && typeof agg === 'object'){
                for (const k of Object.keys(agg)){
                    const v = agg[k];
                    out[String(k)] = _num(v && v.avgDaily != null ? v.avgDaily : v, 0);
                }
                return out;
            }
        }catch(_){}
        // fallback: attempt derive from items
        try{
            const items = Array.isArray(md && md.items) ? md.items : [];
            for (const it of items){
                const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                if (!code) continue;
                out[code] = _num(it.avgDailyUsage ?? it.dailyUsage ?? it.usageRate, 0);
            }
        }catch(_){}
        return out;
    }

    function _getItemDescriptionByCode(md){
        const out = Object.create(null);
        try{
            const items = Array.isArray(md && md.items) ? md.items : [];
            for (const it of items){
                const code = (it && it.itemCode!=null) ? String(it.itemCode).trim() : '';
                if (!code) continue;
                const desc = String(it.description ?? it.drugDescription ?? it.itemDescription ?? it.longDescription ?? it.drugName ?? it.itemName ?? '').trim();
                out[code] = desc || code;
            }
        }catch(_){}
        return out;
    }

    function _stockoutKey(md, bufferDays, horizonDays, limit){
        const inv = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : null;
        const items = Array.isArray(md && md.items) ? md.items : [];
        const invKey = inv ? Object.keys(inv).length : 0;
        const itemsKey = items.length;
        const last = String(md && (md.lastUpdated || md.generatedAt || md.lastComputedAt || ''));
        return `stockout|b=${bufferDays}|h=${horizonDays}|inv=${invKey}|items=${itemsKey}|last=${last}|limit=${String(limit)}`;
    }

    function buildStockOutTimeline(md, bufferDays=14, horizonDays=56, limit=0){
        const key = _stockoutKey(md, bufferDays, horizonDays, limit) + '|score_v2';
        if (__forecastCache.stockoutKey === key && __forecastCache.stockout) return __forecastCache.stockout;

        const inventoryByCode = (md && md.inventory && typeof md.inventory==='object') ? md.inventory : {};
        const dailyUsageByCode = _getDailyUsageByCode(md);
        const descByCode = _getItemDescriptionByCode(md);
        const map = getSublocationMap ? getSublocationMap() : (window.SUBLOCATION_MAP || {});

        const items = [];

        for (const codeRaw of Object.keys(inventoryByCode)){
            const code = String(codeRaw);
            const invEntry = inventoryByCode[codeRaw] || {};
            const subs = Array.isArray(invEntry.sublocations) ? invEntry.sublocations : [];
            if (!subs.length) continue;

            const dailyUsage = dailyUsageByCode[code] || 0;
            if (dailyUsage <= 0) continue;

            // Exclude PHARMACY department if available
            const dep = String(invEntry.department ?? invEntry.dept ?? '').toUpperCase();
            if (dep === 'PHARMACY') continue;

            let totalCur = 0;
            for (const s of subs){
                totalCur += _num((s && (s.curQty ?? s.qty)), 0);
            }
            const even = subs.length ? (dailyUsage / subs.length) : dailyUsage;

            const subRows = [];
            for (const s of subs){
                const sub = s || {};
                const sublocCode = String(sub.sublocation ?? sub.location ?? '').trim();
                if (!sublocCode) continue;

                const curQty = _num(sub.curQty ?? sub.qty, 0);
                const minQty = _num(sub.minQty ?? sub.min ?? sub.min_qty ?? 0, 0);
                const standard = !!(sub.standard ?? sub.isStandard ?? false);

                const usageRate = totalCur > 0 ? (dailyUsage * (curQty / totalCur)) : even;
                const stockoutScore = (minQty > 0) ? (usageRate / minQty) : 0;

                // Enrich with location labels if available
                const meta = map && map[sublocCode] ? map[sublocCode] : {};
                const mainLocation = meta.mainLocation ?? meta.location ?? '';

                subRows.push({
                    sublocation: sublocCode,
                    mainLocation: mainLocation,
                    standard,
                    usageRate,
                    minQty,
                    stockoutScore,
                    avgDailyTx: usageRate
                });
            }

            const itemScore = subRows.reduce((m,r)=>Math.max(m,_num(r.stockoutScore,0)),0);
            if (itemScore <= 0) continue;

            items.push({
                itemCode: code,
                description: descByCode[code] || code,
                dailyUsage,
                itemScore,
                sublocationCount: subRows.length,
                sublocations: subRows
            });
        }

        items.sort((a,b)=> (b.itemScore-a.itemScore) || (b.dailyUsage-a.dailyUsage) || (b.sublocationCount-a.sublocationCount));
        const final = (limit && limit > 0) ? items.slice(0, limit) : items;

        let maxScore = 0, minScore = Infinity;
        for (const it of final){
            for (const r of it.sublocations){
                const sc = _num(r.stockoutScore,0);
                if (sc > maxScore) maxScore = sc;
                if (sc < minScore) minScore = sc;
            }
        }
        if (!Number.isFinite(minScore)) minScore = 0;

        const out = { items: final, scoreRange: { min: minScore, max: maxScore } };
        __forecastCache.stockoutKey = key;
        __forecastCache.stockout = out;
        return out;
    }

    function renderStockoutFull(md){
        const wrap = document.getElementById('stockoutFullTimeline');
        if (!wrap) return;

        const search = String((document.getElementById('stockoutSearch')?.value) || '').trim().toLowerCase();

        const data = buildStockOutTimeline(md, 14, 56, 0);
        const raw = Array.isArray(data && data.items) ? data.items : [];
        const items = raw.filter(it => {
            const segs = Array.isArray(it && it.sublocations) ? it.sublocations : [];
            const maxSc = segs.reduce((m,r)=>Math.max(m,_num(r.stockoutScore,0)),0);
            if (maxSc <= 1) return false;
            if (!search) return true;
            return String(it.description || '').toLowerCase().includes(search) || String(it.itemCode||'').includes(search);
        });

        const kpi = document.getElementById('stockoutFullCount');
        if (kpi) kpi.textContent = String(items.length);

        wrap.innerHTML = '';
        if (!items.length){
            const empty = document.createElement('div');
            empty.className = 'pyxis-metrics-empty';
            empty.textContent = 'No matching items.';
            wrap.appendChild(empty);
            return;
        }

        // Render using the same renderer from analytics if available; otherwise lightweight list
        // For now: simple list of rows + segment track using absolute positioning based on score.
        const sMin = Math.min(0, Math.floor(_num(data.scoreRange?.min,0)));
        const sMax = Math.max(1, Math.ceil(_num(data.scoreRange?.max,1)));

        const scoreToPct = (sc)=>{
            const den = (sMax - sMin) || 1;
            const t = _clamp((sMax - sc) / den, 0, 1);
            return t * 100;
        };

        items.forEach(it=>{
            const row = document.createElement('div');
            row.className = 'stockout-gantt-row';

            const left = document.createElement('div');
            left.className = 'stockout-gantt-label';
            left.textContent = it.description || it.itemCode;

            const track = document.createElement('div');
            track.className = 'stockout-gantt-track';
            track.style.position = 'relative';

            const segWpx = 110;
            const subs = Array.isArray(it.sublocations) ? it.sublocations : [];
            subs.forEach(r=>{
                const sc = _num(r.stockoutScore,0);
                if (sc <= 1) return;
                const seg = document.createElement('div');
                seg.className = 'stockout-gantt-seg ' + (r.standard ? 'seg-standard' : 'seg-nonstandard');
                seg.style.left = scoreToPct(sc) + '%';
                seg.style.width = segWpx + 'px';

                const lbl = document.createElement('div');
                lbl.className = 'stockout-gantt-seg-label';
                lbl.textContent = String(r.sublocation||'').toUpperCase();
                seg.appendChild(lbl);

                seg.addEventListener('click', (e)=>{
                    try{ e.stopPropagation(); }catch(_){}
                    if (window.parent){
                        window.parent.postMessage({
                            type: 'navigateToFlowFromStockoutSegment',
                            itemCode: String(it.itemCode||''),
                            sublocation: String(r.sublocation||''),
                            avgDailyTx: _num(r.avgDailyTx, 0)
                        }, '*');
                    }
                });

                track.appendChild(seg);
            });

            row.appendChild(left);
            row.appendChild(track);
            wrap.appendChild(row);
        });
    }

    function requestMockDataFromParent(){
        return new Promise((resolve,reject)=>{
            if (cachedMockData){ resolve(cachedMockData); return; }
            const reqId = 'stockout_' + Math.random().toString(36).slice(2);
            const onMsg = (e)=>{
                const d = e && e.data ? e.data : {};
                if (d.type === 'mockDataResponse' && d.reqId === reqId){
                    window.removeEventListener('message', onMsg);
                    cachedMockData = d.mockData || d.data || null;
                    resolve(cachedMockData);
                }
            };
            window.addEventListener('message', onMsg);
            if (window.parent){
                window.parent.postMessage({ type:'requestMockData', reqId }, '*');
                setTimeout(()=>{ reject(new Error('mock data timeout')); }, 2500);
            }else{
                reject(new Error('no parent'));
            }
        });
    }

    // Dark mode propagation
    window.addEventListener('message', (event)=>{
        const d = event && event.data ? event.data : {};
        if (d.type === 'applyDarkMode'){
            document.body.classList.toggle('dark-mode', !!d.isDarkMode);
        }
    });

    function boot(){
        requestMockDataFromParent().then((md)=>{
            renderStockoutFull(md);
        }).catch(()=>{});
    }

    document.addEventListener('input', (e)=>{
        if (e.target && e.target.id === 'stockoutSearch'){
            if (cachedMockData) renderStockoutFull(cachedMockData);
        }
    });

    document.addEventListener('DOMContentLoaded', boot);
})();
