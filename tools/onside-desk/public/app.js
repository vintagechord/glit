'use strict';

const token = document.querySelector('meta[name="desk-token"]').content;
const screen = document.getElementById('screen');
const TYPE = { ALBUM: '음반 심의', MV_DISTRIBUTION: '온라인 MV', MV_BROADCAST: '방송용 MV' };
const TYPE_EN = { ALBUM: 'ALBUM', MV_DISTRIBUTION: 'ONLINE MUSIC VIDEO', MV_BROADCAST: 'BROADCAST MUSIC VIDEO' };
const STAGES = { RECEIVED: '신규 접수', CHECKING: '자료 확인', PREPARING: '자료 준비', READY: '발송 준비', SUBMITTED: '심의 신청', RESULT_RECEIVED: '결과 수신', COMPLETED: '완료', ON_HOLD: '보류' };
const REMOTE_STATUS = { DRAFT: '작성 중', SUBMITTED: '신청 완료', RECEIVED: '접수됨', IN_REVIEW: '심의 중', REVIEWING: '심의 중', COMPLETED: '완료', APPROVED: '적격', REJECTED: '부적격', NEEDS_FIX: '보완 요청', PENDING: '대기', PROCESSING: '진행 중', CANCELLED: '취소', PAYMENT_PENDING: '입금 확인 중', WAITING_PAYMENT: '결제 대기', PRE_REVIEW: '접수예정', IN_PROGRESS: '심의 진행 중', RESULT_READY: '결과 준비됨', PAID: '결제 완료', UNPAID: '미결제', REFUNDED: '환불', NOT_SENT: '접수예정', SENT: '접수완료', WAITING: '대기' };
const BASE_CHECKS = { source_checked: '신청 정보와 원본 파일 확인', lyrics_checked: '가사 · 크레딧 · 번역 확인', documents_checked: '생성 문서의 양식과 내용 검수', sent: '해당 기관에 자료 전달', result_saved: '심의 결과 / 필증 보관' };
const ui = { data: null, selected: null, detail: null, savedDetail: null, tab: 'overview', docTab: 'materials', resultData: null, resultSequence: 0, resultLoading: false, resultError: '', resultDirtyForm: null, resultNotice: null, resultStationId: null, bulkSelected: [], bulkStatus: 'NOT_SENT', bulkAgeRating: '', resultAttempts: {}, emailPreview: null, previewLoading: false, previewSequence: 0, publishing: false, certificateFile: null, nav: 'cases', manualType: 'ALBUM', manualMvType: 'MV_DISTRIBUTION', importOpen: true, importing: false, referenceFile: null, translating: false, translationNotice: null, filter: 'all', stage: 'all', query: '', dirty: false, loadingDetail: false, pollTimer: null, requestSequence: 0 };
const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const currentText = (...values) => values.find(value => typeof value === 'string') ?? '';
const value = (v, fallback = '미입력') => v === null || v === undefined || v === '' ? fallback : String(v);
const label = v => REMOTE_STATUS[v] || v || '미확인';
const formatDate = (v, full = false) => { if (!v) return '—'; const d = new Date(v); if (Number.isNaN(d.getTime())) return String(v); return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', ...(full ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(d); };
const fileSize = n => { n = Number(n); if (!Number.isFinite(n) || n <= 0) return ''; const units = ['B','KB','MB','GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; };
const shortId = id => String(id || '').slice(0, 8).toUpperCase();
const activeJob = j => ['queued','running','QUEUED','RUNNING','pending'].includes(j.status);
const stageClass = s => s === 'ON_HOLD' ? 'amber' : s === 'COMPLETED' ? 'neutral' : ['READY','SUBMITTED','RESULT_RECEIVED'].includes(s) ? 'blue' : '';
const typeClass = t => t === 'MV_DISTRIBUTION' ? 'mv-online' : t === 'MV_BROADCAST' ? 'mv-broadcast' : '';
const stageOf = c => c.local?.stage || 'RECEIVED';
const warningText = w => typeof w === 'string' ? w : w?.message || w?.code || '확인 필요';
const cases = () => ui.data?.cases || [];
const isManual = d => d?.source === 'manual' || d?.submission?.source === 'manual';
const serviceCases = () => cases().filter(c => !isManual(c));
const manualCases = () => cases().filter(isManual);
const manualCategory = c => c.type === 'ALBUM' ? 'ALBUM' : 'MV';
const trashCases = () => ui.data?.trashCases || [];
const jobs = () => ui.data?.jobs || [];
const apiPath = suffix => `/api/cases/${encodeURIComponent(ui.selected)}${suffix}`;

async function api(path, options = {}) {
  const headers = { 'X-Desk-Token': token, ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers, body: options.body && typeof options.body !== 'string' && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || body.message || `요청을 처리하지 못했습니다 (${response.status})`); error.status = response.status; error.code = body.code; error.body = body; throw error; }
  return body;
}
let toastTimer;
function toast(message, error = false) {
  const box = document.getElementById('toast'); box.textContent = message; box.className = `toast${error ? ' error' : ''}`; box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, error ? 8000 : 4500);
}
function globalAlert(message) { const box = document.getElementById('global-alert'); box.textContent = message || ''; box.hidden = !message; }
async function discardEdits() {
  if (ui.translating) { toast('가사를 번역하는 중입니다. 완료 후 이동해 주세요.', true); return false; }
  if (ui.importing) { toast('기준파일을 읽는 중입니다. 완료 후 이동해 주세요.', true); return false; }
  if (ui.publishing) { toast('결과를 저장하는 중입니다. 완료 후 이동해 주세요.', true); return false; }
  if (!ui.dirty) return true;
  const dialog = document.getElementById('confirm-dialog'); document.getElementById('confirm-title').textContent = '저장하지 않은 수정이 있습니다'; document.getElementById('confirm-message').textContent = '다른 화면으로 이동하면 아직 저장하지 않은 내용은 사라집니다.';
  dialog.showModal(); return new Promise(resolve => dialog.addEventListener('close', () => { const discard = dialog.returnValue === 'confirm'; if (discard) { if (ui.savedDetail) ui.detail = structuredClone(ui.savedDetail); ui.certificateFile = null; ui.dirty = false; } resolve(discard); }, { once: true }));
}
function heading(title, subtitle, action = '') { return `<div class="page-heading"><div><div class="eyebrow">ONSIDE REVIEW DESK</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action}</div>`; }
function trashButton() { return `<button class="button secondary" data-action="view-trash">목록 휴지통 ${trashCases().length ? `(${trashCases().length})` : ''}</button>`; }
function trashScreen() {
  screen.innerHTML = `${heading('목록 휴지통','이 Mac의 목록에서 삭제한 신청을 복원할 수 있습니다.')}<section class="panel trash-panel"><div class="notice good">온라인 서비스의 신청·결과는 유지됩니다. 이 Mac의 원본 파일과 생성 이력도 복원할 수 있도록 보관됩니다.</div>${trashCases().length ? `<div class="trash-list">${trashCases().map(c => `<article><div><strong>${e(value(c.title))}</strong><p>${e(value(c.artist_name))} · ${e(TYPE[c.type])} · ${isManual(c) ? '수동 작업' : '온라인 신청'}</p><small>${e(formatDate(c.deletedAt || c.local?.deletedAt,true))} 삭제</small></div><button class="button secondary small" data-restore-case="${e(c.id)}">목록으로 복원</button></article>`).join('')}</div>` : '<div class="empty-list">목록에서 삭제한 신청이 없습니다.</div>'}</section>`;
}
async function deleteCase(id) {
  if (!(await discardEdits())) return;
  if (jobs().some(j => j.caseId === id && activeJob(j))) { toast('진행 중인 작업이 완료된 뒤 삭제해 주세요.',true); return; }
  const c = cases().find(item => item.id === id); if (!c) return;
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = '이 Mac의 목록에서 삭제할까요?';
  document.getElementById('confirm-message').textContent = `‘${value(c.title)}’을 목록 휴지통으로 옮깁니다. 온라인 신청과 고객 결과는 그대로 유지되며, 자료와 작업 기록은 나중에 복원할 수 있습니다.`;
  dialog.querySelector('[value=cancel]').textContent = '취소'; dialog.querySelector('[value=confirm]').textContent = '목록에서 삭제'; dialog.returnValue = ''; dialog.showModal();
  const confirmed = await new Promise(resolve => dialog.addEventListener('close',() => resolve(dialog.returnValue === 'confirm'),{once:true}));
  dialog.querySelector('[value=cancel]').textContent = '계속 편집'; dialog.querySelector('[value=confirm]').textContent = '변경 버리기';
  if (!confirmed) return;
  try {
    await api(`/api/cases/${encodeURIComponent(id)}`,{method:'DELETE'});
    if (ui.selected === id) { ++ui.requestSequence; ++ui.resultSequence; clearEmailPreview(); ui.selected = null; ui.detail = null; ui.savedDetail = null; ui.resultData = null; ui.dirty = false; }
    await refresh(); render(); toast('목록 휴지통으로 옮겼습니다. 나중에 복원할 수 있습니다.');
  } catch(error) { toast(error.message,true); }
}
async function restoreCase(id) {
  try { await api(`/api/cases/${encodeURIComponent(id)}/restore`,{method:'POST',body:{}}); await refresh(); render(); toast('신청과 작업 기록을 목록으로 복원했습니다.'); }
  catch(error) { toast(error.message,true); }
}
function stats() {
  const all = serviceCases(), reviewing = all.filter(c => !['COMPLETED','RESULT_READY'].includes(c.status));
  const results = all.filter(c => ['COMPLETED','RESULT_READY'].includes(c.status));
  const attention = all.filter(c => c.payment_status !== 'PAID' || c.warnings?.length || c.sourceChanged);
  return `<div class="stats compact-stats"><div class="stat featured"><span class="stat-label">서비스 진행 중</span><strong>${reviewing.length}<small>건</small></strong></div><div class="stat"><span class="stat-label">결과 준비 · 완료</span><strong>${results.length}<small>건</small></strong></div><div class="stat"><span class="stat-label">확인할 신청</span><strong>${attention.length}<small>건</small></strong></div></div>`;
}
function filteredCases() {
  return cases().filter(c => (ui.nav === 'manual' ? isManual(c) && manualCategory(c) === ui.manualType : !isManual(c) && (ui.filter === 'all' || c.type === ui.filter)) && (ui.stage === 'all' || (ui.nav === 'manual' ? stageOf(c) : c.status) === ui.stage) && `${c.title || ''} ${c.artist_name || ''} ${c.id || ''} ${c.applicant_name || ''}`.toLowerCase().includes(ui.query.toLowerCase()));
}
function listMarkup() {
  const list = filteredCases();
  return list.length ? list.map(c => `<div class="case-list-item"><button class="case-card${ui.selected === c.id ? ' selected' : ''}" data-case="${e(c.id)}" aria-pressed="${ui.selected === c.id}"><span class="case-top"><span class="type-label ${typeClass(c.type)}">${c.type === 'ALBUM' ? '◉' : '▷'} ${e(TYPE[c.type] || c.type)}</span><span class="case-date">${e(formatDate(c.created_at))}</span></span><span class="case-title">${e(value(c.title))}</span><span class="case-artist">${e(value(c.artist_name, '아티스트 미입력'))}</span><span class="case-bottom">${isManual(c) ? `<span class="badge ${stageClass(stageOf(c))}">${e(STAGES[stageOf(c)] || '신규 접수')}</span><span class="badge neutral">수동 작업</span>` : `<span class="badge ${['COMPLETED','RESULT_READY'].includes(c.status) ? 'blue' : ''}">${e(label(c.payment_status === 'PAID' && c.status === 'SUBMITTED' ? 'PRE_REVIEW' : c.status))}</span>${c.payment_status === 'PAID' ? '<span class="badge neutral">결제 완료</span>' : `<span class="badge amber">${e(label(c.payment_status))}</span>`}`}<span class="case-indicator">${c.sourceChanged ? '새 변경' : c.latestGeneration ? '자료 있음' : `#${e(shortId(c.id))}`}</span></span>${c.local?.dueDate ? `<span class="case-deadline">처리 목표 ${e(c.local.dueDate)}</span>` : ''}</button><button class="case-delete inline-link" data-delete-case="${e(c.id)}" aria-label="${e(value(c.title))} 목록에서 삭제">목록에서 삭제</button></div>`).join('') : `<div class="empty-list">표시할 신청이 없습니다.<br>${ui.nav === 'manual' ? '기준파일을 넣어 새 작업을 시작하세요.' : '필터를 변경하거나 신청을 동기화해 주세요.'}</div>`;
}
function casesScreen() {
  const statuses = ['SUBMITTED','PRE_REVIEW','WAITING_PAYMENT','IN_PROGRESS','RESULT_READY','COMPLETED'];
  screen.innerHTML = `${heading('신청 관리', '자료 준비와 고객 결과 안내를 신청별로 관리합니다.', trashButton())}${stats()}<div class="workbench"><section class="panel case-browser"><div class="panel-head"><h2>신청 목록 <span class="count" id="filtered-count">${filteredCases().length}</span></h2><span class="toolbar-note">최근 접수순</span></div><div class="search-wrap"><span>⌕</span><input id="search" type="search" placeholder="앨범, 아티스트, 접수 번호 검색" aria-label="신청 검색" value="${e(ui.query)}"></div><div class="filters">${[['all','전체'],['ALBUM','음반'],['MV_DISTRIBUTION','온라인 MV'],['MV_BROADCAST','방송 MV']].map(([key,name]) => `<button class="filter${ui.filter === key ? ' active' : ''}" data-filter="${key}">${name}</button>`).join('')}</div><div class="list-options"><select id="stage-filter" aria-label="서비스 진행 상태 필터"><option value="all">모든 서비스 상태</option>${statuses.map(key => `<option value="${key}"${ui.stage === key ? ' selected' : ''}>${e(label(key))}</option>`).join('')}</select></div><div class="case-list" id="case-list">${listMarkup()}</div><div class="legend">마지막 동기화 <span id="last-sync">${e(formatDate(ui.data?.lastSync, true))}</span><br>목록의 상태는 온사이드 서비스 기준입니다.</div></section><section class="panel" id="detail-panel">${detailMarkup()}</section></div>`;
}
function renderList() { const statPanel = document.querySelector('.stats'); if (statPanel) statPanel.outerHTML = stats(); const list = document.getElementById('case-list'); if (list) list.innerHTML = listMarkup(); const count = document.getElementById('filtered-count'); if (count) count.textContent = filteredCases().length; const last = document.getElementById('last-sync'); if (last) last.textContent = formatDate(ui.data?.lastSync, true); }
function manualScreen() {
  const category = ui.manualType === 'ALBUM' ? '음반' : '뮤비';
  screen.innerHTML = `${heading(`관리자 수동 작업 · ${category}`, '이메일·문자 등으로 받은 기준파일과 원본을 이 Mac에서 관리합니다.', `<div class="button-row">${trashButton()}<button class="button primary" data-action="new-manual">＋ 기준파일로 새 작업</button></div>`)}
    ${ui.importOpen ? manualImportMarkup() : ''}
    <div class="workbench manual-workbench"><section class="panel case-browser"><div class="panel-head"><h2>${category} 작업 <span class="count" id="filtered-count">${filteredCases().length}</span></h2><span class="toolbar-note">이 Mac에 보관</span></div><div class="search-wrap"><span>⌕</span><input id="search" type="search" placeholder="작품, 아티스트, 신청자 검색" aria-label="신청 검색" value="${e(ui.query)}"></div><div class="list-options"><select id="stage-filter" aria-label="수동 작업 진행 단계 필터"><option value="all">모든 작업 단계</option>${Object.entries(STAGES).map(([key,text]) => `<option value="${key}"${ui.stage === key ? ' selected' : ''}>${e(text)}</option>`).join('')}</select></div><div class="case-list" id="case-list">${listMarkup()}</div><div class="legend">관리자가 직접 등록한 신청입니다.<br>진행 기록과 생성 자료를 함께 보관합니다.</div></section><section class="panel" id="detail-panel">${detailMarkup()}</section></div>`;
}
function manualImportMarkup() {
  const album = ui.manualType === 'ALBUM';
  return `<form id="manual-import-form" class="panel manual-import-card"><div><span class="eyebrow">새 수동 작업</span><h2>${album ? '음반' : '뮤비'} 기준파일 가져오기</h2><p>기준파일에서 작품 정보와 가사를 읽어 새 작업을 만듭니다. ${album ? '음반의 트랙별 내용을' : '뮤비 한 작품의 내용을'} 확인하고 수정할 수 있습니다.</p></div><fieldset class="manual-import-fields"${ui.importing ? ' disabled' : ''}>
    ${album ? '' : `<label class="field"><span>뮤비 자료 구분</span><select id="manual-mv-type"><option value="MV_DISTRIBUTION"${ui.manualMvType === 'MV_DISTRIBUTION' ? ' selected' : ''}>온라인 뮤비 · 영등위</option><option value="MV_BROADCAST"${ui.manualMvType === 'MV_BROADCAST' ? ' selected' : ''}>방송용 뮤비</option></select></label>`}
    <label class="manual-file-picker"><span class="file-symbol">▱</span><span><strong>기준파일 선택</strong><span id="manual-reference-name">${ui.referenceFile ? e(`${ui.referenceFile.name} · ${fileSize(ui.referenceFile.size)}`) : 'Word·한글 기준파일을 선택하세요.'}</span><small>DOCX · DOC · HWP · HWPX / 최대 20MB</small></span><input id="manual-reference" type="file" accept=".docx,.doc,.hwp,.hwpx" aria-label="수동 작업 기준파일"></label>
    <button class="button accent" type="submit">${ui.importing ? '기준파일을 읽는 중…' : '기준파일로 작업 만들기'}</button></fieldset><p class="helper">음원·영상은 작업을 만든 뒤 ‘받은 파일 연결’로 추가합니다. 가사는 원문을 보존하고 욕설·의심 표현·번역 확인사항을 별도로 표시합니다.</p><div id="manual-import-message" role="status" class="helper"></div></form>`;
}
async function importManualReference() {
  if (ui.importing) return;
  const file = ui.referenceFile;
  if (!file) throw new Error('Word 또는 한글 기준파일을 선택해 주세요.');
  if (!/\.(?:docx|doc|hwp|hwpx)$/i.test(file.name)) throw new Error('DOCX, DOC, HWP, HWPX 기준파일을 선택해 주세요.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('기준파일은 0바이트보다 크고 20MB 이하이어야 합니다.');
  const type = ui.manualType === 'ALBUM' ? 'ALBUM' : ui.manualMvType;
  ui.importing = true;
  const fieldset = document.querySelector('.manual-import-fields'); if (fieldset) fieldset.disabled = true;
  const message = document.getElementById('manual-import-message'); if (message) message.textContent = '기준파일에서 신청 정보와 가사를 읽고 있습니다.';
  try {
    const result = await api(`/api/manual/import?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    if (!result.id) throw new Error('수동 작업 정보를 확인하지 못했습니다. 작업 목록을 새로 확인해 주세요.');
    ui.importing = false; ui.importOpen = false; ui.referenceFile = null; ui.dirty = false; ui.nav = 'manual'; ui.stage = 'all'; ui.query = ''; ui.selected = result.id; ui.tab = 'documents'; ui.docTab = 'edit';
    if (result.detail) { ui.detail = result.detail; ui.savedDetail = structuredClone(result.detail); }
    await refresh(); render(); await loadDetail(result.id, false);
    toast('기준파일을 가져왔습니다. 추출된 정보와 가사 검토사항을 확인해 주세요.');
  } catch (error) { if (message?.isConnected) message.textContent = error.message || '파일을 읽지 못했습니다.'; throw error; } finally { ui.importing = false; if (fieldset?.isConnected) fieldset.disabled = false; }
}
function manualOverviewMarkup(d) {
  const s = d.submission, info = d.importInfo || {}, count = d.screening?.findings?.length || 0;
  return `<div class="notice good"><strong>관리자 수동 신청</strong><p>기준파일과 작업 자료는 이 Mac에 보관됩니다. 서비스 신청이나 고객 결과 페이지에 자동 등록되지 않습니다.</p></div>
    <section class="section-block"><div class="section-top"><h3>기준파일에서 가져온 신청</h3><button class="inline-link" data-action="edit-manual">정보 수정하기 →</button></div><div class="field-grid">${fieldValue('발매일', s.release_date)}${fieldValue('장르', s.genre)}${fieldValue('제작사', s.production_company || s.mv_production_company)}${fieldValue('유통·배급사', s.distributor || s.mv_distribution_company)}${fieldValue('신청자', s.applicant_name)}${fieldValue('연락처', s.applicant_phone)}${fieldValue('이메일', s.applicant_email, true)}${s.type !== 'ALBUM' ? `${fieldValue('감독',s.mv_director)}${fieldValue('주연',s.mv_lead_actor)}${fieldValue('상영 시간',s.mv_runtime)}${fieldValue('줄거리',s.mv_storyline,true)}` : ''}</div></section>
    <hr class="section-divider"><section class="section-block"><div class="section-top"><h3>가사·자료 검토</h3><button class="inline-link" data-tab="review">검토사항 보기 →</button></div><p class="helper">${count ? `${count}개의 확인사항이 있습니다. 욕설·의심 표현과 번역 상태를 원문과 대조해 주세요.` : '현재 자동 점검에서 확인사항이 발견되지 않았습니다. 원문과 최종 제출 자료를 검수해 주세요.'}</p></section>${referenceMarkup(info)}`;
}
function referenceMarkup(info = {}) {
  return `<section class="section-block reference-section"><div class="section-top"><h3>가져온 기준파일</h3><span>${e(info.format || '')}</span></div><p class="reference-name">${e(info.filename || '기준파일 정보 없음')}</p>${info.filename ? `<a class="button secondary small" href="${apiPath('/reference')}" download="${e(info.filename)}">기준파일 원본 다운로드</a>` : ''}<details class="source-extract"><summary>기준파일에서 추출한 전체 원문</summary><pre>${e(info.extractedText || '추출한 원문이 없습니다.')}</pre></details><p class="helper">원본을 참고해 작품 정보와 전체 가사를 확인하세요. 문서 정보 수정에서 보완한 내용은 새 생성 자료에 적용됩니다.</p></section>`;
}
function manualMaterialsMarkup(d) {
  const local = d.localAttachments || [], album = d.submission.type === 'ALBUM';
  return `${referenceMarkup(d.importInfo)}<hr class="section-divider"><section class="section-block"><div class="section-top"><h3>이메일·문자 등으로 받은 원본</h3><span>${local.length}개 · 이 Mac에 보관</span></div><div class="file-list">${local.length ? local.map(f => fileRow(f.name || f.original_name, [fileSize(f.bytes || f.size), formatDate(f.createdAt, true)].filter(Boolean).join(' · '), '↓', '<span class="badge neutral">로컬 보관</span>')).join('') : `<div class="notice">받은 ${album ? '음원' : '영상'}과 추가 자료를 연결할 수 있습니다.</div>`}</div><label class="button secondary" style="margin-top:12px;cursor:pointer">＋ 받은 파일 연결<input id="local-attachments" type="file" multiple hidden></label><p class="helper">선택한 파일의 사본을 이 작업 폴더에 저장합니다.</p><div id="attachment-progress" class="helper" role="status"></div></section>
    <hr class="section-divider"><section class="section-block"><div class="section-top"><h3>${album ? '신청 정보 빠른 복사' : d.submission.type === 'MV_BROADCAST' ? '방송 심의 입력용 정보' : '영등위 심의 신청 입력용 정보'}</h3><span>수정한 내용 반영</span></div><div class="copy-box"><pre>${e(copyText(d))}</pre><button class="button secondary small" data-action="copy-info">전체 내용 복사</button></div></section>`;
}
function manualReviewMarkup(d) {
  const screening = d.screening || {}, findings = screening.findings || [], counts = screening.counts || {};
  const names = { profanity: '욕설 확인', suspected: '의심 표현', translation_missing: '번역 누락', translation_review: '번역 대조', lyrics_missing: '가사 누락', instrumental_conflict: '연주곡 표시 확인', incomplete: '정보 확인' };
  return `<div class="review-intro"><div><h3>가사·자료 확인사항</h3><p class="helper">욕설과 의심 표현, 번역 누락을 원문과 대조할 수 있도록 정리했습니다. 자동 점검은 문맥 판단이나 심의 적격 판정을 대신하지 않습니다.</p></div><button class="button secondary small" data-action="edit-manual">가사·정보 수정</button></div>
    <div class="review-counts">${Object.entries(names).filter(([key]) => Number(counts[key]) > 0).map(([key,name]) => `<span class="badge ${key === 'profanity' ? 'red' : 'amber'}">${name} ${e(counts[key])}</span>`).join('')}${!findings.length ? '<span class="badge">자동 점검 확인사항 없음</span>' : ''}</div>
    ${findings.some(f => f.kind === 'translation_missing') ? `<div class="notice"><strong>빠진 한국어 번역 추가</strong><p>온사이드 번역 기능으로 미번역 가사를 보내 번역합니다. 신청 내역은 이 Mac에만 저장됩니다. 번역 후 원문과 의미를 대조해 주세요.</p><button class="button secondary small" data-action="translate-manual"${ui.translating || ui.dirty ? ' disabled' : ''}>${ui.translating ? '가사 번역 중…' : '미번역 가사 번역'}</button></div>` : ''}
    ${ui.translationNotice?.caseId === d.submission.id ? `<div class="notice${ui.translationNotice.error ? '' : ' good'}" role="status">${e(ui.translationNotice.message)}${ui.translationNotice.warnings?.length ? `<ul>${ui.translationNotice.warnings.map(w => `<li>${e(warningText(w))}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="manual-findings">${findings.map(f => `<article class="finding-card ${f.kind === 'profanity' ? 'finding-attention' : ''}"><div class="finding-heading"><strong>${e(names[f.kind] || '확인 필요')}</strong><span>${e([d.submission.type === 'ALBUM' && f.trackNo ? `${f.trackNo}번 트랙` : '', f.trackTitle || (d.submission.type === 'ALBUM' ? '' : '뮤비 가사'), f.line ? `${f.line}행` : ''].filter(Boolean).join(' · '))}</span></div>${f.excerpt ? `<blockquote>${e(f.excerpt)}</blockquote>` : ''}<p>${e(f.message || '원문과 신청 정보를 확인해 주세요.')}</p></article>`).join('')}</div>
    <div class="notice"><strong>원문을 보존합니다</strong><p>표현을 자동 삭제·순화하지 않습니다. 한국어 번역은 위 번역 기능이나 직접 입력으로 보완할 수 있습니다. 확인사항은 상단의 ‘자료 생성 전에 확인해 주세요’에 함께 표시합니다.</p></div>
    ${screening.sourceHash ? `<label class="check-item review-ack"><input id="manual-review-ack" type="checkbox"${screening.acknowledged ? ' checked' : ''}${ui.translating ? ' disabled' : ''}><span>현재 가사와 확인사항을 검토했습니다<small>정보나 가사가 바뀌면 다시 확인하도록 표시됩니다. 자료 생성은 검토 표시와 별도로 실행할 수 있습니다.</small></span></label>` : ''}`;
}

async function translateManualLyrics() {
  if (ui.translating || !isManual(ui.detail)) return;
  if (ui.dirty) { toast('수정 중인 내용을 먼저 저장해 주세요.', true); return; }
  const caseId = ui.selected;
  ui.translating = true; ui.translationNotice = null; detailRender();
  try {
    const result = await api(apiPath('/translate'), { method: 'POST', body: { expectedSourceHash: ui.detail.screening?.sourceHash } });
    ui.translationNotice = { caseId, message: `${Number(result.translatedCount || 0)}개 가사의 한국어 번역을 추가했습니다. 원문과 대조해 주세요.`, warnings: result.warnings || [] };
    await loadDetail(caseId, false);
  } catch (error) {
    ui.translationNotice = { caseId, error: true, message: `번역을 완료하지 못했습니다. ${error.message}`, warnings: error.body?.warnings || [] };
    toast(ui.translationNotice.message, true);
  } finally { ui.translating = false; detailRender(); }
}

function effective() {
  if (!ui.detail) return null;
  const local = ui.detail.local || {}, override = local.overrides || {};
  const sourceTracks = ui.detail.tracks || [], patches = override.tracks || [];
  const combined = [...sourceTracks.map(t => ({ ...t, ...patches.find(o => o.id === t.id) })), ...patches.filter(t => String(t.id).startsWith('local-') && !sourceTracks.some(s => s.id === t.id))].filter(t => !t._deleted);
  return { ...ui.detail, submission: { ...ui.detail.submission, ...override.submission }, tracks: combined, local };
}
function detailMarkup() {
  if (ui.loadingDetail) return '<div class="detail-empty"><span class="spinner"></span><p>신청 자료를 불러오고 있습니다.</p></div>';
  const d = effective(); if (!d) return `<div class="detail-empty"><div class="empty-disc">◉</div><h2>${ui.nav === 'manual' ? '기준파일로 작업을 시작하세요' : '신청을 선택해 시작하세요'}</h2><p>${ui.nav === 'manual' ? 'Word·한글 기준파일에서 자료를 만들거나<br>기존 수동 작업을 선택하세요.' : '신청 정보, 심의 자료, 결과 안내를<br>한 화면에서 이어서 처리합니다.'}</p></div>`;
  const serviceSubmission = { ...(d.sourceSubmission || d.submission), ...(ui.tab === 'results' && ui.resultData?.caseId === ui.selected ? ui.resultData.submission : {}) };
  const manual = isManual(d);
  const s = manual || ui.tab === 'documents' ? d.submission : serviceSubmission, running = jobs().filter(j => j.caseId === ui.selected && activeJob(j));
  return `<div class="detail-header"><div class="detail-kicker"><span class="type-label ${typeClass(s.type)}">${e(TYPE_EN[s.type] || s.type)}</span><span class="detail-id">#${e(shortId(s.id))}</span><button class="inline-link delete-detail" data-delete-case="${e(s.id)}">목록에서 삭제</button></div><h2 class="detail-title">${e(value(s.title))}</h2><p class="detail-artist">${e(value(s.artist_name))} <span>·</span> ${e(TYPE[s.type] || s.type)}</p><div class="detail-statuses">${manual ? `<span class="label">이 Mac의 수동 작업</span><span class="badge ${stageClass(stageOf(d))}">${e(STAGES[stageOf(d)] || '신규 접수')}</span>` : `<span class="label">온사이드</span><span class="badge neutral">${e(label(s.payment_status === 'PAID' && s.status === 'SUBMITTED' ? 'PRE_REVIEW' : s.status))}</span><span class="badge ${s.payment_status === 'PAID' ? '' : 'amber'}">${e(label(s.payment_status))}</span>`}</div></div>${preparationWarnings(d)}<div class="tabs" role="tablist">${[['overview','신청 정보'],['documents','자료 준비'],[manual ? 'review' : 'results',manual ? '검토사항' : '심의 결과'],['notes','작업 메모']].map(([key,name]) => `<button class="tab${ui.tab === key ? ' active' : ''}" role="tab" aria-selected="${ui.tab === key}" data-tab="${key}">${name}</button>`).join('')}</div>${running.length ? `<div class="job-inline"><span class="busy-label"><span class="spinner"></span>${e(running[0].message || '작업을 진행하고 있습니다.')}</span></div>` : ''}<div class="tab-content">${ui.tab === 'overview' ? overviewMarkup(d) : ui.tab === 'documents' ? documentsMarkup(d) : ui.tab === 'review' && manual ? manualReviewMarkup(d) : ui.tab === 'results' && !manual ? resultsMarkup(d) : notesMarkup(d)}</div>`;
}
function detailRender() { const panel = document.getElementById('detail-panel'); if (panel) panel.innerHTML = detailMarkup(); }
function fieldValue(name, val, wide = false) { return `<div class="field-value${wide ? ' wide' : ''}"><span class="label">${e(name)}</span><span class="value">${e(value(val))}</span></div>`; }
function inputField(name, title, val, type = 'text', full = false) { return `<label class="field${full ? ' full' : ''}"><span>${e(title)}</span>${type === 'textarea' ? `<textarea name="${e(name)}" rows="4">${e(val)}</textarea>` : `<input type="${type}" name="${e(name)}" value="${e(val)}">`}</label>`; }
function preparationWarnings(d) {
  const album = d.submission.type === 'ALBUM';
  const findings = (d.screening?.findings || []).map(f => [album && f.trackNo ? `${f.trackNo}번 트랙` : '',f.trackTitle || '',f.line ? `${f.line}행` : '',f.message || '',f.excerpt ? `“${f.excerpt}”` : ''].filter(Boolean).join(' · '));
  const messages = [...new Set([...(d.warnings || []),...(d.importInfo?.warnings || []),...(d.generations?.at(-1)?.warnings || []),...findings].map(warningText))];
  if (d.sourceChanged) messages.unshift('문서 정보가 마지막 생성 이후 바뀌었습니다. 최신 내용을 확인하고 자료를 다시 생성하세요.');
  if (!messages.length) return '';
  return `<section class="preparation-warnings notice" aria-label="자료 생성 전에 확인해 주세요"><strong>자료 생성 전에 확인해 주세요</strong><ul>${messages.slice(0,3).map(message => `<li>${e(message)}</li>`).join('')}</ul>${messages.length > 3 ? `<details><summary>확인사항 ${messages.length-3}개 더 보기</summary><ul>${messages.slice(3).map(message => `<li>${e(message)}</li>`).join('')}</ul></details>` : ''}${isManual(d) ? '<button class="inline-link" data-tab="review">가사 검토와 번역 보완 →</button>' : ''}</section>`;
}
function visibleArtifacts(d,g) {
  const files = g.artifacts || [];
  if (d.submission.type === 'ALBUM') return files;
  const lyric = files.find(a => /가사.*\.doc$/i.test(a.name || a.filename)) || files.find(a => /가사.*\.docx$/i.test(a.name || a.filename));
  const copy = files.find(a => /\.html$/i.test(a.name || a.filename)) || files.find(a => /(?:입력|복사).*\.txt$/i.test(a.name || a.filename));
  return [lyric,copy].filter(Boolean);
}
function overviewMarkup(d) {
  if (isManual(d)) return manualOverviewMarkup(d);
  const s = d.sourceSubmission || d.submission;
  const reviews = d.stationReviews || [];
  return `<section class="section-block"><div class="section-top"><h3>서비스에 접수된 신청</h3><span>${e(formatDate(s.created_at))}</span></div><div class="field-grid">${fieldValue('발매일', s.release_date)}${fieldValue('장르', s.genre)}${fieldValue('제작사', s.production_company || s.mv_production_company)}${fieldValue('유통사', s.distributor || s.mv_distribution_company)}${fieldValue('신청자', s.applicant_name || s.contact_name)}${fieldValue('연락처', s.applicant_phone || s.contact_phone)}${fieldValue('이메일', s.applicant_email || s.contact_email, true)}${s.type !== 'ALBUM' ? `${fieldValue('감독',s.mv_director)}${fieldValue('주연',s.mv_lead_actor)}${fieldValue('상영 시간',s.mv_runtime)}${fieldValue('줄거리',s.mv_storyline,true)}` : ''}</div></section><hr class="section-divider"><section class="section-block"><div class="section-top"><h3>${s.type === 'MV_DISTRIBUTION' ? '영등위 결과' : '신청한 방송사'}</h3><button class="inline-link" data-tab="results">결과 입력하기 →</button></div>${reviews.length ? `<div class="service-station-list">${reviews.map(r => { const st = r.station || d.stations?.find(x => x.id === r.station_id) || {}; return `<div><strong>${e(st.name || st.code || '신청 기관')}</strong><span class="badge ${r.status === 'REJECTED' ? 'red' : ''}">${e(label(r.status))}</span>${r.age_rating ? `<span class="badge blue">${e(ratingLabel(r.age_rating))}</span>` : ''}</div>`; }).join('')}</div>` : '<p class="helper">결과 입력 화면에서 실제 신청 기관과 현재 진행 상황을 확인하세요.</p>'}${s.type === 'MV_DISTRIBUTION' && (s.mv_desired_rating || s.mv_rating) ? `<p class="helper">현재 안내 등급: <strong>${e(ratingLabel(s.mv_desired_rating || s.mv_rating))}</strong></p>` : ''}</section><div class="notice good">심의 결과에서 저장한 내용은 관리자 페이지와 고객 결과 페이지에 반영됩니다. 문서 보완과 작업 메모는 이 Mac에 저장됩니다.</div>`;
}
function documentsMarkup(d) {
  const running = jobs().some(j => j.caseId === ui.selected && activeJob(j));
  return `<div class="document-toolbar"><button class="button accent" data-action="generate"${running ? ' disabled' : ''}>▱ 심의 자료 생성</button>${isManual(d) ? `<button class="button secondary${d.screening?.requiresReview && !d.screening?.acknowledged ? ' review-needed' : ''}" data-tab="review">가사 검토사항 ${d.screening?.findings?.length || 0}개</button>` : `<button class="button secondary" data-action="download"${running ? ' disabled' : ''}>↓ 원본 다운로드</button>`}<button class="button secondary" data-action="open-case" title="이 신청의 작업 폴더 열기">폴더 ↗</button></div><div class="subtabs" role="tablist" aria-label="자료 준비 작업">${[['materials','원본 · 복사'],['edit','문서 정보 수정'],['history','생성 파일']].map(([key,name]) => `<button class="subtab${ui.docTab === key ? ' active' : ''}" data-doc-tab="${key}" role="tab" aria-selected="${ui.docTab === key}">${name}${key === 'history' && d.generations?.length ? ` <small>${d.generations.length}</small>` : ''}</button>`).join('')}</div>${ui.docTab === 'edit' ? editMarkup(d) : ui.docTab === 'history' ? historyMarkup(d) : materialsMarkup(d)}`;
}
function notesMarkup(d) {
  const stage = d.local.stage || 'RECEIVED', checks = d.local.checklist || {};
  return `<div class="notice good">개인 작업 기록입니다. 이곳의 단계와 메모를 바꿔도 고객에게 알림을 보내거나 서비스의 심의 상태를 변경하지 않습니다.</div><section class="section-block"><div class="section-top"><h3>내 작업 단계</h3><span>이 Mac에 저장</span></div><div class="status-control"><label class="field"><span>작업 단계</span><select id="local-stage" aria-label="로컬 진행 단계">${Object.entries(STAGES).map(([key,name]) => `<option value="${key}"${stage === key ? ' selected' : ''}>${name}</option>`).join('')}</select></label><label class="field"><span>목표 처리일</span><input type="date" id="due-date" value="${e(d.local.dueDate || '')}"></label></div></section><hr class="section-divider"><section class="section-block"><div class="section-top"><h3>작업 체크리스트</h3><span>개인 확인용</span></div><div class="checklist">${Object.entries(BASE_CHECKS).map(([key,text]) => `<label class="check-item"><input type="checkbox" data-check="${key}"${checks[key] ? ' checked' : ''}><span>${e(text)}</span></label>`).join('')}</div></section><hr class="section-divider"><form id="notes-form"><label class="field"><span>작업 메모</span><textarea class="note" name="notes" placeholder="보완 요청, 전달일, 회신 내용 등을 남겨 주세요.">${e(d.local.notes || '')}</textarea></label><div class="save-bar"><span class="save-status">고객에게 공개되지 않습니다.</span><button class="button primary small" type="submit">메모 저장</button></div></form>${(d.history || []).length ? `<details class="local-history"><summary>이 Mac의 최근 작업 이력</summary>${d.history.slice(0,20).map(item => `<p><time>${e(formatDate(item.at, true))}</time> ${e(item.message)}</p>`).join('')}</details>` : ''}`;
}
function copyText(d) {
  const s = d.submission;
  const entries = s.type === 'ALBUM' ? [['앨범명',s.title],['아티스트',s.artist_name],['발매일',s.release_date],['장르',s.genre],['제작사',s.production_company],['유통사',s.distributor]] : [['신청 구분',TYPE[s.type]],['작품명',s.title],['아티스트',s.artist_name],['곡명',s.mv_song_title_official || s.mv_song_title || s.mv_song_title_kr],['영문 곡명',s.mv_song_title_en],['앨범명',s.mv_album_title],['제작일',s.mv_production_date],['발매일',s.release_date],['상영 시간',s.mv_runtime],['영상 형식',s.mv_format],['감독',s.mv_director],['주연',s.mv_lead_actor],['제작사',s.mv_production_company],['배급사',s.mv_distribution_company],['기획사',s.mv_agency],['사업자등록번호',s.mv_business_reg_no],['사용 목적',s.mv_usage],['희망 등급',s.mv_desired_rating],['작곡',s.mv_composer],['작사',s.mv_lyricist],['편곡',s.mv_arranger],['줄거리',s.mv_storyline],['메모',s.mv_memo],['가사',currentText(s.mv_lyrics, s.original_lyrics)]];
  return entries.map(([key,val]) => `${key}\n${value(val, '(미입력)')}`).join('\n\n');
}
function fileRow(name, meta, symbol = '▱', badge = '') { return `<div class="file-row"><span class="file-symbol">${symbol}</span><div class="file-text"><div class="file-name">${e(name)}</div><div class="file-meta">${e(meta)}</div></div>${badge}</div>`; }
function materialsMarkup(d) {
  if (isManual(d)) return manualMaterialsMarkup(d);
  const files = d.assets?.length ? d.assets : (d.files || []), local = d.localAttachments || [], s = d.submission;
  const email = s.files_submitted_by_email || d.mediaDelivery?.email || d.delivery?.email || s.files_delivery_method === 'EMAIL' || s.file_delivery_method === 'EMAIL' || s.mv_delivery_method === 'email' || s.audio_delivery_method === 'email' || s.mv_file_delivery_method === 'EMAIL' || files.some(f => f.deliveryStatus === 'email' || f.delivery_status === 'EMAIL' || String(f.file_path || '').startsWith('email:'));
  return `<section class="section-block"><div class="section-top"><h3>서비스에 업로드된 자료</h3><span>${files.length}개</span></div>${email ? '<div class="notice">이메일로 전달된 자료가 있습니다. 이메일에서 파일을 내려받은 뒤 아래에서 이 신청에 연결해 주세요.</div>' : ''}<div class="file-list">${files.length ? files.map(f => fileRow(f.original_name || f.name || f.kind || '업로드 파일', [f.kind || f.type, fileSize(f.size || f.bytes), f.deliveryStatus || f.delivery_status].filter(Boolean).join(' · '), f.kind?.includes('VIDEO') || f.kind?.includes('MV') ? '▷' : '▱')).join('') : '<div class="notice">업로드된 파일을 찾지 못했습니다. 이메일 전달 여부와 신청 내용을 확인하세요.</div>'}</div><p class="helper">원본 다운로드를 누르면 업로드된 음원·영상과 첨부 자료를 작업 폴더에 저장합니다.</p></section><hr class="section-divider"><section class="section-block"><div class="section-top"><h3>이메일 등으로 받은 파일</h3><span>Mac에서 추가</span></div><div class="file-list">${local.map(f => fileRow(f.name || f.original_name, [fileSize(f.bytes || f.size), formatDate(f.createdAt, true)].filter(Boolean).join(' · '), '↓', '<span class="badge neutral">로컬 보관</span>')).join('')}</div><label class="button secondary" style="margin-top:12px;cursor:pointer">＋ 받은 파일 연결<input id="local-attachments" type="file" multiple hidden></label><p class="helper">이 Mac에서 받은 원본을 선택하면 해당 신청 폴더에 사본을 보관합니다.</p><div id="attachment-progress" class="helper" role="status"></div></section><hr class="section-divider"><section class="section-block"><div class="section-top"><h3>${s.type === 'MV_DISTRIBUTION' ? '영등위 입력용 정보' : s.type === 'MV_BROADCAST' ? '방송 심의 입력용 정보' : '신청 정보 빠른 복사'}</h3><span>문서 수정 내용 반영</span></div><div class="copy-box"><pre>${e(copyText(d))}</pre><button class="button secondary small" data-action="copy-info">전체 내용 복사</button></div></section>${s.type === 'ALBUM' && d.tracks.length ? `<section class="section-block"><div class="section-top"><h3>트랙 구성</h3><span>${d.tracks.length}곡</span></div><div class="file-list">${d.tracks.map(t => fileRow(`${String(t.track_no || '').padStart(2,'0')} ${t.track_title || '(곡명 미입력)'}`, `작사 ${value(t.lyricist)} · 작곡 ${value(t.composer)}`, '♪', t.is_title ? '<span class="badge">TITLE</span>' : '')).join('')}</div></section>` : ''}`;
}
function editMarkup(d) {
  const s = d.submission, album = s.type === 'ALBUM';
  return `<form id="edit-form"><div class="notice good">생성 문서에 사용할 내용을 이 Mac에서 보완합니다. 저장 후 자료를 다시 생성하면 수정 내용을 적용한 새 기록이 만들어집니다.</div><h3>기본 정보</h3><div class="field-grid">${inputField('sub_title', album ? '앨범명' : '작품명', s.title)}${inputField('sub_artist_name','아티스트',s.artist_name)}${inputField('sub_release_date','발매일',String(s.release_date || '').slice(0,10),'date')}${inputField('sub_genre','장르',s.genre)}${inputField(`sub_${album ? 'production_company' : 'mv_production_company'}`,'제작사',album ? s.production_company : s.mv_production_company)}${inputField(`sub_${album ? 'distributor' : 'mv_distribution_company'}`,'유통 / 배급사',album ? s.distributor : s.mv_distribution_company)}</div>${isManual(d) ? `<hr class="section-divider"><h3>신청자 연락처</h3><div class="field-grid">${inputField('sub_applicant_name','신청자',s.applicant_name)}${inputField('sub_applicant_phone','연락처',s.applicant_phone,'tel')}${inputField('sub_applicant_email','이메일',s.applicant_email,'email',true)}</div>` : ''}<hr class="section-divider">${album ? `<h3>WBS 신청곡</h3><p class="helper">최대 3곡을 지정합니다. 선택하지 않으면 문서 생성 규칙에 따라 대표곡을 사용합니다.</p><div class="checklist" style="margin-top:12px;margin-bottom:24px">${d.tracks.map(t => `<label class="check-item"><input type="checkbox" name="wbs_track_numbers" value="${e(t.track_no)}"${(s.wbs_track_numbers || []).includes(Number(t.track_no)) ? ' checked' : ''}><span>${e(t.track_no)}. ${e(t.track_title || '곡명 미입력')}</span></label>`).join('')}</div><div class="section-top"><h3>트랙 · 가사</h3><button class="button secondary small" type="button" data-action="add-track">＋ 트랙 추가</button></div>${d.tracks.length ? d.tracks.map((t,i) => `<details class="track-editor"${i === 0 ? ' open' : ''}><summary>${e(String(t.track_no || i + 1).padStart(2,'0'))} · ${e(value(t.track_title,'곡명 미입력'))}</summary><div class="field-grid">${inputField(`track_${i}_track_no`,'트랙 번호',t.track_no || i+1,'number')}${inputField(`track_${i}_track_title`,'곡명',t.track_title)}${inputField(`track_${i}_featuring`,'피처링',t.featuring)}${inputField(`track_${i}_lyricist`,'작사',t.lyricist)}${inputField(`track_${i}_composer`,'작곡',t.composer)}${inputField(`track_${i}_arranger`,'편곡',t.arranger)}${inputField(`track_${i}_performer`,'실연자',t.performer)}</div><label class="track-title-check"><input type="checkbox" name="track_${i}_is_title"${t.is_title ? ' checked' : ''}> 타이틀곡</label><label class="track-title-check"><input type="checkbox" name="track_${i}_is_instrumental"${t.is_instrumental || t.instrumental_confirmed ? ' checked' : ''}> 확인된 연주곡 / Inst. (가사 없음)</label><label class="field" style="margin-top:16px"><span>가사 원문</span><textarea class="lyrics" name="track_${i}_lyrics">${e(currentText(t.lyrics, t.original_lyrics))}</textarea></label><label class="field" style="margin-top:13px"><span>한국어 번역 · 확인된 번역 원문</span><textarea name="track_${i}_translated_lyrics">${e(currentText(t.translated_lyrics, t.korean_lyrics_translation))}</textarea></label>${String(t.id).startsWith('local-') ? `<button class="button danger small" style="margin-top:12px" type="button" data-remove-track="${e(t.id)}">추가한 트랙 삭제</button>` : ''}</details>`).join('') : '<div class="notice">신청에 등록된 트랙이 없습니다. 원본 신청 데이터를 확인하세요.</div>'}` : `<h3>뮤직비디오 정보</h3><div class="field-grid">${[['mv_song_title_official','공식 곡명'],['mv_song_title_en','영문 곡명'],['mv_album_title','앨범명'],['mv_runtime','상영 시간'],['mv_format','영상 형식'],['mv_director','감독'],['mv_lead_actor','주연'],['mv_agency','기획사'],['mv_business_reg_no','사업자등록번호'],['mv_usage','사용 목적'],['mv_desired_rating','신청 희망등급'],['mv_composer','작곡'],['mv_lyricist','작사'],['mv_arranger','편곡']].map(([key,title]) => inputField(`sub_${key}`,title,s[key])).join('')}${inputField('sub_mv_production_date','제작일',String(s.mv_production_date || '').slice(0,10),'date')}${inputField('sub_mv_storyline','줄거리',s.mv_storyline,'textarea',true)}${inputField('sub_mv_lyrics','가사',currentText(s.mv_lyrics, s.original_lyrics),'textarea',true)}${inputField('sub_korean_lyrics_translation','제공된 한국어 번역',s.korean_lyrics_translation,'textarea',true)}${inputField('sub_mv_memo','신청 메모',s.mv_memo,'textarea',true)}</div>`}<div class="save-bar"><span class="save-status" id="edit-save-status">로컬 문서용 정보</span><button class="button primary" type="submit">수정 내용 저장</button></div></form>`;
}
function historyMarkup(d) {
  const generations = d.generations || [];
  return generations.length ? `<div class="button-row" style="margin-bottom:20px"><button class="button secondary small" data-action="open-latest">최신 생성 폴더 열기 ↗</button></div>${generations.slice().reverse().map(g => `<div class="generation-item"><div class="generation-heading"><strong>${e(formatDate(g.createdAt || g.created_at, true))}</strong><small>${e(shortId(g.id))}</small></div>${d.submission.type === 'ALBUM' && isManual(d) && g.artifacts?.find(a => /\.zip$/i.test(a.name || a.filename)) ? (() => { const zip = (d.submission.type !== 'ALBUM' && g.artifacts.find(a => /전체작업자료.*\.zip$/i.test(a.name || a.filename))) || g.artifacts.find(a => /\.zip$/i.test(a.name || a.filename)); return `<button class="button accent manual-download" data-artifact="${e(zip.name || zip.filename)}" data-generation="${e(g.id)}">↓ ${d.submission.type === 'ALBUM' ? '전체 심의서류 다운로드 (DOCX ZIP)' : /전체작업자료/.test(zip.name || zip.filename) ? '가사·복사자료 전체 다운로드' : '가사 문서 다운로드 (DOCX ZIP)'}</button>`; })() : ''}${visibleArtifacts(d,g).map(a => `<button class="artifact-button" data-artifact="${e(a.name || a.filename)}" data-generation="${e(g.id)}"><span>▱ ${e(a.name || a.filename)}</span><small>${e(fileSize(a.bytes || a.size))} ↓</small></button>`).join('')}<p class="helper">제출 전 Word 또는 한글에서 문서 내용과 페이지 구성을 확인하세요.</p></div>`).join('')}` : '<div class="empty-list">아직 생성한 자료가 없습니다.<br>위의 ‘심의 자료 생성’을 눌러 시작하세요.</div>';
}
function queueScreen() {
  screen.innerHTML = `${heading('작업 현황','다운로드와 문서 생성 진행 상황을 확인하세요.')}<section class="panel"><div class="panel-head"><h2>작업 기록 <span class="count">${jobs().length}</span></h2><span class="toolbar-note">진행 중인 작업은 자동으로 갱신됩니다</span></div><div class="table-wrap"><table class="jobs-table"><thead><tr><th>작업</th><th>신청</th><th>상태</th><th>내용</th><th>시작 시간</th></tr></thead><tbody>${jobs().slice().map(j => { const c = cases().find(c => c.id === j.caseId); return `<tr><td>${e(({generate:'문서 생성',download:'원본 다운로드',sync:'신청 동기화',backup:'백업'})[j.kind] || j.kind)}</td><td>${c ? `<button class="inline-link" data-case="${e(c.id)}">${e(c.title || '제목 미입력')}</button><small>${e(c.artist_name)}</small>` : '전체'}</td><td><span class="badge ${['failed','FAILED','error'].includes(j.status) ? 'red' : activeJob(j) ? 'blue' : ''}">${e(({queued:'대기',running:'진행 중',completed:'완료',succeeded:'완료',done:'완료',failed:'실패'})[String(j.status).toLowerCase()] || j.status)}</span></td><td class="job-message">${e(j.message || j.error || '')}</td><td>${e(formatDate(j.createdAt, true))}</td></tr>`; }).join('')}</tbody></table>${!jobs().length ? '<div class="empty-list">작업을 시작하면 여기에 진행 상황이 표시됩니다.</div>' : ''}</div></section>`;
}
function historyScreen() { ui.nav = 'cases'; ui.tab = 'documents'; ui.docTab = 'history'; casesScreen(); }
function settingsScreen() {
  const s = ui.data.settings || {}, c = ui.data.connection || {};
  screen.innerHTML = `${heading('데스크 설정','문서 담당자와 이 Mac의 작업 방식을 설정합니다.',trashButton())}<form id="settings-form" class="panel settings-panel"><section class="settings-section"><h2>서비스 연결</h2><p>신청을 조회하고, 심의 결과 저장 시 관리자 페이지와 고객 결과 페이지에 반영합니다.</p><div class="connection-detail"><span>${c.connected ? '✓' : '○'}</span><div>${e(c.message || (c.connected ? '온사이드 서비스에 연결되어 있습니다.' : c.configured ? '연결 상태를 확인해 주세요.' : '서비스 연결 설정이 필요합니다.'))}<div class="helper">마지막 동기화 ${e(formatDate(ui.data.lastSync, true))}</div></div></div></section><section class="settings-section"><h2>심의 자료 담당자</h2><p>생성하는 심의 요청서와 방송사 신청서의 담당자 정보에 사용합니다.</p><div class="field-grid">${inputField('managerName','담당자 이름',s.managerName)}${inputField('companyName','심의 담당 회사명',s.companyName)}${inputField('managerPhone','담당자 연락처',s.managerPhone,'tel')}${inputField('managerEmail','담당자 이메일',s.managerEmail,'email')}</div></section><section class="settings-section"><h2>자동 작업</h2><label class="toggle-row"><span>새 신청 자동 가져오기<small>프로그램이 실행되는 동안 5분마다 신청 내역을 확인합니다.</small></span><input type="checkbox" name="autoSync"${s.autoSync !== false ? ' checked' : ''} aria-label="새 신청 자동 가져오기"></label><label class="toggle-row"><span>새 신청의 문서 자동 생성<small>새로 접수된 결제 완료 신청의 문서만 자동 생성합니다. 결과 이메일은 미리보기 확인 후 발송 버튼을 누를 때만 요청합니다. 생성 후 업로드된 원본 음원·영상도 작업 폴더에 저장합니다.</small></span><input type="checkbox" name="autoGenerate"${s.autoGenerate ? ' checked' : ''} aria-label="새 신청 문서 자동 생성"></label></section><section class="settings-section"><h2>자료 저장과 백업</h2><p>생성 문서, 받은 원본, 진행 기록을 이 Mac에 보관합니다.</p><div class="path-line">${e(ui.data.outputRoot || '이 Mac의 온사이드 심의 데스크 작업 폴더')}</div><div class="button-row" style="margin-top:15px"><button type="button" class="button secondary" data-action="backup">진행 기록 백업</button><button type="button" class="button secondary" data-action="open-root">저장 폴더 열기 ↗</button></div><p class="helper">백업에는 관리 기록과 생성 문서가 포함됩니다. 대용량 원본 음원·영상과 연결 키는 제외되므로 별도로 보관하세요.</p></section><div class="save-bar"><span class="save-status">설정은 이 Mac에 적용됩니다.</span><button class="button primary" type="submit">설정 저장</button></div></form>`;
}
function render() {
  if (ui.nav === 'manual' && ui.detail && !isManual(ui.detail)) { ui.selected = null; ui.detail = null; ui.savedDetail = null; ui.tab = 'overview'; }
  if (ui.nav === 'cases' && isManual(ui.detail)) { ui.selected = null; ui.detail = null; ui.savedDetail = null; ui.tab = 'overview'; }
  document.getElementById('page-label').textContent = { cases: '신청 관리', manual: '관리자 수동 작업', queue: '작업 현황', settings: '데스크 설정', trash: '목록 휴지통' }[ui.nav];
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === ui.nav));
  document.querySelectorAll('[data-manual-type]').forEach(b => b.classList.toggle('active', ui.nav === 'manual' && b.dataset.manualType === ui.manualType));
  document.getElementById('manual-subnav').hidden = ui.nav !== 'manual';
  document.getElementById('refresh-top').hidden = ui.nav === 'manual';
  ({cases:casesScreen, manual:manualScreen, queue:queueScreen, settings:settingsScreen, trash:trashScreen})[ui.nav](); headerRender();
}
function headerRender() {
  const c = ui.data.connection || {}, badge = document.getElementById('connection-badge'); badge.className = `connection-badge ${c.connected ? 'online' : 'offline'}`; badge.innerHTML = `<i></i>${e(ui.nav === 'manual' ? '이 Mac에 저장' : c.connected ? '온사이드 연결됨' : c.configured ? '연결 확인 필요' : '연결 설정 필요')}`;
  document.getElementById('nav-count').textContent = serviceCases().length; document.getElementById('manual-count').textContent = manualCases().length; document.getElementById('job-count').textContent = jobs().filter(activeJob).length;
  globalAlert(ui.nav === 'manual' ? '' : ui.data.syncError ? `신청 동기화 확인: ${typeof ui.data.syncError === 'string' ? ui.data.syncError : ui.data.syncError.message || '서비스 연결을 확인해 주세요.'}` : !c.configured ? '서비스 연결 정보가 설정되지 않았습니다. 데스크 설치 안내의 연결 설정을 확인해 주세요.' : '');
}
async function refresh(initial = false) {
  try {
    const previousJobs = ui.data?.jobs || [], previousCases = ui.data?.cases || [], next = await api('/api/state'); ui.data = next; headerRender();
    if (ui.selected && next.trashCases?.some(c => c.id === ui.selected)) { ++ui.requestSequence; ++ui.resultSequence; clearEmailPreview(); ui.selected = null; ui.detail = null; ui.savedDetail = null; ui.resultData = null; ui.dirty = false; render(); }
    if (initial) render(); else if (['queue','trash'].includes(ui.nav)) render(); else if (['cases','manual'].includes(ui.nav)) { renderList(); const done = previousJobs.some(j => j.caseId === ui.selected && activeJob(j) && next.jobs?.find(n => n.id === j.id && !activeJob(n))); const changedGeneration = ui.selected && (next.cases?.find(c => c.id === ui.selected)?.latestGeneration?.id || null) !== (ui.detail?.generations?.at(-1)?.id || null); const previousCase = previousCases.find(c => c.id === ui.selected), nextCase = next.cases?.find(c => c.id === ui.selected); const sourceUpdated = previousCase && nextCase && (previousCase.updated_at !== nextCase.updated_at || previousCase.status !== nextCase.status); if ((done || changedGeneration || sourceUpdated) && !ui.dirty && !ui.publishing && !ui.translating) await loadDetail(ui.selected, false); if (ui.tab === 'results' && !isManual(ui.detail) && !ui.dirty && !ui.publishing) await loadResults(false); }
  } catch (error) {
    if (initial) screen.innerHTML = `${heading('데스크에 연결할 수 없습니다','프로그램이 실행 중인지 확인하고 다시 시도해 주세요.')}<div class="notice error">${e(error.message)}</div><button class="button primary" data-action="retry">다시 연결</button>`;
    else globalAlert(`프로그램 연결 확인: ${error.message}. 저장된 화면을 유지하고 있습니다.`);
  } finally { schedulePoll(); }
}
function schedulePoll() { clearTimeout(ui.pollTimer); ui.pollTimer = setTimeout(() => refresh(), jobs().some(activeJob) ? 3000 : 15000); }
async function loadDetail(id, showLoading = true) {
  const sequence = ++ui.requestSequence; ui.selected = id; if (showLoading) { ui.loadingDetail = true; detailRender(); renderList(); }
  if (ui.detail?.submission?.id !== id) { clearEmailPreview(); ui.resultData = null; ui.resultNotice = null; ui.resultError = ''; ui.resultStationId = null; ui.resultDirtyForm = null; ui.bulkSelected = []; ui.bulkStatus = 'NOT_SENT'; ui.bulkAgeRating = ''; ui.certificateFile = null; ui.translationNotice = null; }
  try { const detail = await api(`/api/cases/${encodeURIComponent(id)}`); if (sequence !== ui.requestSequence) return; ui.detail = detail; ui.savedDetail = structuredClone(detail); ui.loadingDetail = false; detailRender(); if (ui.tab === 'results' && !isManual(detail)) await loadResults(true); }
  catch (err) { if (sequence !== ui.requestSequence) return; ui.loadingDetail = false; toast(err.message, true); if (!ui.detail || ui.detail.submission?.id !== id) ui.detail = null; detailRender(); }
}
async function saveLocal(patch, message = '저장했습니다.', shouldRender = true, preserveDirty = false) {
  const result = await api(apiPath('/local'), { method: 'PATCH', body: patch });
  if (ui.detail) { ui.detail.local = result.local || { ...ui.detail.local, ...patch }; ui.savedDetail = structuredClone(ui.detail); }
  const c = cases().find(c => c.id === ui.selected); if (c) c.local = ui.detail?.local || patch;
  if (!preserveDirty) ui.dirty = false;
  if (isManual(ui.detail) && (patch.overrides || 'reviewAcknowledgedRevision' in patch)) { await loadDetail(ui.selected, false); if (c) Object.assign(c, { title: ui.detail.submission.title, artist_name: ui.detail.submission.artist_name, applicant_name: ui.detail.submission.applicant_name }); }
  if (shouldRender) detailRender(); renderList(); toast(message); return result;
}
async function downloadArtifact(generation, name) {
  const a = document.createElement('a');
  a.href = `/api/artifacts/${encodeURIComponent(ui.selected)}/${encodeURIComponent(generation)}/${encodeURIComponent(name)}`;
  a.download = name.split('/').pop(); document.body.append(a); a.click(); a.remove();
}
function editedOverrides(form) {
  const data = new FormData(form), original = effective();
  const overrides = { ...original.local.overrides, submission: { ...original.local.overrides?.submission }, tracks: [...(original.local.overrides?.tracks || [])] };
  for (const [key,val] of data.entries()) if (key.startsWith('sub_')) overrides.submission[key.slice(4)] = String(val);
  if (original.submission.type === 'ALBUM') {
    const visible = original.tracks.map((track,i) => {
      const patch = { ...(overrides.tracks.find(t => t.id === track.id) || {}), id: track.id };
      for (const [key,val] of data.entries()) if (key.startsWith(`track_${i}_`)) patch[key.slice(`track_${i}_`.length)] = String(val);
      patch.track_no = Number(data.get(`track_${i}_track_no`) || track.track_no || i + 1);
      patch.is_title = data.has(`track_${i}_is_title`); patch.is_instrumental = data.has(`track_${i}_is_instrumental`); patch.instrumental_confirmed = patch.is_instrumental; return patch;
    });
    overrides.tracks = [...overrides.tracks.filter(t => t._deleted && String(t.id).startsWith('local-')), ...visible];
    overrides.submission.wbs_track_numbers = data.getAll('wbs_track_numbers').map(Number).map(n => visible.find((t,i) => Number(original.tracks[i].track_no) === n)?.track_no || n);
    if (overrides.submission.wbs_track_numbers.length > 3) throw new Error('WBS 신청곡은 최대 3곡을 선택해 주세요.');
  }
  return overrides;
}
function addLocalTrack() {
  const form = document.getElementById('edit-form'); if (!form) return;
  const overrides = editedOverrides(form), all = effective().tracks;
  overrides.tracks.push({ id: `local-${crypto.randomUUID()}`, track_no: Math.max(0,...all.map(t => Number(t.track_no) || 0))+1, track_title: '', composer: '', lyricist: '', arranger: '', lyrics: '', is_title: false, is_instrumental: false });
  ui.detail.local = { ...ui.detail.local, overrides }; ui.dirty = true; detailRender();
  const details = document.querySelectorAll('.track-editor'), last = details[details.length-1]; if (last) { last.open = true; last.querySelector('[name$="_track_title"]')?.focus(); }
}
function removeLocalTrack(id) {
  if (!id.startsWith('local-')) return;
  const overrides = editedOverrides(document.getElementById('edit-form'));
  const track = overrides.tracks.find(t => t.id === id); if (track) { track._deleted = true; overrides.submission.wbs_track_numbers = (overrides.submission.wbs_track_numbers || []).filter(n => n !== track.track_no); }
  ui.detail.local = { ...ui.detail.local, overrides }; ui.dirty = true; detailRender();
}

const REVIEW_STATUS = { NOT_SENT: '접수예정', SENT: '접수완료', APPROVED: '적격', REJECTED: '부적격', NEEDS_FIX: '보완 요청' };
const reviewStatus = status => status === 'RECEIVED' ? 'SENT' : Object.hasOwn(REVIEW_STATUS,status) ? status : 'NOT_SENT';
const RATINGS = { ALL: '전체 시청가', '12': '12세 이상', '15': '15세 이상', '19': '19세 이상' };
const ONLINE_RATINGS = { ...RATINGS, ALL: '전체 관람가', REJECT: '심의 반려' };
function ratingLabel(rating) { const labels = (ui.resultData?.type || ui.detail?.submission?.type) === 'MV_BROADCAST' ? RATINGS : ONLINE_RATINGS; return labels[String(rating) === '18' ? '19' : String(rating)] || rating || '등급 미입력'; }
function selectField(name, title, options, selected, placeholder = '') {
  return `<label class="field"><span>${e(title)}</span><select name="${e(name)}"${placeholder ? ' required' : ''}>${placeholder ? `<option value="">${e(placeholder)}</option>` : ''}${Object.entries(options).map(([key,text]) => `<option value="${e(key)}"${String(selected ?? '') === key ? ' selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
}
function notificationMarkup(notification, explicitMessage = '') {
  if (!notification && !explicitMessage) return '';
  const outcome = notification || {}, parts = [];
  if (Number(outcome.deliveredCount) > 0) parts.push('안내 메일을 발송 서버가 접수했습니다.');
  if (Number(outcome.queuedCount) > 0) parts.push('안내 메일이 발송 대기 중이며 자동 재시도됩니다.');
  if (Number(outcome.uncertainCount) > 0) parts.push('접수 여부 확인 필요: 발송 이력을 확인한 뒤 다시 요청해 주세요.');
  else if (Number(outcome.failedCount) > 0) parts.push('결과는 저장되었으나 안내 메일 발송이 실패했습니다.');
  if (Number(outcome.skippedCount) > 0) parts.push('결과는 저장되었으나 이메일 발송이 보류되었습니다.');
  if (outcome.pendingAssets) parts.push('필요한 자료가 준비되면 3종 파일을 첨부해 안내할 수 있습니다.');
  if (outcome.warning) parts.push(outcome.warning);
  const text = [...new Set([explicitMessage, ...parts].filter(Boolean))].join(' ');
  if (!text) return '';
  return `<div class="notice ${outcome.uncertainCount || outcome.failedCount || outcome.warning || outcome.skippedCount || outcome.pendingAssets ? '' : 'good'}" role="status"><strong>${e(explicitMessage ? '처리 결과' : '이메일 안내 상태')}</strong><p>${e(text)}</p>${outcome.deliveredCount ? '<small>발송 서버 접수는 수신함 도착을 보장하지 않습니다.</small>' : ''}</div>`;
}
function resultAssetsMarkup(data) {
  const assets = data.assets || {}, rawItems = Array.isArray(assets.items) ? assets.items : [];
  const definitions = [['ratingImage','등급 표시 이미지'],['usageGuide','등급 사용법 예시 PDF'],['certificate','영등위 발급 필증']];
  const items = definitions.map(([kind,label]) => {
    const item = rawItems.find(x => x.kind === kind) || assets[kind] || {};
    return { ...item, kind, label: item.label || label, available: item.available === true || item.ready === true };
  });
  return `<section class="result-assets"><div class="section-top"><h3>고객에게 제공하는 파일 3종</h3><span class="badge ${assets.ready ? '' : 'amber'}">${assets.ready ? '전체 준비됨' : '자료 확인 필요'}</span></div><div class="file-list">${items.map(item => `<div class="file-row"><span class="file-symbol">${item.available ? '✓' : '○'}</span><div class="file-text"><div class="file-name">${e(item.label)}</div><div class="file-meta">${e(item.name || (item.available ? '개인 결과 페이지 및 이메일 첨부에 사용' : '아직 준비되지 않았습니다'))}</div></div>${item.downloadUrl?.startsWith('/api/') ? `<a class="button secondary small" href="${e(item.downloadUrl)}" download>받기</a>` : `<span class="badge ${item.available ? '' : 'amber'}">${item.available ? '준비됨' : '미준비'}</span>`}</div>`).join('')}</div>${assets.missing?.length ? `<p class="helper">확인할 항목: ${e(assets.missing.join(' · '))}</p>` : ''}<p class="helper">등급과 필증이 준비되면 고객 개인 결과 페이지에서 3종 파일을 받을 수 있고, 아래에서 결과 이메일을 발송할 때 함께 첨부됩니다.</p></section>`;
}
function stationTracks(data, station) {
  const ids = Array.isArray(station?.trackIds) ? new Set(station.trackIds) : null;
  return (data.tracks || []).filter(t => t.id && !String(t.id).startsWith('local-') && (!ids || ids.has(t.id)));
}
function resultTrackMarkup(data, review, station) {
  const tracks = stationTracks(data,station);
  if (!tracks.length) return '<p class="helper">방송사 단위로 심의 결과를 저장합니다.</p>';
  let previous = review.track_results || review.track_results_json || [];
  if (typeof previous === 'string') { try { previous = JSON.parse(previous); } catch { previous = []; } }
  if (!Array.isArray(previous)) previous = [];
  return `${station?.code === 'WBS' && tracks.length > 3 ? '<div class="notice">WBS 심의곡 선택을 확인해야 합니다. 실제 신청한 최대 3곡만 최종 결과를 입력하고 나머지는 검토 중으로 유지하세요.</div>' : ''}<details class="track-result-details"${previous.length ? ' open' : ''}><summary>곡별 결과 입력 <span>${tracks.length}곡</span></summary><label class="check-item result-track-toggle"><input type="checkbox" name="includeTrackResults"${previous.length ? ' checked' : ''}><span>방송사 진행 상황과 함께 곡별 결과 저장</span></label><div class="track-result-list">${tracks.map((track,index) => { const existing = previous.find(t => (t.trackId || t.track_id) === track.id || Number(t.trackNo || t.track_no) === Number(track.track_no)); return `<div class="track-result-row"><span><small>${e(String(track.track_no || index + 1).padStart(2, '0'))}</small> ${e(track.track_title || track.track_title_official || '곡명 미입력')}</span><select name="trackResult_${e(track.id)}" aria-label="${e(track.track_title || `${index + 1}번 곡`)} 결과">${Object.entries({PENDING:'검토 중',APPROVED:'적격',REJECTED:'부적격'}).map(([key,text]) => `<option value="${key}"${(existing?.status || 'PENDING') === key ? ' selected' : ''}>${text}</option>`).join('')}</select></div>`; }).join('')}</div><p class="helper">서비스에 등록된 실제 트랙의 결과를 입력합니다. 검토 중인 곡은 ‘검토 중’으로 남겨 두세요.</p></details>`;
}
function bulkStationMarkup(data) {
  const stations = data.stations || [];
  ui.bulkSelected = ui.bulkSelected.filter(id => stations.some(st => st.id === id));
  const broadcast = data.type === 'MV_BROADCAST';
  return `<section class="bulk-station-section"><div class="section-top"><h3>방송사 일괄 저장</h3><span id="bulk-selection-count">${ui.bulkSelected.length}개 선택</span></div><form id="bulk-station-form"><label class="check-item bulk-all"><input id="bulk-all" type="checkbox"${stations.length && stations.length === ui.bulkSelected.length ? ' checked' : ''}><span>신청 방송사 전체 선택</span></label><div class="bulk-station-choices">${stations.map(st => `<label><input type="checkbox" name="bulkStation" value="${e(st.id)}"${ui.bulkSelected.includes(st.id) ? ' checked' : ''}><span><strong>${e(st.code || st.name)}</strong><small>${e(REVIEW_STATUS[reviewStatus(st.review?.status)])}</small></span></label>`).join('')}</div><div class="field-grid">${selectField('bulkStatus','선택 방송사에 적용할 결과',REVIEW_STATUS,ui.bulkStatus)}${broadcast ? selectField('bulkAgeRating','선택 방송사의 연령 등급',RATINGS,ui.bulkAgeRating,'등급 선택') : ''}</div><p class="helper">선택한 방송사 전체에 같은 결과를 저장합니다.${broadcast ? ' 적격은 연령 등급을 함께 지정합니다.' : ' 곡별 결과도 선택한 전체 결과에 맞춥니다.'} 고객 안내 메모는 유지하며, 이메일은 아래에서 별도로 발송합니다.</p><div class="publish-bar"><span id="bulk-save-summary">${ui.bulkSelected.length}개 방송사 · ${e(REVIEW_STATUS[ui.bulkStatus])}</span><button class="button primary" type="submit"${!ui.bulkSelected.length || ui.publishing ? ' disabled' : ''}>선택 방송사 일괄 저장</button></div></form></section>`;
}
function updateBulkControls(changed) {
  const form = document.getElementById('bulk-station-form'); if (!form) return;
  if (changed?.id === 'bulk-all') form.querySelectorAll('[name=bulkStation]').forEach(el => { el.checked = changed.checked; });
  ui.bulkSelected = [...form.querySelectorAll('[name=bulkStation]:checked')].map(el => el.value);
  ui.bulkStatus = form.elements.bulkStatus.value; ui.bulkAgeRating = form.elements.bulkAgeRating?.value || '';
  const all = form.querySelector('#bulk-all'), count = form.querySelectorAll('[name=bulkStation]').length;
  all.checked = !!count && ui.bulkSelected.length === count; all.indeterminate = ui.bulkSelected.length > 0 && ui.bulkSelected.length < count;
  const countLabel = document.getElementById('bulk-selection-count'); if (countLabel) countLabel.textContent = `${ui.bulkSelected.length}개 선택`;
  const summary = document.getElementById('bulk-save-summary'); if (summary) summary.textContent = `${ui.bulkSelected.length}개 방송사 · ${REVIEW_STATUS[ui.bulkStatus]}`;
  const submit = form.querySelector('[type=submit]'); submit.disabled = !ui.bulkSelected.length || ui.publishing || ui.resultData?.canWrite === false || (!!ui.resultDirtyForm && ui.resultDirtyForm !== form.id);
  if (form.elements.bulkAgeRating) { form.elements.bulkAgeRating.required = ui.bulkStatus === 'APPROVED'; form.elements.bulkAgeRating.disabled = ui.bulkStatus !== 'APPROVED' || ui.publishing || ui.resultData?.canWrite === false || (!!ui.resultDirtyForm && ui.resultDirtyForm !== form.id); }
}
function bulkResultBody(form) {
  const fields = new FormData(form), ids = fields.getAll('bulkStation'), data = ui.resultData;
  if (!data || !ids.length) throw new Error('일괄 저장할 방송사를 선택해 주세요.');
  const status = String(fields.get('bulkStatus') || '');
  const stations = ids.map(id => { const station = data.stations.find(st => st.id === id); if (!station) throw new Error('방송사 목록이 바뀌었습니다. 최신 결과를 다시 가져오세요.'); return { stationId: station.id, reviewId: station.review?.id || null, expectedUpdatedAt: station.review?.updated_at ?? null }; });
  return { operation:'bulk-stations',stations,status,...(data.type === 'MV_BROADCAST' ? {ageRating:status === 'APPROVED' ? String(fields.get('bulkAgeRating') || '') : null} : {}) };
}
function stationEditorMarkup(data) {
  const stations = data.stations || [];
  if (!stations.length) return '<div class="notice">이 신청에 연결된 방송사를 확인하지 못했습니다. 신청 패키지와 방송사 선택 정보를 확인한 후 새로고침해 주세요.</div>';
  const selected = stations.find(st => st.id === ui.resultStationId) || stations[0]; ui.resultStationId = selected.id;
  const review = selected.review || {}, broadcast = data.type === 'MV_BROADCAST';
  const rating = String(review.age_rating || review.rating || '').replace(/^18$/, '19');
  return `${bulkStationMarkup(data)}<div class="station-picker" aria-label="신청 방송사 선택">${stations.map(st => `<button class="station-choice${st.id === selected.id ? ' selected' : ''}" data-result-station="${e(st.id)}" aria-pressed="${st.id === selected.id}"><strong>${e(st.code || st.name)}</strong><span>${e(REVIEW_STATUS[reviewStatus(st.review?.status)])}</span>${st.review?.age_rating ? `<small>${e(ratingLabel(st.review.age_rating))}</small>` : ''}</button>`).join('')}</div><form id="station-result-form" data-station="${e(selected.id)}"><div class="section-top"><h3>${e(selected.name || selected.code)} 결과 입력</h3><span>${review.updated_at ? `${e(formatDate(review.updated_at, true))} 저장` : '첫 입력'}</span></div><div class="field-grid">${selectField('status','진행 상황 / 심의 결과',REVIEW_STATUS,reviewStatus(review.status))}${broadcast ? selectField('ageRating','방송 연령 등급',RATINGS,rating,'등급 선택') : ''}${inputField('resultNote','고객에게 공개할 안내',review.result_note || '', 'textarea', true)}</div>${broadcast ? '<p class="helper">적격 결과는 연령 등급을 함께 저장합니다. 방송사마다 각각 입력하며, 다른 방송사의 등급은 바뀌지 않습니다.</p>' : resultTrackMarkup(data,review,selected)}<div class="publish-bar"><span>이 방송사의 결과를 관리자 페이지와<br>고객 결과 페이지에 저장합니다.</span><button class="button primary" type="submit"${ui.publishing ? ' disabled' : ''}>${ui.publishing ? '저장 중…' : '방송사 결과 저장'}</button></div></form>`;
}
function onlineEditorMarkup(data) {
  const s = data.submission || {}, rating = String(s.mv_desired_rating || s.mv_rating || '').replace(/^18$/, '19');
  const certificate = data.assets?.items?.find(x => x.kind === 'certificate') || data.assets?.certificate || {};
  const certificateName = certificate.name || s.certificate_original_name || s.mv_certificate_filename;
  return `<form id="online-result-form"><div class="section-top"><h3>영등위 심의 결과</h3><span>서비스에 반영</span></div><div class="field-grid">${selectField('rating','확정된 관람 등급',ONLINE_RATINGS,rating,'등급 선택')}${inputField('resultMemo','고객에게 공개할 결과 안내',s.result_memo || s.resultMemo || '', 'textarea', true)}</div><div class="publish-bar"><span>확정 등급을 관리자 페이지와<br>고객 결과 페이지에 저장합니다.</span><button class="button primary" type="submit"${ui.publishing ? ' disabled' : ''}>${ui.publishing ? '저장 중…' : '등급 저장'}</button></div></form><hr class="section-divider"><form id="certificate-form"><div class="section-top"><h3>영등위 발급 필증</h3><span>${certificateName ? '등록된 필증 있음' : '필증 업로드 필요'}</span></div>${certificateName ? `<p class="current-certificate">현재 파일: <strong>${e(certificateName)}</strong></p>` : ''}<label class="certificate-picker"><span>필증 파일 선택</span><input id="certificate-file" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" aria-label="영등위 필증 파일"></label><p id="certificate-selection" class="helper">${ui.certificateFile ? `${e(ui.certificateFile.name)} · ${e(fileSize(ui.certificateFile.size))}` : 'PDF, PNG, JPG · 최대 20MB. 파일을 선택한 뒤 업로드 버튼을 눌러 주세요.'}</p><p class="helper">이메일 첨부는 등급 이미지·사용법 PDF·필증 3종 합계 18MB까지 지원합니다. 초과하면 파일 크기를 줄여 다시 등록하세요.</p><div class="publish-bar"><span>필증을 고객 결과 페이지에 등록합니다.<br>이메일은 아래에서 별도로 발송합니다.</span><button class="button primary" type="submit"${ui.publishing ? ' disabled' : ''}>${ui.publishing ? '업로드 중…' : '필증 업로드'}</button></div></form><hr class="section-divider">${resultAssetsMarkup(data)}`;
}
function savedResultsSummary(data) {
  if (data.type === 'MV_DISTRIBUTION') return `<div class="email-results-summary"><strong>저장된 영등위 결과</strong><span class="badge blue">${e(ratingLabel(data.submission?.mv_desired_rating || data.submission?.mv_rating))}</span></div>`;
  return `<div class="email-results-summary"><h4>저장된 방송사 전체 결과</h4>${(data.stations || []).map(st => `<div class="email-station-row"><strong>${e(st.code || st.name)}</strong><span class="badge ${st.review?.status === 'REJECTED' ? 'red' : 'neutral'}">${e(REVIEW_STATUS[reviewStatus(st.review?.status)])}</span>${st.review?.age_rating ? `<span class="badge blue">${e(ratingLabel(st.review.age_rating))}</span>` : ''}${st.review?.result_note ? `<p>${e(st.review.result_note)}</p>` : ''}</div>`).join('')}</div>`;
}
function emailSectionMarkup(data) {
  const preview = ui.emailPreview?.caseId === ui.selected ? ui.emailPreview : null;
  const recent = Array.isArray(data.notifications) ? data.notifications : [];
  const missing = Array.isArray(preview?.missingAssets) ? preview.missingAssets : [], warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  return `<section class="result-email" aria-labelledby="email-section-title"><h3 id="email-section-title">전체 결과 이메일 안내</h3><p class="helper">${data.type === 'MV_DISTRIBUTION' ? '등급과 필증을 저장한 뒤,' : '방송사별 결과를 모두 저장한 뒤,'} 고객에게 보낼 이메일을 확인하고 한 번에 발송하세요. 저장만으로는 이메일을 보내지 않습니다.</p>${savedResultsSummary(data)}<button class="button secondary" data-action="preview-email"${ui.publishing || ui.previewLoading || data.canWrite === false ? ' disabled' : ''}>${ui.previewLoading ? '이메일을 준비하는 중…' : '전체 결과 이메일 미리보기'}</button><div id="email-preview-region" aria-live="polite">${preview ? `<div class="email-preview"><div class="email-preview-heading"><h4>고객에게 발송할 이메일</h4><button class="inline-link" data-action="close-email-preview"${ui.publishing ? ' disabled' : ''}>미리보기 닫기</button></div><dl class="email-preview-meta"><div><dt>받는 사람</dt><dd>${e(preview.recipientMasked || '수신자 확인 필요')}</dd></div><div><dt>제목</dt><dd>${e(preview.subject)}</dd></div>${Number.isInteger(preview.attachmentCount) ? `<div><dt>첨부 자료</dt><dd>${preview.attachmentCount ? `${e(preview.attachmentCount)}개 파일` : '첨부 없음'}</dd></div>` : ''}</dl><iframe class="email-preview-frame" title="고객 결과 안내 이메일 미리보기" sandbox="" referrerpolicy="no-referrer" srcdoc="${e(preview.html)}"></iframe>${missing.length ? `<div class="notice">발송 전 확인할 항목: ${e(missing.join(' · '))}</div>` : ''}${warnings.length ? `<div class="notice">${warnings.map(e).join('<br>')}</div>` : ''}${preview.canSend === false ? '<div class="notice">아직 이메일을 보낼 수 없습니다. 결과와 필요한 파일을 준비한 뒤 미리보기를 다시 확인하세요.</div>' : ''}<p class="helper">${data.type === 'MV_DISTRIBUTION' ? '저장된 등급 안내와 결과 확인 버튼이 이메일에 포함됩니다.' : '저장된 모든 방송사의 현재 결과와 결과 확인 버튼이 이메일에 포함됩니다.'} 고객에게 다시 안내할 때도 새 미리보기를 확인하고 발송하세요.</p></div>` : ''}</div><div class="publish-bar email-send-bar"><span>${preview ? '현재 미리보기의 전체 결과를 고객 이메일로 보냅니다.' : '먼저 미리보기에서 최신 저장 결과와 받는 사람을 확인하세요.'}</span><button class="button primary" data-action="send-email"${ui.publishing || ui.dirty || preview?.canSend !== true ? ' disabled' : ''}>${ui.publishing ? '이메일 발송 요청 중…' : '이 내용으로 이메일 발송'}</button></div>${recent.length ? `<div class="notification-history"><h4>이메일 발송 이력</h4>${recent.slice(0,5).map(n => `<div><span class="badge ${['failed','uncertain'].includes(n.status) ? 'amber' : 'neutral'}">${e(({accepted:'발송 서버 접수',pending:'대기',sent:'발송 서버 접수',delivered:'수신 확인',queued:'대기',retry:'재시도 대기',sending:'전송 중',failed:'실패',uncertain:'접수 여부 확인 필요',skipped:'보류'})[n.status] || n.status)}</span><span>${e(formatDate(n.createdAt || n.created_at,true))}</span><span>${e(n.recipientMasked || '')}</span>${n.message ? `<small>${e(n.message)}</small>` : ''}</div>`).join('')}</div>` : ''}</section>`;
}
function renderEmailSection() {
  const section = document.querySelector('.result-email');
  if (section && ui.resultData?.caseId === ui.selected) section.outerHTML = emailSectionMarkup(ui.resultData);
}
function clearEmailPreview(renderSection = false) {
  ui.emailPreview = null; ui.previewLoading = false; ++ui.previewSequence;
  if (renderSection) renderEmailSection();
}
function updateResultControls() {
  if (!ui.dirty) ui.resultDirtyForm = null;
  document.querySelectorAll('#station-result-form, #bulk-station-form, #online-result-form, #certificate-form').forEach(form => { const disabled = ui.publishing || ui.resultData?.canWrite === false || (!!ui.resultDirtyForm && ui.resultDirtyForm !== form.id); form.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = disabled; }); });
  document.querySelectorAll('.results-fieldset').forEach(el => { el.disabled = ui.publishing || ui.resultData?.canWrite === false; });
  document.querySelectorAll('[data-action="preview-email"]').forEach(el => { el.disabled = ui.publishing || ui.previewLoading || ui.resultData?.canWrite === false; });
  document.querySelectorAll('[data-action="send-email"]').forEach(el => { el.disabled = ui.publishing || ui.dirty || ui.emailPreview?.canSend !== true; });
  document.querySelectorAll('[data-action="reload-results"], [data-action="close-email-preview"]').forEach(el => { el.disabled = ui.publishing; });
  updateRatingRequired();
}
async function loadEmailPreview() {
  if (ui.dirty) { toast('수정한 결과와 선택한 필증을 먼저 저장해 주세요.', true); return; }
  if (ui.publishing || ui.previewLoading || !ui.resultData) return;
  const id = ui.selected, sequence = ++ui.previewSequence;
  ui.emailPreview = null; ui.previewLoading = true; renderEmailSection();
  try {
    const preview = await api(`/api/cases/${encodeURIComponent(id)}/email-preview`);
    if (ui.selected !== id || sequence !== ui.previewSequence || ui.dirty || ui.publishing) return;
    if (typeof preview.html !== 'string' || !preview.revision || !preview.updatedAt) throw new Error('이메일 미리보기 형식을 확인할 수 없습니다. 다시 불러와 주세요.');
    ui.emailPreview = { ...preview, caseId: id }; ui.previewLoading = false; renderEmailSection();
    document.querySelector('.email-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) { if (ui.selected === id && sequence === ui.previewSequence) { ui.previewLoading = false; renderEmailSection(); toast(error.message, true); } }
}
function resultsMarkup(d) {
  if (ui.resultLoading && !ui.resultData) return '<div class="detail-empty result-loading"><span class="spinner"></span><p>서비스의 최신 결과를 확인하고 있습니다.</p></div>';
  if (ui.resultError && !ui.resultData) return `<div class="notice error">${e(ui.resultError)}</div><button class="button secondary" data-action="reload-results">서비스 결과 다시 가져오기</button>`;
  const data = ui.resultData;
  if (!data || data.caseId !== ui.selected) return '<div class="notice">서비스의 최신 결과를 불러온 후 입력할 수 있습니다.</div><button class="button secondary" data-action="reload-results">서비스 결과 가져오기</button>';
  return `<div class="results-intro"><span class="badge blue">관리자 페이지 · 고객 결과 페이지 연동</span><p>결과 저장은 관리자 페이지와 고객 결과 페이지에 반영됩니다. 이메일은 각 결과를 저장한 뒤 아래 미리보기에서 별도로 발송합니다.</p><div class="result-toolbar"><button class="button secondary small" data-action="reload-results"${ui.publishing ? ' disabled' : ''}>서비스 최신 결과 가져오기 ↻</button><button class="button accent" data-action="preview-email"${ui.publishing || ui.previewLoading || data.canWrite === false ? ' disabled' : ''}>이메일 발송</button></div><p class="helper">‘이메일 발송’에서 현재 저장된 전체 결과를 미리 확인한 뒤 고객에게 전송합니다.</p></div><div id="result-conflict" role="alert"${ui.resultError ? '' : ' hidden'} class="notice error">${e(ui.resultError)}</div>${notificationMarkup(ui.resultNotice?.notification,ui.resultNotice?.message || '')}${data.canWrite === false ? `<div class="notice error">${e(data.writeDisabledReason || '이 Mac의 결과 저장 연결을 확인해 주세요.')}</div>` : ''}<fieldset class="results-fieldset"${ui.publishing || data.canWrite === false ? ' disabled' : ''}>${data.type === 'MV_DISTRIBUTION' ? onlineEditorMarkup(data) : stationEditorMarkup(data)}</fieldset>${emailSectionMarkup(data)}`;
}
async function loadResults(force = false) {
  if (!ui.selected || ui.publishing || (!force && ui.dirty)) return;
  const id = ui.selected, sequence = ++ui.resultSequence;
  if (force) { clearEmailPreview(); ui.resultLoading = true; ui.resultError = ''; if (ui.tab === 'results') detailRender(); }
  try {
    const data = await api(`/api/cases/${encodeURIComponent(id)}/results`);
    if (ui.selected !== id || sequence !== ui.resultSequence || ui.publishing) return;
    if (ui.dirty) { ui.resultLoading = false; return; }
    const next = { ...data, caseId: id, type: data.type || ui.detail?.submission.type };
    const changed = JSON.stringify(next) !== JSON.stringify(ui.resultData);
    if (changed) clearEmailPreview();
    ui.resultData = next; ui.resultLoading = false; if (force) ui.resultError = '';
    if (ui.tab === 'results' && (force || changed)) { detailRender(); updateRatingRequired(); }
  } catch (error) {
    if (ui.selected !== id || sequence !== ui.resultSequence) return;
    ui.resultLoading = false; ui.resultError = error.message;
    if (force && ui.tab === 'results' && !ui.dirty) detailRender();
  }
}
function updateRatingRequired() {
  updateBulkControls();
  const form = document.getElementById('station-result-form'); if (!form) return;
  const rating = form.elements.ageRating; if (!rating) return;
  const required = form.elements.status.value === 'APPROVED'; rating.required = required; rating.disabled = !required || ui.publishing || ui.resultData?.canWrite === false || (!!ui.resultDirtyForm && ui.resultDirtyForm !== form.id);
}
function resultBody(form) {
  const data = ui.resultData, fields = new FormData(form);
  if (!data) throw new Error('최신 결과를 먼저 불러오세요.');
  if (form.id === 'online-result-form') return { operation: 'online', expectedUpdatedAt: data.submission?.updated_at ?? null, rating: String(fields.get('rating') || ''), resultMemo: String(fields.get('resultMemo') || '') };
  const station = data.stations.find(st => st.id === form.dataset.station);
  if (!station) throw new Error('신청 방송사를 다시 확인해 주세요.');
  const body = { operation: 'station', applyOverallStatus: form.dataset.applyOverallStatus === 'true', stationId: station.id, reviewId: station.review?.id || null, expectedUpdatedAt: station.review?.updated_at ?? null, status: String(fields.get('status') || ''), resultNote: String(fields.get('resultNote') || '') };
  if (data.type === 'MV_BROADCAST') body.ageRating = body.status === 'APPROVED' ? String(fields.get('ageRating') || '') : null;
  if (fields.has('includeTrackResults')) body.trackResults = stationTracks(data,station).map(t => ({ trackId: t.id, trackNo: t.track_no, title: t.track_title || t.track_title_official || '', status: String(fields.get(`trackResult_${t.id}`) || 'PENDING') }));
  return body;
}
function attemptFor(body, extra = '') {
  const signature = `${ui.selected}:${JSON.stringify(body)}:${extra}`;
  if (!ui.resultAttempts[signature]) ui.resultAttempts[signature] = crypto.randomUUID();
  return { signature, requestId: ui.resultAttempts[signature] };
}
function resultError(error) {
  const conflict = error.status === 409 || /conflict|stale/i.test(error.code || '');
  const message = conflict ? '관리자 페이지 또는 다른 작업에서 결과가 변경되었습니다. 입력한 내용을 보존했습니다. 위의 ‘서비스 최신 결과 가져오기’를 눌러 현재 결과를 확인한 뒤 다시 입력하세요.' : error.message;
  ui.resultError = message;
  const box = document.getElementById('result-conflict'); if (box) { box.hidden = false; box.textContent = message; box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  toast(message,true);
}
async function publishResult(body, file = null) {
  if (ui.publishing) return;
  const sending = body.operation === 'send';
  if (sending && (ui.dirty || ui.emailPreview?.caseId !== ui.selected || ui.emailPreview?.canSend !== true)) { toast('저장된 전체 결과의 이메일 미리보기를 다시 확인해 주세요.', true); return; }
  const caseId = ui.selected, attempt = attemptFor(body,file ? `${file.name}:${file.size}:${file.lastModified}` : '');
  if (!sending) clearEmailPreview(true);
  ui.publishing = true; ++ui.resultSequence; ++ui.previewSequence; updateResultControls();
  try {
    const response = file ? await api(`/api/cases/${encodeURIComponent(caseId)}/certificate?filename=${encodeURIComponent(file.name)}&expectedUpdatedAt=${encodeURIComponent(body.expectedUpdatedAt || '')}&requestId=${encodeURIComponent(attempt.requestId)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }) : await api(`/api/cases/${encodeURIComponent(caseId)}/results`, { method: 'POST', body: { ...body, requestId: attempt.requestId } });
    delete ui.resultAttempts[attempt.signature]; ui.dirty = false; ui.certificateFile = null; ui.resultError = ''; clearEmailPreview();
    if (response.snapshot) ui.resultData = { ...response.snapshot, caseId, type: response.snapshot.type || ui.detail?.submission.type };
    if (body.operation === 'bulk-stations') ui.bulkSelected = [];
    ui.resultNotice = { message: response.message || (sending ? '확인한 전체 결과의 이메일 발송을 요청했습니다.' : file ? '필증을 서비스에 등록했습니다. 이메일은 별도로 발송해 주세요.' : '심의 결과를 서비스에 저장했습니다. 이메일은 별도로 발송해 주세요.'), notification: sending ? response.notification || response.notifications || null : null };
    ui.publishing = false; detailRender();
    await loadDetail(caseId, false); await refresh();
    toast(ui.resultNotice.message);
  } catch (error) {
    ui.publishing = false;
    if (sending && (error.status === 409 || /conflict|stale/i.test(error.code || ''))) {
      clearEmailPreview(true); ui.resultError = '미리보기 이후 결과가 변경되어 이메일을 보내지 않았습니다. 서비스 최신 결과를 가져온 뒤 전체 결과 이메일을 다시 미리보기해 주세요.';
      const box = document.getElementById('result-conflict'); if (box) { box.hidden = false; box.textContent = ui.resultError; }
      toast(ui.resultError, true);
    } else resultError(error);
  } finally { ui.publishing = false; updateResultControls(); }
}

async function action(name, button) {
  if (button) button.disabled = true;
  try {
    if (name === 'new-manual') { if (!(await discardEdits())) return; ui.importOpen = true; ui.referenceFile = null; manualScreen(); }
    else if (name === 'view-trash') { if (!(await discardEdits())) return; ui.nav = 'trash'; render(); }
    else if (name === 'edit-manual') { if (!(await discardEdits())) return; ui.tab = 'documents'; ui.docTab = 'edit'; detailRender(); }
    else if (name === 'translate-manual') await translateManualLyrics();
    else if (name === 'reload-results') { if (!(await discardEdits())) return; ui.dirty = false; await loadResults(true); }
    else if (name === 'preview-email') await loadEmailPreview();
    else if (name === 'close-email-preview') clearEmailPreview(true);
    else if (name === 'send-email') { const preview = ui.emailPreview; if (preview) await publishResult({ operation: 'send', expectedRevision: preview.revision, expectedUpdatedAt: preview.updatedAt }); }
    else if (name === 'add-track') { addLocalTrack(); }
    else if (name === 'sync') { await api('/api/sync', { method: 'POST', body: {} }); toast('신청 내역을 가져오고 있습니다.'); await refresh(); }
    else if (name === 'retry') await refresh(true);
    else if (name === 'generate' || name === 'download') { if (ui.dirty) { toast('수정 중인 내용을 먼저 저장해 주세요.', true); return; } await api(apiPath(`/${name}`), { method: 'POST', body: {} }); toast(name === 'generate' ? '심의 자료 생성을 시작했습니다.' : '원본 파일 다운로드를 시작했습니다.'); await refresh(); detailRender(); }
    else if (name === 'open-case' || name === 'open-latest') await api(apiPath('/open'), { method: 'POST', body: { target: name === 'open-latest' ? 'latest' : 'case' } });
    else if (name === 'open-root') await api('/api/open-output', { method: 'POST', body: {} });
    else if (name === 'backup') { const backup = await api('/api/backup', { method: 'POST', body: {} }); toast(backup.message || '관리 내역과 생성 문서를 백업했습니다.'); await refresh(); }
    else if (name === 'copy-info') { await navigator.clipboard.writeText(copyText(effective())); toast('입력용 정보를 복사했습니다.'); }
  } catch (error) { toast(error.message, true); } finally { if (button?.isConnected) button.disabled = false; updateResultControls(); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.deleteCase) { event.preventDefault(); await deleteCase(button.dataset.deleteCase); return; }
  if (button.dataset.restoreCase) { event.preventDefault(); await restoreCase(button.dataset.restoreCase); return; }
  if (button.dataset.removeTrack) { event.preventDefault(); try { removeLocalTrack(button.dataset.removeTrack); } catch (error) { toast(error.message, true); } return; }
  if (button.dataset.action) { event.preventDefault(); await action(button.dataset.action, button); return; }
  if (button.dataset.manualType) { if (!(await discardEdits())) return; ui.dirty = false; ui.nav = 'manual'; ui.manualType = button.dataset.manualType; ui.stage = 'all'; ui.query = ''; ui.selected = null; ui.detail = null; ui.savedDetail = null; ui.referenceFile = null; ui.importOpen = true; render(); return; }
  if (button.dataset.nav) { if (!(await discardEdits())) return; ui.dirty = false; ui.stage = 'all'; ui.query = ''; ui.nav = button.dataset.nav; render(); window.scrollTo(0,0); return; }
  if (button.dataset.case || button.dataset.historyCase) {
    if (!(await discardEdits())) return; ui.dirty = false; const selectedCase = cases().find(c => c.id === (button.dataset.case || button.dataset.historyCase)); const previousNav = ui.nav; ui.nav = isManual(selectedCase) ? 'manual' : 'cases'; if (isManual(selectedCase)) { ui.manualType = manualCategory(selectedCase); ui.importOpen = false; ui.referenceFile = null; } ui.tab = button.dataset.historyCase ? 'documents' : 'overview'; if (button.dataset.historyCase) ui.docTab = 'history';
    const id = button.dataset.case || button.dataset.historyCase; if (previousNav !== ui.nav || !document.getElementById('detail-panel') || ui.nav === 'manual') render(); await loadDetail(id); return;
  }
  if (button.dataset.filter) { ui.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === ui.filter)); renderList(); return; }
  if (button.dataset.tab) { if (!(await discardEdits())) return; ui.dirty = false; ui.tab = button.dataset.tab; detailRender(); if (ui.tab === 'results' && !isManual(ui.detail)) await loadResults(true); return; }
  if (button.dataset.docTab) { if (!(await discardEdits())) return; ui.dirty = false; ui.docTab = button.dataset.docTab; detailRender(); return; }
  if (button.dataset.resultStation) { if (!(await discardEdits())) return; ui.dirty = false; ui.resultStationId = button.dataset.resultStation; detailRender(); updateRatingRequired(); return; }
  if (button.dataset.artifact) { button.disabled = true; try { await downloadArtifact(button.dataset.generation, button.dataset.artifact); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { ui.query = event.target.value; renderList(); return; }
  if (event.target.closest('#edit-form, #notes-form, #settings-form, #station-result-form, #bulk-station-form, #online-result-form, #certificate-form')) { ui.dirty = true; if (event.target.closest('#station-result-form, #bulk-station-form, #online-result-form, #certificate-form')) { ui.resultDirtyForm = event.target.closest('form').id; clearEmailPreview(true); if (ui.resultDirtyForm !== 'bulk-station-form') updateResultControls(); } const status = document.getElementById('edit-save-status'); if (status) status.textContent = '저장하지 않은 변경 사항이 있습니다'; }
});
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.closest('#bulk-station-form')) { ui.dirty = true; ui.resultDirtyForm = 'bulk-station-form'; clearEmailPreview(true); updateBulkControls(el); if (!ui.bulkSelected.length) ui.dirty = false; updateResultControls(); return; }
  if (el.closest('#station-result-form, #online-result-form, #certificate-form')) { ui.dirty = true; ui.resultDirtyForm = el.closest('form').id; clearEmailPreview(true); updateResultControls(); }
  if (el.closest('#station-result-form') && el.name === 'status') { el.closest('form').dataset.applyOverallStatus = 'true'; updateRatingRequired(); const next = ['APPROVED','REJECTED'].includes(el.value) ? el.value : 'PENDING'; el.closest('form').querySelectorAll('[name^=trackResult_]').forEach(field => { field.value = next; }); }
  if (el.closest('#station-result-form') && el.name?.startsWith('trackResult_')) el.closest('form').dataset.applyOverallStatus = 'false';
  if (el.id === 'certificate-file') {
    const file = el.files?.[0]; if (file && file.size > 20 * 1024 * 1024) { el.value = ''; ui.certificateFile = null; toast('필증은 20MB 이하 파일을 선택해 주세요.', true); return; }
    ui.certificateFile = file || null; const selection = document.getElementById('certificate-selection'); if (selection) selection.textContent = file ? `${file.name} · ${fileSize(file.size)} · 업로드 전` : '파일을 선택해 주세요.'; return;
  }
  if (el.id === 'manual-reference') { ui.referenceFile = el.files?.[0] || null; const selection = document.getElementById('manual-reference-name'); if (selection) selection.textContent = ui.referenceFile ? `${ui.referenceFile.name} · ${fileSize(ui.referenceFile.size)}` : 'Word·한글 기준파일을 선택하세요.'; return; }
  if (el.id === 'manual-mv-type') { ui.manualMvType = el.value; return; }
  if (el.id === 'stage-filter') { ui.stage = el.value; renderList(); return; }
  try {
    if (el.id === 'manual-review-ack') await saveLocal({ reviewAcknowledgedRevision: el.checked ? (ui.detail?.screening?.sourceHash || '') : '' }, el.checked ? '현재 내용의 검토 기록을 저장했습니다.' : '검토 기록을 해제했습니다.');
    if (el.id === 'local-stage') await saveLocal({ stage: el.value }, '진행 단계를 저장했습니다.', false, true);
    if (el.id === 'due-date') await saveLocal({ dueDate: el.value }, '목표 처리일을 저장했습니다.', false, true);
    if (el.dataset.check) await saveLocal({ checklist: { [el.dataset.check]: el.checked } }, '체크리스트를 저장했습니다.', false, true);
    if (el.id === 'local-attachments') {
      const files = Array.from(el.files || []); el.disabled = true; let count = 0;
      for (const file of files) {
        const progress = document.getElementById('attachment-progress'); if (progress) progress.textContent = `${count + 1} / ${files.length} · ${file.name} 저장 중…`;
        await api(`${apiPath('/attachments')}?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); count++;
      }
      if (count) { toast(`받은 파일 ${count}개를 연결했습니다.`); await loadDetail(ui.selected, false); } el.disabled = false; el.value = '';
    }
  } catch (error) { toast(error.message, true); el.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!['manual-import-form','notes-form','edit-form','settings-form','station-result-form','bulk-station-form','online-result-form','certificate-form'].includes(form.id)) return; event.preventDefault();
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const data = new FormData(form);
    if (form.id === 'manual-import-form') { await importManualReference(); return; }
    if (form.id === 'bulk-station-form') { await publishResult(bulkResultBody(form)); return; }
    if (form.id === 'station-result-form' || form.id === 'online-result-form') { await publishResult(resultBody(form)); return; }
    if (form.id === 'certificate-form') { if (!ui.certificateFile) throw new Error('업로드할 영등위 필증 파일을 선택해 주세요.'); await publishResult({ operation: 'certificate', expectedUpdatedAt: ui.resultData?.submission?.updated_at ?? null },ui.certificateFile); return; }
    if (form.id === 'notes-form') await saveLocal({ notes: String(data.get('notes') || '') }, '작업 메모를 저장했습니다.');
    if (form.id === 'edit-form') {
      const overrides = editedOverrides(form);
      await saveLocal({ overrides }, '문서용 수정 내용을 저장했습니다. 새 문서를 생성해 적용하세요.');
    }
    if (form.id === 'settings-form') {
      const settings = Object.fromEntries(data.entries()); settings.autoSync = data.has('autoSync'); settings.autoGenerate = data.has('autoGenerate'); const result = await api('/api/settings', { method: 'POST', body: settings }); ui.data.settings = result.settings || { ...ui.data.settings, ...settings }; ui.dirty = false; toast('데스크 설정을 저장했습니다.');
    }
  } catch (error) { toast(error.message, true); } finally { if (button.isConnected) button.disabled = false; }
});
document.getElementById('refresh-top').addEventListener('click', event => action('sync', event.currentTarget));
window.addEventListener('beforeunload', event => { if (ui.dirty) { event.preventDefault(); event.returnValue = ''; } });
refresh(true);
