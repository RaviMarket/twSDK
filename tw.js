(async () => {
  /************************************************************************
   * Assistente de Farm — Ravi Edition (Versão Final)
   * Módulos: 1) Bárbaras próximas  2) Estimativa loot
   *          3) Sugestor / Waves    4) Multi-village selector
   *          5) Timers de viagem   6) Filtros avançados
   *
   * Segurança: NÃO automatiza envios.
   ************************************************************************/

  // --- 0) Caminho do SDK (use o caminho local que você tem) ---
  const SDK_PATH = '/mnt/data/html tribal wars.txt'; // se você converteu pra twSDK.js, coloque o caminho .js aqui

  // Carrega SDK (tenta 2x se falhar)
  async function loadSDK() {
    return new Promise((resolve, reject) => {
      if (window.twSDK && typeof window.twSDK.init === 'function') return resolve();
      const s = document.createElement('script');
      s.src = SDK_PATH;
      s.onload = () => {
        // espera o objeto twSDK ficar disponível
        const wait = setInterval(() => {
          if (window.twSDK && typeof window.twSDK.init === 'function') {
            clearInterval(wait);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(wait);
          if (!(window.twSDK && typeof window.twSDK.init === 'function')) {
            reject(new Error('SDK não inicializou a tempo.'));
          }
        }, 6000);
      };
      s.onerror = (e) => reject(e);
      document.body.appendChild(s);
    });
  }

  try {
    await loadSDK();
  } catch (e) {
    alert('Erro ao carregar SDK. Confirme o caminho e salve o SDK como .js. Erro: ' + e.message);
    console.error(e);
    return;
  }

  // --- 1) Inicializa twSDK ---
  await twSDK.init({
    scriptData: {
      name: 'Assistente de Farm - Ravi Final',
      version: '1.5',
      author: 'Ravi',
    },
    translations: { 'pt_BR': {} },
    allowedMarkets: ['us', 'en', 'br'],
    allowedScreens: ['map', 'overview_villages', 'place'],
    isDebug: false,
    enableCountApi: false,
  });

  // --- 2) Helpers UI e utilitários ---
  const UI = {
    panelId: 'ravi_final_panel',
    showFixedPanel: (html) => {
      twSDK.renderFixedWidget(html, UI.panelId, 'ravi-final-widget', '', '460px', 'Assistente de Farm — Ravi');
    },
    copy: (text) => navigator.clipboard.writeText(text),
    openPlace: (myVillageId, targetId) => window.open(`${game_data.link_base_pure}game.php?village=${myVillageId}&screen=place&target=${targetId}`, '_blank'),
    formatCoord: (x,y) => `${x}|${y}`,
    info: (msg) => console.log('[Ravi Farm] ' + msg),
    alert: (msg) => alert(msg),
  };

  function safeNum(v){ return typeof v === 'number' ? v : parseInt(v)||0; }

  // --- 3) Dados do jogador e do mundo ---
  const myVillage = {
    id: parseInt(game_data.village.id),
    coord: `${game_data.village.x}|${game_data.village.y}`,
    x: parseInt(game_data.village.x),
    y: parseInt(game_data.village.y),
  };

  // carrega world data (village + player)
  const villagesRaw = await twSDK.worldDataAPI('village'); // array arrays
  const playersRaw = await twSDK.worldDataAPI('player');

  const villages = villagesRaw.map(v=>({
    id: parseInt(v[0]),
    name: v[1],
    x: parseInt(v[2]),
    y: parseInt(v[3]),
    playerId: parseInt(v[4]),
    points: parseInt(v[5]),
    type: parseInt(v[6]),
    coord: `${v[2]}|${v[3]}`
  }));

  const players = playersRaw.map(p=>({
    id: parseInt(p[0]),
    name: p[1],
    tribeId: parseInt(p[2]),
    villages: parseInt(p[3]),
    points: parseInt(p[4]),
    rank: parseInt(p[5])
  }));

  // obtém lista de suas vilas (player id do jogador atual)
  const myPlayerId = parseInt(game_data.player.id);
  const myVillages = villages.filter(v => v.playerId === myPlayerId);

  // --- 4) Funções centrais ---

  // distancia eu->v no mapa (eu uso função do SDK)
  function calcDistance(coordA, coordB){
    return twSDK.calculateDistance(coordA, coordB);
  }

  // Módulo 1: retorna bárbaras proximas (playerId === 0)
  function getNearbyBarbarians(limit = 200){
    const barbaras = villages.filter(v => v.playerId === 0);
    barbaras.forEach(b => b.dist = calcDistance(myVillage.coord, b.coord));
    barbaras.sort((a,b)=>a.dist - b.dist);
    return barbaras.slice(0, limit);
  }

  // Módulo 2: estimativa conservadora de loot
  function estimateLoot(v){
    // heurística: base nos pontos da vila (v.points)
    const basePoints = Math.max(30, safeNum(v.points));
    const base = Math.round(basePoints * 10);
    // uso uma função deterministica para variar por coord (sem aleatoriedade pura)
    const variance = Math.round((Math.sin(v.x + v.y) + 1) * 0.22 * base);
    const total = Math.round(base * 0.55 + variance);
    const wood = Math.round(total * 0.43);
    const clay = Math.round(total * 0.33);
    const iron = Math.round(total * 0.24);
    return { total, wood, clay, iron };
  }

  // Módulo 3: sugerir composições e criar waves (texto para colar)
  function getSuggestions() {
    // sugestões base — você pode ajustar
    return [
      { id: 's1', label: 'Pequena (rápida)', troopsText: '20 spear', wave: { spear:20 } },
      { id: 's2', label: 'Média (equilíbrio)', troopsText: '40 spear, 5 axe', wave: { spear:40, axe:5 } },
      { id: 's3', label: 'Pesada (loot alto)', troopsText: '60 spear, 20 axe', wave: { spear:60, axe:20 } },
      { id: 's4', label: 'Wave custom (criar abaixo)', troopsText: '', wave: {} }
    ];
  }

  // Constrói texto para colar no campo de tropas do place (formatação livre, a maioria dos servidores aceita "spear=10&axe=5" ou copia manual)
  function buildWaveText(waveObj){
    // TW padrão aceita copiar como "spear:10,axe:5" para colar no formulário; vamos criar uma string humana e uma string "cmd" (CSV)
    const unitsOrder = ['spear','sword','axe','archer','spy','light','heavy','ram','catapult','knight'];
    let human = [], cmdParts = [];
    unitsOrder.forEach(u=>{
      if (waveObj[u] && waveObj[u] > 0){
        human.push(`${waveObj[u]} ${u}`);
        cmdParts.push(`${u}=${waveObj[u]}`);
      }
    });
    return { humanText: human.join(', '), cmdText: cmdParts.join(',') };
  }

  // Módulo 4: Multi-village selector (gera selects com suas vilas)
  function renderMyVillageOptions(){
    return myVillages.map(v => `<option value="${v.id}">${v.coord} (${v.name})</option>`).join('');
  }

  // Módulo 5: Timer / retorno estimado
  // Calcula tempo de viagem em segundos para distância e unidade speed usando SDK
  async function estimateTravelSeconds(distance, unitKey = 'light'){
    const unitInfo = await twSDK.getWorldUnitInfo();
    const worldConfig = await twSDK.getWorldConfig();
    // unitInfo.config[unitKey].speed existe em config
    const speed = unitInfo.config[unitKey] ? parseFloat(unitInfo.config[unitKey].speed) : 1;
    const { unit_speed } = worldConfig.config;
    // fórmula: distance * timefactor (SDK uses rounding - use SDK helper)
    const travelSec = twSDK.getTravelTimeInSecond(distance, speed);
    // twSDK.getTravelTimeInSecond already uses minutes conversion for default speed; but we keep it
    return travelSec;
  }

  // --- 5) Render painel principal (UI HTML) ---
  function renderPanel(filteredList = null, selectedSuggestionIdx = 0) {
    const nearby = filteredList || getNearbyBarbarians(300);
    const suggestions = getSuggestions();

    const html = `
      <div style="font-size:13px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>Assistente de Farm — Ravi Final</strong>
          <small>Vila atual: ${myVillage.coord}</small>
        </div>

        <div style="margin-bottom:8px;">
          <label>Minha vila enviar: 
            <select id="ravi_selMyVillage">${renderMyVillageOptions()}</select>
          </label>
          &nbsp;
          <label>Filtro distância (tiles): <input id="ravi_maxDist" value="20" style="width:60px;"></label>
          &nbsp;
          <label>Min pontos: <input id="ravi_minPts" value="0" style="width:70px;"></label>
          &nbsp;
          <button id="ravi_apply" class="btn">Aplicar</button>
          <button id="ravi_refresh" class="btn">Atualizar</button>
        </div>

        <div style="margin-bottom:8px;">
          <label>Sugestões: 
            <select id="ravi_suggestions">${suggestions.map((s,i)=>`<option value="${i}">${s.label} ${s.troopsText ? '— '+s.troopsText : ''}</option>`).join('')}</select>
          </label>
          &nbsp;<button id="ravi_copyComp" class="btn">Copiar composição</button>
          &nbsp;<button id="ravi_buildWave" class="btn">Gerar Wave</button>
        </div>

        <div id="ravi_waveBuilder" style="margin-bottom:8px;display:none;">
          <div style="margin-bottom:6px;">Wave custom (preencha números):</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <label>Spear <input id="wb_spear" style="width:60px"></label>
            <label>Sword <input id="wb_sword" style="width:60px"></label>
            <label>Axe <input id="wb_axe" style="width:60px"></label>
            <label>Archer <input id="wb_archer" style="width:60px"></label>
            <label>Spy <input id="wb_spy" style="width:60px"></label>
            <label>Light <input id="wb_light" style="width:60px"></label>
            <label>Heavy <input id="wb_heavy" style="width:60px"></label>
            <label>Ram <input id="wb_ram" style="width:60px"></label>
            <label>Cat <input id="wb_cat" style="width:60px"></label>
            <label>Knight <input id="wb_knight" style="width:60px"></label>
            <button id="wb_gen" class="btn">Gerar texto da wave</button>
            <button id="wb_copy" class="btn">Copiar wave</button>
          </div>
          <div id="wb_output" style="margin-top:6px;background:#fff;padding:6px;border:1px solid #ddd;max-height:80px;overflow:auto;"></div>
        </div>

        <div style="margin-top:8px; max-height:360px; overflow:auto; border:1px solid #c59b59; padding:6px; background:#fff6da;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#e6d2a0;"><th>Coord</th><th>Dist</th><th>Pts</th><th>Estimativa Loot</th><th>Ações</th></tr></thead>
            <tbody>
              ${nearby.slice(0,300).map(v => {
                const loot = estimateLoot(v);
                return `<tr style="border-bottom:1px solid #ddd;">
                  <td style="padding:6px;">${v.coord}</td>
                  <td style="text-align:center;">${v.dist.toFixed(2)}</td>
                  <td style="text-align:center;">${v.points}</td>
                  <td style="text-align:center;">W${loot.wood} C${loot.clay} I${loot.iron}</td>
                  <td style="text-align:center;">
                    <button class="ravi_open_place btn" data-id="${v.id}">Abrir Place</button>
                    <button class="ravi_copy_cmd btn" data-id="${v.id}">Copiar Cmd</button>
                    <button class="ravi_timer btn" data-id="${v.id}">Timer</button>
                  </td>
                </tr>`; }).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:8px;font-size:12px;color:#333;">
          <strong>Como usar:</strong> 1) Selecione sua vila emissora. 2) Filtre alvos. 3) Escolha sugestão ou crie wave. 4) Clique "Abrir Place" para abrir o formulário com alvo pronto. Cole a composição (copiada via "Copiar composição" ou "Copiar wave") e envie manualmente.
        </div>
      </div>
    `;

    UI.showFixedPanel(html);

    // bind events
    setTimeout(() => {
      document.getElementById('ravi_refresh').addEventListener('click', () => renderPanel());
      document.getElementById('ravi_apply').addEventListener('click', () => {
        const maxd = parseFloat(document.getElementById('ravi_maxDist').value) || 9999;
        const minp = parseInt(document.getElementById('ravi_minPts').value) || 0;
        let list = getNearbyBarbarians(500);
        list = list.filter(x => x.dist <= maxd && x.points >= minp);
        renderPanel(list);
      });

      document.getElementById('ravi_copyComp').addEventListener('click', () => {
        const sel = parseInt(document.getElementById('ravi_suggestions').value);
        const suggestions = getSuggestions();
        const comp = suggestions[sel];
        if (comp.wave && Object.keys(comp.wave).length > 0){
          const waveText = buildWaveText(comp.wave).humanText;
          UI.copy(waveText);
          UI.alert('Composição copiada: ' + waveText);
        } else {
          UI.alert('Escolha ou crie uma composição válida.');
        }
      });

      document.getElementById('ravi_buildWave').addEventListener('click', ()=> {
        const el = document.getElementById('ravi_waveBuilder');
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      });

      // wave builder bindings
      document.getElementById('wb_gen').addEventListener('click', ()=>{
        const waveObj = {
          spear: parseInt(document.getElementById('wb_spear').value) || 0,
          sword: parseInt(document.getElementById('wb_sword').value) || 0,
          axe: parseInt(document.getElementById('wb_axe').value) || 0,
          archer: parseInt(document.getElementById('wb_archer').value) || 0,
          spy: parseInt(document.getElementById('wb_spy').value) || 0,
          light: parseInt(document.getElementById('wb_light').value) || 0,
          heavy: parseInt(document.getElementById('wb_heavy').value) || 0,
          ram: parseInt(document.getElementById('wb_ram').value) || 0,
          catapult: parseInt(document.getElementById('wb_cat').value) || 0,
          knight: parseInt(document.getElementById('wb_knight').value) || 0
        };
        const built = buildWaveText(waveObj);
        document.getElementById('wb_output').innerText = `Human: ${built.humanText}\nCmd: ${built.cmdText}`;
      });

      document.getElementById('wb_copy').addEventListener('click', ()=>{
        const txt = document.getElementById('wb_output').innerText;
        if (!txt || txt.trim().length === 0) { UI.alert('Gere uma wave primeiro.'); return; }
        UI.copy(txt);
        UI.alert('Wave copiada para a área de transferência. Cole no place.');
      });

      // bind list buttons (open place / copy cmd / timer)
      function bindListButtons() {
        document.querySelectorAll('.ravi_open_place').forEach(btn=>{
          btn.onclick = (e=>{
            const vid = parseInt(e.currentTarget.dataset.id);
            const fromVillageId = document.getElementById('ravi_selMyVillage').value || myVillage.id;
            UI.openPlace(fromVillageId, vid);
          });
        });
        document.querySelectorAll('.ravi_copy_cmd').forEach(btn=>{
          btn.onclick = (e=>{
            const vid = parseInt(e.currentTarget.dataset.id);
            const v = villages.find(x=>x.id===vid);
            v.dist = calcDistance(myVillage.coord, v.coord);
            const sel = parseInt(document.getElementById('ravi_suggestions').value);
            const suggestions = getSuggestions();
            const comp = suggestions[sel];
            let waveObj = comp.wave && Object.keys(comp.wave).length ? comp.wave : {};
            // se custom, tenta pegar do builder
            if (sel === 3) {
              // tentar extrair do builder
              waveObj = {
                spear: parseInt(document.getElementById('wb_spear').value)||0,
                sword: parseInt(document.getElementById('wb_sword').value)||0,
                axe: parseInt(document.getElementById('wb_axe').value)||0,
                archer: parseInt(document.getElementById('wb_archer').value)||0,
                light: parseInt(document.getElementById('wb_light').value)||0,
                heavy: parseInt(document.getElementById('wb_heavy').value)||0,
                ram: parseInt(document.getElementById('wb_ram').value)||0,
                catapult: parseInt(document.getElementById('wb_cat').value)||0,
                knight: parseInt(document.getElementById('wb_knight').value)||0,
                spy: parseInt(document.getElementById('wb_spy').value)||0
              };
            }
            const waveTxt = buildWaveText(waveObj).humanText || '(especifique wave)';
            const loot = estimateLoot(v);
            const cmdText = `Alvo: ${v.coord} (${v.name})\\nDist: ${v.dist.toFixed(2)}\\nLoot estimado: W${loot.wood} C${loot.clay} I${loot.iron}\\nComposição: ${waveTxt}\\nAbrir Place: ${game_data.link_base_pure}game.php?village=${document.getElementById('ravi_selMyVillage').value||myVillage.id}&screen=place&target=${v.id}`;
            UI.copy(cmdText);
            UI.alert('Comando copiado para área de transferência. Cole no place:\\n\\n' + cmdText);
          });
        });
        document.querySelectorAll('.ravi_timer').forEach(btn=>{
          btn.onclick = async (e=>{
            const vid = parseInt(e.currentTarget.dataset.id);
            const v = villages.find(x=>x.id===vid);
            const dist = calcDistance(myVillage.coord, v.coord);
            // calcula tempos para unidades comuns e mostra popup
            const unitInfo = await twSDK.getWorldUnitInfo();
            const worldConfig = await twSDK.getWorldConfig();
            // tenta pegar speed de light, spear e axe (se existirem)
            const unitKeys = Object.keys(unitInfo.config).slice(0,6); // primeiros tipos úteis
            let message = `Distância: ${dist.toFixed(2)} tiles\\n\\nEstimativa de tempos (ida) por unidade:\\n`;
            for (let k of unitKeys){
              const speed = parseFloat(unitInfo.config[k].speed);
              const travelSec = twSDK.getTravelTimeInSecond(dist, speed);
              const h = Math.floor(travelSec/3600); const m = Math.floor((travelSec%3600)/60); const s = travelSec%60;
              message += `${k}: ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}\\n`;
            }
            UI.alert(message);
          });
        });
      }

      bindListButtons();
    }, 250);
  }

  // run initial render
  renderPanel();

  // Final message
  console.log('Assistente de Farm — Ravi Edition (Final) carregado. Lembre: tudo é manual. Boa farmagem!');

})();
