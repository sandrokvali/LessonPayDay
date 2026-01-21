const DB_URL = 'https://paydate-for-lessons-default-rtdb.europe-west1.firebasedatabase.app/.json';

let data = { schedules: {}, exceptions: {} };
const FIXED_RATE = 8;
const PAY_SUBJECTS = ['English', 'Chemistry'];
let payDaysMap = {}; 

$(document).ready(() => { fetchData(); });

function fetchData() {
    $.get(DB_URL, (res) => {
        data = res || { schedules: {}, exceptions: {} };
        renderCalendar();
    });
}

function expandSchedules() {
    let list = [];
    if (data.schedules) {
        Object.keys(data.schedules).forEach(id => {
            const s = data.schedules[id];
            let d = new Date(s.startDate);
            while(d.getFullYear() <= 2026) {
                const key = `${d.toDateString()}_${s.subject}`;
                if(data.exceptions && data.exceptions[key] !== 'deleted') {
                    list.push({ subject: s.subject, date: new Date(d) });
                }
                d.setDate(d.getDate() + 7);
            }
        });
    }
    if (data.exceptions) {
        Object.keys(data.exceptions).forEach(key => {
            if(key.includes("SINGLE_") && data.exceptions[key] !== 'deleted') {
                const parts = key.split('_');
                list.push({ subject: parts[2], date: new Date(parts[1]) });
            }
        });
    }
    return list.sort((a,b) => a.date - b.date);
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
                payDaysMap[dKey].push(occ.subject);
            }
        }
    });

    for (let i = 0; i < 12; i++) {
        let d = new Date(now.getFullYear(), i, 1);
        container.append(buildMonth(d, all));
    }
}

function buildMonth(date, all) {
    const y = date.getFullYear(), m = date.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();
    let html = `<div class="month-label">${new Intl.DateTimeFormat('en-US', {month:'long'}).format(date)}</div><div class="grid">`;
    ['S','M','T','W','T','F','S'].forEach(w => html += `<div class="wd">${w}</div>`);

    for (let i = 0; i < firstDay; i++) html += `<div class="day"></div>`;

    for (let d = 1; d <= lastDate; d++) {
        const dObj = new Date(y, m, d);
        const dKey = dObj.toDateString();
        const paySubs = payDaysMap[dKey];
        const isToday = dKey === new Date().toDateString() ? 'today' : '';
        
        let cell = `<div class="day ${isToday} ${paySubs ? 'pay-day' : ''}" onclick="openDay('${dKey}')">
                    <span class="day-num">${d}</span>`;
        
        all.filter(o => o.date.toDateString() === dKey).forEach(o => {
            cell += `<div class="lesson-label ${o.subject}">${o.subject}</div>`;
        });
        html += cell + `</div>`;
    }
    return html + `</div>`;
}

function openDay(dateStr) {
    $('#dayTitle').text(dateStr);
    const list = $('#dayList').empty();
    const alert = $('#payAlert').hide();
    const all = expandSchedules();

    if(payDaysMap[dateStr]) {
        alert.show().text(`⚠️ გასახდელია: ${payDaysMap[dateStr].join(' და ')}`);
    }

    all.filter(o => o.date.toDateString() === dateStr).forEach(o => {
        list.append(`<div class="forecast-item" style="border-left: 5px solid var(--${o.subject.toLowerCase().substring(0,3)})">${o.subject} Lesson</div>`);
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
        found = true;
        payDaysMap[dateKey].forEach(sub => {
            const formattedDate = new Date(dateKey).toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
            });
            list.append(`
                <div class="forecast-item ${sub}">
                    <span>${sub}</span>
                    <span>${formattedDate}</span>
                </div>
            `);
        });
    });
    
    if(!found) list.append("<p style='text-align:center; color:#94a3b8;'>No payments scheduled.</p>");
    $(`#summaryModal`).css('display', 'flex');
}

function closeModal(id) { $(`#${id}`).hide(); }