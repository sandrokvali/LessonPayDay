const DB_URL = 'https://paydate-for-lessons-default-rtdb.europe-west1.firebasedatabase.app/.json';

let data = { schedules: {}, exceptions: {} };
const FIXED_RATE = 8;
const PAY_SUBJECTS = ['English', 'Chemistry'];
let payDaysMap = {}; 
let showAllMonthsMobile = false;
function pushData() {
    $.ajax({ url: DB_URL, type: 'PUT', data: JSON.stringify(data), success: () => fetchData() });
}

function subjVar(subject) {
    if(!subject) return 'eng';
    const s = subject.toLowerCase();
    if(s.startsWith('chem')) return 'chem';
    return s.substring(0,3);
}

function isPaidMobile(dateStr, subject) {
    return data.exceptions && data.exceptions[`PAID_${dateStr}_${subject}`] === 'paid';
}

function unmarkPaidMobile(dateStr, subject) {
    const key = `PAID_${dateStr}_${subject}`;
    if(data.exceptions && data.exceptions[key]) {
        delete data.exceptions[key];
        // optimistic UI update
        renderCalendar();
        if($('#summaryModal').is(':visible')) openPaySummary();
        if($('#dayModal').is(':visible')) openDay(dateStr);
        // persist change
        pushData();
    }
}

$(document).ready(() => { fetchData(); });

function fetchData() {
    $.get(DB_URL, (body) => {
        data = body || { schedules: {}, exceptions: {} };
        if(!data.schedules) data.schedules = {};
        if(!data.exceptions) data.exceptions = {};
        renderCalendar();
    });
}

function expandSchedules() {
    let list = [];
    if (data.schedules) {
        Object.keys(data.schedules).forEach(sid => {
            const s = data.schedules[sid];
            let d = new Date(s.startDate);
            const end = s.endDate ? new Date(s.endDate) : null;
            const timeStr = s.time || '';
            const [hhRaw, mmRaw] = timeStr.split(':');
            const hh = Number(hhRaw);
            const mm = Number(mmRaw);
            const timeMinutes = Number.isFinite(hh) && Number.isFinite(mm) ? (hh * 60 + mm) : Number.MAX_SAFE_INTEGER;
            while(d.getFullYear() <= 2026) {
                if(end && d > end) break;
                const dateStr = d.toDateString();
                const key = `SCHED_${sid}_${dateStr}`;
                const legacyKey = `${dateStr}_${s.subject}`;
                if(data.exceptions && data.exceptions[key] !== 'deleted' && data.exceptions[legacyKey] !== 'deleted') {
                    list.push({ sid, subject: s.subject, date: new Date(d), time: timeStr, timeMinutes });
                }
                d.setDate(d.getDate() + 7);
            }
        });
    }
    if (data.exceptions) {
        Object.keys(data.exceptions).forEach(key => {
            if(key.includes("SINGLE_") && data.exceptions[key] !== 'deleted') {
                const parts = key.split('_');
                list.push({ sid: 'one-off', subject: parts[2], date: new Date(parts[1]), time: '', timeMinutes: Number.MAX_SAFE_INTEGER });
            }
        });
    }
    return list.sort((a, b) => {
        const dateDiff = a.date - b.date;
        if(dateDiff !== 0) return dateDiff;
        const timeDiff = a.timeMinutes - b.timeMinutes;
        if(timeDiff !== 0) return timeDiff;
        return String(a.subject).localeCompare(String(b.subject));
    });
}

function renderCalendar() {
    const container = $('#calendarContainer').empty();
    const all = expandSchedules();
    const now = new Date();

    let counters = { English: 0, Chemistry: 0 };
    payDaysMap = {};
    all.forEach(occ => {
        if (PAY_SUBJECTS.includes(occ.subject)) {
            counters[occ.subject]++;
            if(counters[occ.subject] % FIXED_RATE === 0) {
                const dKey = occ.date.toDateString();
                if(!payDaysMap[dKey]) payDaysMap[dKey] = [];
                if(!payDaysMap[dKey].includes(occ.subject)) payDaysMap[dKey].push(occ.subject);
            }
        }
    });

    // Add Georgian fixed monthly paydate on the 27th of every month
    for (let mi = 0; mi < 12; mi++) {
        const pd = new Date(now.getFullYear(), mi, 27);
        const pk = pd.toDateString();
        if(!payDaysMap[pk]) payDaysMap[pk] = [];
        if(!payDaysMap[pk].includes('Georgian')) payDaysMap[pk].push('Georgian');
    }

    const startMonth = showAllMonthsMobile ? 0 : now.getMonth();
    for (let i = startMonth; i < 12; i++) {
        let d = new Date(now.getFullYear(), i, 1);
        container.append(buildMonth(d, all));
    }
}

function toggleFullCalendarMobile() {
    showAllMonthsMobile = !showAllMonthsMobile;
    const btn = document.getElementById('toggleCalendarBtnMobile');
    if(btn) btn.textContent = showAllMonthsMobile ? 'Show Current' : 'Show Full';
    renderCalendar();
}

function markPaidMobile(dateStr, subject) {
    const key = `PAID_${dateStr}_${subject}`;
    data.exceptions = data.exceptions || {};
    data.exceptions[key] = 'paid';
    // optimistic UI update
    renderCalendar();
    if($('#summaryModal').is(':visible')) openPaySummary();
    if($('#dayModal').is(':visible')) openDay(dateStr);
    // persist to DB
    pushData();
}

function buildMonth(date, all) {
    const y = date.getFullYear(), m = date.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const mondayFirstOffset = (firstDay + 6) % 7;
    const lastDate = new Date(y, m + 1, 0).getDate();
    let html = `<section class="month-card"><div class="month-head"><div class="month-label">${new Intl.DateTimeFormat('en-US', {month:'long'}).format(date)}</div><div class="swipe-hint">Swipe week: ← →</div></div><div class="month-scroll"><div class="grid">`;
    ['MON','TUE','WED','THU','FRI','SAT','SUN'].forEach(w => html += `<div class="wd">${w}</div>`);

    for (let i = 0; i < mondayFirstOffset; i++) html += `<div class="day"></div>`;

    for (let d = 1; d <= lastDate; d++) {
        const dObj = new Date(y, m, d);
        const dKey = dObj.toDateString();
        const paySubs = payDaysMap[dKey] || [];
        const isToday = dKey === new Date().toDateString() ? 'today' : '';
        const georgianClass = paySubs.includes('Georgian') ? 'georgian-pay' : '';

        let cell = `<div class="day ${isToday} ${paySubs.length ? 'pay-day' : ''} ${georgianClass}" onclick="openDay('${dKey}')">
                    <span class="day-num">${d}</span>`;

        all.filter(o => o.date.toDateString() === dKey).forEach(o => {
            const dueClass = paySubs.includes(o.subject) ? 'due' : '';
            cell += `<div class="lesson-label ${o.subject} ${dueClass}">${o.subject}${dueClass ? ' •' : ''}</div>`;
        });
        html += cell + `</div>`;
    }
    return html + `</div></div></section>`;
}

function openDay(dateStr) {
    $('#dayTitle').text(dateStr);
    const list = $('#dayLessons').empty();
    const alert = $('#payAlert').hide().empty();
    const all = expandSchedules();


    // Paid / Unpaid button in the calendar
    if(payDaysMap[dateStr]) {
        // Show labels only on mobile; no Mark Paid / Unpay buttons
        const unpaid = payDaysMap[dateStr].filter(sub => !isPaidMobile(dateStr, sub));
        if(unpaid.length > 0) {
            let parts = unpaid.map(sub => `
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <span>⚠️</span>
                    <div style="font-weight:700">${sub}</div>
                </div>
            `);
            alert.show().html(parts.join(''));
        }
    }

    all.filter(o => o.date.toDateString() === dateStr).forEach(o => {
        const v = subjVar(o.subject);
        const timeText = o.time ? ` <span style="color:#64748b; font-size:0.85rem;">(${o.time})</span>` : '';
        list.append(`<div class="forecast-item" style="border-left: 5px solid var(--${v})">${o.subject} Lesson${timeText}</div>`);
    });
    if(list.children().length === 0) list.append("<p>No lessons today.</p>");
    $(`#dayModal`).css('display', 'flex');
}

// Updated to match Desktop Forecast style
function openPaySummary() {
    const list = $('#summaryList').empty();
    let found = false;
    
    // Sort all calculated pay days chronologically
    Object.keys(payDaysMap).sort((a,b) => new Date(a) - new Date(b)).forEach(dateKey => {
        const subs = payDaysMap[dateKey];
        if(!subs || subs.length === 0) return;
        // exclude already-paid subjects so paid dates don't show
        const unpaid = subs.filter(s => !isPaidMobile(dateKey, s));
        if(unpaid.length === 0) return;
        found = true;
        unpaid.forEach(sub => {
            const formattedDate = new Date(dateKey).toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
            });
            list.append(`
                <div class="forecast-item ${sub}" style="display:flex; justify-content:space-between; align-items:center;">
                    <div><strong>${sub}</strong><div style="font-size:0.85rem; color:#64748b">${formattedDate}</div></div>
                </div>
            `);
        });
    });
    
    if(!found) list.append("<p style='text-align:center; color:#94a3b8;'>No payments scheduled.</p>");
    $(`#summaryModal`).css('display', 'flex');
}

function closeModal(id) { $(`#${id}`).hide(); }
