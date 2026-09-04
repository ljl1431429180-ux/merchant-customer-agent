const status = document.querySelector('#status');
const detail = document.querySelector('#detail');
const toggle = document.querySelector('#toggle');
const draft = document.querySelector('#draft');
const createDraft = document.querySelector('#createDraft');
const fillDraft = document.querySelector('#fillDraft');
const auto = document.querySelector('#auto');
const autoToggle = document.querySelector('#autoToggle');

function label(event) {
  if (!event) return ['等待飞鸽新咨询', '暂无记录'];
  const names = { feige_handled: '飞鸽已处理', human_handled: '人工已接管', agent_candidate: 'Agent 可处理' };
  return [names[event.status] || '已记录', `${event.note}\n客户：${event.question || '—'}${event.product ? `\n商品：${event.product}` : ''}${event.contextNote ? `\n上下文：${event.contextNote}` : ''}`];
}

async function render() {
  const data = await chrome.storage.local.get({ enabled: true, lastEvent: null, draft: null, draftState: 'idle', draftError: null, autoPreflight: null, autoReply: { enabled: false, minDelayMs: 5000, maxPerHour: 10 } });
  const [title, text] = label(data.lastEvent);
  status.textContent = data.enabled ? title : '监听已暂停';
  detail.textContent = text;
  toggle.textContent = data.enabled ? '暂停监听' : '开启监听';
  toggle.className = data.enabled ? '' : 'off';
  const allowed = data.enabled && data.lastEvent?.status === 'agent_candidate';
  createDraft.disabled = !allowed || data.draftState === 'loading';
  fillDraft.disabled = !allowed || !data.draft?.text || data.draftState !== 'ready';
  createDraft.textContent = data.draftState === 'loading' ? '正在生成…' : '生成草稿';
  if (data.draftState === 'loading') draft.textContent = '正在根据已确认的店铺商品资料生成草稿…';
  else if (data.draftState === 'error') draft.textContent = `未生成草稿：${data.draftError || '请稍后再试。'}`;
  else if (data.draft?.text) draft.textContent = `${data.draft.needsHuman ? '建议转人工：' : '可参考草稿：'}${data.draft.text}\n\n不会自动填入或发送。`;
  else draft.textContent = allowed ? '飞鸽暂未回复。您可手动生成一条仅供查看的草稿。' : '只有“Agent 可处理”的会话可生成草稿。';
  autoToggle.textContent = data.autoReply?.enabled ? '已开启' : '保持关闭';
  autoToggle.className = data.autoReply?.enabled ? '' : 'off';
  if (!data.autoPreflight) auto.textContent = data.autoReply?.enabled ? '已开启：每小时最多 10 条；每条至少等待 5 秒再校验发送。' : '默认关闭：仅限已确认商品资料的单一材质、颜色或尺码问题。';
  else if (data.autoPreflight.eligible) auto.textContent = `本条可自动回复：至少等待 ${Math.round(data.autoPreflight.policy.minDelayMs / 1000)} 秒后再次校验。`;
  else auto.textContent = `不会自动回复：${data.autoPreflight.reasons.join(' ')}`;
}

toggle.addEventListener('click', async () => {
  const { enabled = true } = await chrome.storage.local.get({ enabled: true });
  await chrome.storage.local.set({ enabled: !enabled });
  render();
});

autoToggle.addEventListener('click', async () => {
  const data = await chrome.storage.local.get({ autoReply: { enabled: false, minDelayMs: 5000, maxPerHour: 10 } });
  const enabled = !data.autoReply?.enabled;
  await chrome.storage.local.set({
    autoReply: { ...data.autoReply, enabled, minDelayMs: 5000, maxPerHour: 10 },
    autoPreflight: null,
  });
  render();
});

createDraft.addEventListener('click', async () => {
  createDraft.disabled = true;
  draft.textContent = '正在根据已确认的店铺商品资料生成草稿…';
  const result = await chrome.runtime.sendMessage({ type: 'feige-agent-create-draft' });
  if (!result?.ok) draft.textContent = `未生成草稿：${result?.error || '请稍后再试。'}`;
  await render();
});

fillDraft.addEventListener('click', async () => {
  fillDraft.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'feige-agent-fill-draft' });
  draft.textContent = result?.ok ? `${dataText(result.note)}\n\n草稿仍未发送。` : `未填入：${result?.error || '请稍后再试。'}`;
  await render();
});

function dataText(value) {
  return String(value || '草稿已填入。');
}

render();
