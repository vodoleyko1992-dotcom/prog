/* 14.10: явные PvP-цели отделены от обычного листа врагов. */
(function(root){'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number.isFinite(+x)?Math.round(+x).toLocaleString('ru-RU'):'—';
const low=x=>String(x||'').trim().toLowerCase();
const known=rt=>Object.values(rt.enemies||{}).filter(e=>e?.id&&e.name);
const observed=e=>{const out=[];if(e?.lvl)out.push('Последний известный уровень '+num(e.lvl));if(e?.hitMax)out.push('Наблюдённый удар до '+num(e.hitMax)+' HP');if(e?.lastKill)out.push('Смерть записана '+new Date(e.lastKill).toLocaleString('ru-RU'));return out.join(' · ')||'Измерений силы пока нет';};
function mount(node,adapter){let state,busy=false,seq=0,note='',confirm=null;
 async function act(fn){if(busy)return;busy=true;node.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);try{await fn();note='';}catch(e){note=e?.message||String(e);}finally{busy=false;await render();}}
 async function render(){if(busy)return;const current=++seq,next=await adapter.getState();if(seq!==current)return;if(state?.rt?.char!==next.rt?.char)confirm=null;state=next;const rt=next.rt||{},targets=Object.values(rt.pvpTargets||{}),enemies=known(rt),options=enemies.filter(e=>!targets.some(t=>t.id===e.id));
  node.innerHTML=`<h3>Атаковать при встрече</h3><label>Разрешить атаки по отдельному списку<input id="pvpOnSight" type="checkbox" ${next.cfg?.pvpOnSight!==false?'checked':''}></label>
  <div class="hint">Для явно выбранных целей не применяются обычные ограничения по силе, уровню, цвету ника и прошлым поражениям. Бот добивает текущего моба и проверяет цель до следующего боя. Своя группа, клан, запреты игры, Stop, другая управляющая вкладка, проверка активности и приоритет TvT сохраняются. Победа не гарантируется. Выключение или удаление здесь не убирает игрока из обычного листа врагов: его отдельные правила ниже сохраняются.</div>
  <div class="box" role="status">${esc(note||(!next.on?'Бот остановлен. Изменения сохраняются без запуска.':rt.pvpRecovery?'После PvP-смерти: ожидаю подтверждённого возврата в город. Обычные действия приостановлены.':'Проверяет только включённые точные цели.'))}</div>
  <div class="pvp-targets">${targets.length?targets.map(t=>{const e=enemies.find(e=>e.id===t.id&&low(e.name)===low(t.name));return `<article data-pvp-id="${esc(t.id)}"><div class="row"><strong>${esc(t.name)}</strong><span>${t.enabled?'Включена':'Выключена'}</span></div><div class="pvp-id">ID: ${esc(t.id)}</div><div class="hint">${esc(observed(e))}</div>${t.id==='6f573aad-08ee-4713-9d76-33f5fd4afc93'?'<div class="hint">Запись пользователя 14.10: удар 16 441 при 9785 HP героя. Это историческое наблюдение, не текущие HP или прогноз.</div>':''}<div class="row"><button data-pvp-enable="${esc(t.id)}">${t.enabled?'Выключить':'Включить'}</button><button data-pvp-remove="${esc(t.id)}">Удалить цель</button></div></article>`}).join(''):'<div class="hint">Список пуст. Обычные враги сами в него не переносятся.</div>'}</div>
  <label>Добавить известного игрока<select data-pvp-add-select><option value="">Выберите из листа врагов</option>${options.map(e=>`<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.id)}</option>`).join('')}</select></label><button data-pvp-add ${options.length?'':'disabled'}>Добавить в «Атаковать при встрече»</button>
  ${confirm?`<div class="pvp-confirm"><b>${esc(confirm.name)}</b><div class="pvp-id">ID: ${esc(confirm.id)}</div><p>Разрешить атаку при встрече даже при сильном противнике, обычном цвете ника или прежних поражениях?</p><button data-pvp-confirm>Да, добавить эту цель</button><button data-pvp-cancel>Отмена</button></div>`:''}`;
  node.querySelector('#pvpOnSight').onchange=e=>act(()=>adapter.saveConfig({pvpOnSight:e.target.checked},{char:rt.char||''}));
  node.querySelectorAll('[data-pvp-enable]').forEach(b=>b.onclick=()=>{const t=targets.find(x=>x.id===b.dataset.pvpEnable);return act(()=>adapter.editTarget({action:'enabled',id:t.id,name:t.name,enabled:!t.enabled},{char:rt.char||''}));});
  node.querySelectorAll('[data-pvp-remove]').forEach(b=>b.onclick=()=>{const t=targets.find(x=>x.id===b.dataset.pvpRemove);return act(()=>adapter.editTarget({action:'remove',id:t.id,name:t.name},{char:rt.char||''}));});
  node.querySelector('[data-pvp-add]').onclick=()=>{const id=node.querySelector('[data-pvp-add-select]').value,e=options.find(e=>e.id===id);if(!e){note='Выберите известного игрока с точным ID';return render();}confirm={id:e.id,name:e.name};return render();};
  node.querySelector('[data-pvp-cancel]')?.addEventListener('click',()=>{confirm=null;render();});
  node.querySelector('[data-pvp-confirm]')?.addEventListener('click',()=>act(async()=>{await adapter.editTarget({action:'add',...confirm},{char:rt.char||''});confirm=null;}));
 }
 render();return{refresh:render};
}
root.L2PvpUI={mount};
})(globalThis);
